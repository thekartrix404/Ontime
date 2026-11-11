import { getDb } from './db';
import { callGeminiWithTools, ToolCallResult } from './llm';
import { executeGuardedTool, GuardDecision } from './guard';
import { computeDaysOverdue, getSimulatedNow } from './clock';

export interface AgentRunResult {
  simulatedDate: string;
  invoicesEvaluated: number;
  decisions: GuardDecision[];
  skippedInvoices: Array<{
    invoiceId: string;
    invoiceNumber: string;
    stage: string;
    reason: string;
  }>;
}

const AGENT_SYSTEM_PROMPT = `You are an automated invoice follow-up agent.
Your job is to inspect overdue open invoices and choose the single appropriate tool action.

Tone guide based strictly on days overdue:
- -2 to 0 days overdue: friendly
- 1 to 7 days overdue: nudge
- 8 to 20 days overdue: firm
- 21+ days overdue: formal

Tool Selection Rules:
1. For days overdue <= 20: call send_reminder with the appropriate tone ('friendly', 'nudge', or 'firm').
2. For days overdue >= 21: call draft_escalation with 'formal' tone, or call propose_late_fee.
3. Write the reminder/escalation message yourself using ONLY the facts provided in the prompt (client name, amount, due date, days overdue, payment history counts).
4. NEVER compute or invent any number.
5. Provide clear, professional subjects and messages.`;

const AGENT_TOOLS = [
  {
    name: 'get_open_invoices',
    description: 'Retrieve open invoices awaiting payment.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'send_reminder',
    description: 'Send a reminder communication to the client for an overdue invoice.',
    parameters: {
      type: 'OBJECT',
      properties: {
        invoiceId: { type: 'STRING', description: 'Unique identifier of the invoice' },
        tone: { type: 'STRING', description: "Tone of the reminder ('friendly', 'nudge', 'firm', or 'formal')" },
        subject: { type: 'STRING', description: 'Subject line for the communication' },
        message: { type: 'STRING', description: 'Body text of the message' },
      },
      required: ['invoiceId', 'tone', 'subject', 'message'],
    },
  },
  {
    name: 'draft_escalation',
    description: 'Draft a formal escalation for severely overdue accounts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        invoiceId: { type: 'STRING', description: 'Unique identifier of the invoice' },
        tone: { type: 'STRING', description: "Tone of escalation (e.g. 'formal')" },
        message: { type: 'STRING', description: 'Body text of the escalation draft' },
      },
      required: ['invoiceId', 'tone', 'message'],
    },
  },
  {
    name: 'propose_late_fee',
    description: 'Propose applying a percentage late fee to the overdue invoice balance.',
    parameters: {
      type: 'OBJECT',
      properties: {
        invoiceId: { type: 'STRING', description: 'Unique identifier of the invoice' },
        percent: { type: 'NUMBER', description: 'Percentage late fee to propose (e.g. 5)' },
      },
      required: ['invoiceId', 'percent'],
    },
  },
];

/**
 * Maps days overdue to the expected stage/tone.
 */
export function getStageForDaysOverdue(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'friendly';
  if (daysOverdue <= 7) return 'nudge';
  if (daysOverdue <= 20) return 'firm';
  return 'formal';
}

/**
 * Checks whether this stage (tone) was already handled for the invoice.
 */
function isStageAlreadyHandled(invoiceId: string, stage: string): boolean {
  const db = getDb();

  const followupCount = (db.prepare(`
    SELECT COUNT(*) as count
    FROM followups
    WHERE invoice_id = ? AND LOWER(tone) = ? AND status != 'FAILED'
  `).get(invoiceId, stage.toLowerCase()) as { count: number }).count;

  if (followupCount > 0) return true;

  const queueCount = (db.prepare(`
    SELECT COUNT(*) as count
    FROM approval_queue
    WHERE invoice_id = ? AND LOWER(tone) = ?
  `).get(invoiceId, stage.toLowerCase()) as { count: number }).count;

  if (queueCount > 0) return true;

  return false;
}

/**
 * Runs the follow-up agent loop across all open invoices.
 * Open invoice statuses: SENT, UNPAID, PARTIALLY_PAID.
 * Skips PAID, MARKED_AS_PAID, CANCELLED.
 */
export async function runFollowUpAgent(): Promise<AgentRunResult> {
  const db = getDb();
  const simulatedNow = getSimulatedNow();

  // Query all open invoices
  const openInvoices = db.prepare(`
    SELECT i.*, c.name as client_name, c.company, c.email as client_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('SENT', 'UNPAID', 'PARTIALLY_PAID')
    ORDER BY i.due_date ASC
  `).all() as any[];

  const decisions: GuardDecision[] = [];
  const skippedInvoices: AgentRunResult['skippedInvoices'] = [];

  for (const inv of openInvoices) {
    const daysOverdue = computeDaysOverdue(inv.due_date, simulatedNow);
    const expectedStage = getStageForDaysOverdue(daysOverdue);

    // Idempotence check: skip if this stage (tone) was already handled
    if (isStageAlreadyHandled(inv.id, expectedStage)) {
      skippedInvoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        stage: expectedStage,
        reason: `Stage '${expectedStage}' already handled for invoice ${inv.invoice_number}`,
      });
      continue;
    }

    // Payment history counts for context
    const historyCount = (db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid
      FROM invoices
      WHERE client_id = ? AND id != ?
    `).get(inv.client_id, inv.id) as any) || { total: 0, paid: 0 };

    const prompt = `Invoice Details:
- Invoice ID: ${inv.id}
- Invoice Number: ${inv.invoice_number}
- Client Name: ${inv.client_name || inv.company}
- Email: ${inv.client_email}
- Amount: $${inv.amount} ${inv.currency}
- Due Date: ${inv.due_date}
- Current Days Overdue: ${daysOverdue}
- Client History: ${historyCount.paid} paid out of ${historyCount.total} previous invoices.

Evaluate this invoice and choose the appropriate tool action now.`;

    const fallbackContext = {
      daysOverdue,
      invoiceId: inv.id,
      clientName: inv.client_name || inv.company || 'Client',
      amount: inv.amount,
      dueDate: inv.due_date,
    };

    // Exactly ONE Gemini tool-calling call per overdue invoice per click
    const toolCallResponse = await callGeminiWithTools(
      prompt,
      AGENT_TOOLS,
      AGENT_SYSTEM_PROMPT,
      fallbackContext
    );

    if (toolCallResponse.fallbackUsed) {
      const now = new Date();
      db.prepare(`
        INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
        VALUES (?, 'FALLBACK_USED', 'invoice', ?, ?, ?, ?, ?, ?)
      `).run(
        `audit_fb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        inv.id,
        JSON.stringify({
          summaryText: `Fallback used (${toolCallResponse.fallbackUsed}) for invoice ${inv.invoice_number}`,
          source: toolCallResponse.source,
          fallbackReason: toolCallResponse.fallbackUsed,
        }),
        now.toISOString(),
        simulatedNow.toISOString(),
        daysOverdue,
        now.toISOString()
      );
    }

    // Pass each tool call through the Mandate Guard before execution
    for (const toolCall of toolCallResponse.functionCalls) {
      const decision = await executeGuardedTool(
        toolCall.name,
        toolCall.args,
        daysOverdue,
        toolCallResponse.source
      );
      decisions.push(decision);
    }
  }

  return {
    simulatedDate: simulatedNow.toISOString().split('T')[0],
    invoicesEvaluated: openInvoices.length,
    decisions,
    skippedInvoices,
  };
}

