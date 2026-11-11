import { mandate } from './mandate';
import { getDb } from './db';
import {
  getPaymentProviderForInvoice,
  getProviderNameForInvoice,
  ensureEnvLoaded,
} from './paypal';
import { computeDaysOverdue, getSimulatedNow } from './clock';
import { LlmSource } from './llm';

ensureEnvLoaded();

function generateUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export interface GuardDecision {
  id: string;
  timestamp: string;
  realTime?: string;
  simulatedTime?: string;
  tool: string;
  args: Record<string, any>;
  decision: 'allowed' | 'blocked' | 'queued_review';
  ruleApplied: string;
  approvedBy: 'auto' | 'user' | 'none';
  invoiceId: string;
  clientName: string;
  invoiceNumber: string;
  amount: string;
  daysOverdue: number;
  summaryText: string;
  source: LlmSource;
  providerUsed?: 'sandbox' | 'mock';
  executed: boolean;
  execution?: 'FAILED' | 'SUCCESS';
  sendFailed?: boolean;
  error?: string;
}

/**
 * Runs before any agent tool executes. Enforces safety and mandate boundaries.
 */
export async function executeGuardedTool(
  tool: string,
  args: Record<string, any>,
  daysOverdueContext?: number,
  source: LlmSource = 'gemini-live'
): Promise<GuardDecision> {
  const db = getDb();
  const invoiceId = args.invoiceId;

  // Retrieve invoice & client info
  const invoiceRow = db.prepare(`
    SELECT i.*, c.name as client_name, c.company, c.email as client_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ?
  `).get(invoiceId) as any;

  if (!invoiceRow) {
    throw new Error(`Invoice not found for guarded execution: ${invoiceId}`);
  }

  const daysOverdue = daysOverdueContext !== undefined
    ? daysOverdueContext
    : computeDaysOverdue(invoiceRow.due_date);

  const timestamp = new Date().toISOString();
  const decisionId = `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const clientName = invoiceRow.client_name || invoiceRow.company || 'Client';
  const invoiceNumber = invoiceRow.invoice_number;
  const amount = invoiceRow.amount;

  let decision: 'allowed' | 'blocked' | 'queued_review' = 'blocked';
  let ruleApplied = '';
  let approvedBy: 'auto' | 'user' | 'none' = 'none';
  let summaryText = '';
  let executed = false;
  let executionError: string | undefined;
  let providerUsed: 'sandbox' | 'mock' | undefined = undefined;

  if (tool === 'send_reminder') {
    const tone = (args.tone || 'neutral').toLowerCase();
    const isAutoAllowed = mandate.autoSendTones.includes(tone);

    if (isAutoAllowed) {
      decision = 'allowed';
      ruleApplied = `Rule 'autoSendTones allowed': tone '${tone}' is permitted for automated sending`;
      approvedBy = 'auto';

      // 1. PROVIDER MISMATCH: use provider that created the invoice
      const provider = getPaymentProviderForInvoice(invoiceRow);
      const expectedProvider = getProviderNameForInvoice(invoiceRow);
      providerUsed = expectedProvider;

      // 2. STATUS SYNC: before sending a reminder, GET the invoice from PayPal and update DB status
      let isAlreadyPaid = false;
      if (invoiceRow.paypal_invoice_id) {
        try {
          const remoteInv = await provider.getInvoice(invoiceRow.paypal_invoice_id);
          const remoteStatus = remoteInv?.status;
          if (remoteStatus) {
            db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(remoteStatus, invoiceId);
            invoiceRow.status = remoteStatus;
          }
          if (['PAID', 'MARKED_AS_PAID', 'CANCELLED'].includes(remoteStatus)) {
            isAlreadyPaid = true;
          }
        } catch (syncErr: any) {
          console.warn(`[Guard] Status sync check error for invoice ${invoiceId}:`, syncErr.message);
        }
      }

      if (['PAID', 'MARKED_AS_PAID', 'CANCELLED'].includes(invoiceRow.status)) {
        isAlreadyPaid = true;
      }

      if (isAlreadyPaid) {
        executed = false;
        summaryText = `Day ${daysOverdue}: skipped: invoice already paid for ${clientName} (${invoiceNumber}). Status: ${invoiceRow.status}.`;
      } else {
        // Execute: send via PayPal
        try {
          if (invoiceRow.paypal_invoice_id) {
            const remindRes = await provider.remindInvoice(invoiceRow.paypal_invoice_id, {
              subject: args.subject || `Payment Reminder: Invoice ${invoiceNumber}`,
              note: args.message,
            });
            providerUsed = remindRes?.providerUsed || expectedProvider;
          }
          executed = true;

          summaryText = `Day ${daysOverdue}: Sent ${tone} reminder to ${clientName} for invoice ${invoiceNumber} ($${amount}) via PayPal [${providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}].`;

          // Record followup in DB with source
          db.prepare(`
            INSERT INTO followups (id, invoice_id, tone, channel, message, status, source, sent_at, created_at)
            VALUES (?, ?, ?, 'email', ?, 'SENT', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(generateUniqueId('flw'), invoiceId, tone, args.message, source);

        } catch (err: any) {
          // 3. FAILED SENDS: record guard decision as "allowed" but execution as FAILED
          executed = false;
          executionError = err.message || 'PayPal remind failed';
          summaryText = `Day ${daysOverdue}: Attempted to send ${tone} reminder to ${clientName} via PayPal, but encountered error: ${executionError}`;
          console.error(`[Guard] Failed to send PayPal reminder for invoice ${invoiceId}:`, err);
          // Do NOT mark this stage as handled in followups so it can be retried
        }
      }
    } else {
      decision = 'blocked';
      ruleApplied = `Rule '${tone} tone needs approval': tone '${tone}' requires human review`;
      approvedBy = 'none';
      summaryText = `Day ${daysOverdue}: the agent tried to send a ${tone} reminder to ${clientName}; blocked by your rule '${tone} tone needs approval'; sent to your approval queue.`;

      // Save to approval queue with source
      const queueId = generateUniqueId('q');
      db.prepare(`
        INSERT INTO approval_queue (id, invoice_id, tool, tone, subject, message, status, rule_blocked, source, created_at)
        VALUES (?, ?, 'send_reminder', ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)
      `).run(queueId, invoiceId, tone, args.subject || `Payment Reminder: ${invoiceNumber}`, args.message, ruleApplied, source);

      // Record pending followup with source
      db.prepare(`
        INSERT INTO followups (id, invoice_id, tone, channel, message, status, source, created_at)
        VALUES (?, ?, ?, 'email', ?, 'PENDING_APPROVAL', ?, CURRENT_TIMESTAMP)
      `).run(generateUniqueId('flw'), invoiceId, tone, args.message, source);
    }

  } else if (tool === 'draft_escalation') {
    const tone = (args.tone || 'formal').toLowerCase();
    decision = 'queued_review';
    ruleApplied = `Rule 'escalations require review': draft_escalation never auto-sends and is queued for human review`;
    approvedBy = 'none';
    summaryText = `Day ${daysOverdue}: the agent drafted an escalation for ${clientName} (${tone} tone); queued for human review per mandate rule.`;

    // Save to approval queue with source
    const queueId = generateUniqueId('q');
    db.prepare(`
      INSERT INTO approval_queue (id, invoice_id, tool, tone, subject, message, status, rule_blocked, source, created_at)
      VALUES (?, ?, 'draft_escalation', ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)
    `).run(queueId, invoiceId, tone, `Formal Escalation: ${invoiceNumber}`, args.message, ruleApplied, source);

    db.prepare(`
      INSERT INTO followups (id, invoice_id, tone, channel, message, status, source, created_at)
      VALUES (?, ?, ?, 'email', ?, 'PENDING_APPROVAL', ?, CURRENT_TIMESTAMP)
    `).run(generateUniqueId('flw'), invoiceId, tone, args.message, source);

  } else if (tool === 'propose_late_fee') {
    const percent = Number(args.percent) || 0;
    if (percent > mandate.maxLateFeePercent) {
      decision = 'blocked';
      ruleApplied = `Rule 'maxLateFeePercent': proposed ${percent}% late fee exceeds the maximum of ${mandate.maxLateFeePercent}%`;
      approvedBy = 'none';
      summaryText = `Day ${daysOverdue}: the agent proposed a ${percent}% late fee for ${clientName}; blocked by your rule 'max late fee ${mandate.maxLateFeePercent}%'.`;
    } else {
      decision = 'queued_review';
      ruleApplied = `Rule 'late fee proposal requires approval': proposed ${percent}% late fee saved for review`;
      approvedBy = 'none';
      summaryText = `Day ${daysOverdue}: the agent proposed a ${percent}% late fee ($${((Number(amount) * percent) / 100).toFixed(2)}) for ${clientName}; queued for human review.`;

      const queueId = generateUniqueId('q');
      db.prepare(`
        INSERT INTO approval_queue (id, invoice_id, tool, tone, subject, message, proposed_late_fee_percent, status, rule_blocked, source, created_at)
        VALUES (?, ?, 'propose_late_fee', 'formal', ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)
      `).run(
        queueId,
        invoiceId,
        `Proposed Late Fee (${percent}%): ${invoiceNumber}`,
        `Proposed late fee of ${percent}% on invoice balance of $${amount}.`,
        percent,
        ruleApplied,
        source
      );
    }
  }

  const realTime = timestamp;
  const simulatedTime = getSimulatedNow().toISOString();

  // Record audit row
  const guardDecisionObj: GuardDecision = {
    id: decisionId,
    timestamp,
    realTime,
    simulatedTime,
    tool,
    args,
    decision,
    ruleApplied,
    approvedBy,
    invoiceId,
    clientName,
    invoiceNumber,
    amount,
    daysOverdue,
    summaryText,
    source,
    providerUsed,
    executed,
    execution: executionError ? 'FAILED' : (executed ? 'SUCCESS' : undefined),
    sendFailed: !!executionError,
    error: executionError,
  };

  const actionName =
    decision === 'allowed'
      ? 'GUARD_ALLOWED'
      : decision === 'queued_review'
      ? 'GUARD_QUEUED'
      : 'GUARD_BLOCKED';

  db.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decisionId,
    actionName,
    'invoice',
    invoiceId,
    JSON.stringify(guardDecisionObj),
    realTime,
    simulatedTime,
    daysOverdue,
    realTime
  );

  return guardDecisionObj;
}

/**
 * User approves an item from the approval queue.
 */
export async function approveQueueItem(queueId: string): Promise<any> {
  const db = getDb();
  const item = db.prepare(`
    SELECT q.*, i.paypal_invoice_id, i.invoice_number, i.amount, i.due_date, i.status as invoice_status, i.provider, c.name as client_name
    FROM approval_queue q
    JOIN invoices i ON i.id = q.invoice_id
    JOIN clients c ON c.id = i.client_id
    WHERE q.id = ?
  `).get(queueId) as any;

  if (!item) {
    throw new Error(`Queue item not found: ${queueId}`);
  }

  if (item.status !== 'PENDING') {
    throw new Error(`Queue item is already ${item.status}`);
  }

  const provider = getPaymentProviderForInvoice(item);
  const providerName = getProviderNameForInvoice(item);
  let providerUsed: 'sandbox' | 'mock' = providerName;

  // STATUS SYNC: before sending reminder on approval, check PayPal status
  let isAlreadyPaid = false;
  if (item.paypal_invoice_id) {
    try {
      const remoteInv = await provider.getInvoice(item.paypal_invoice_id);
      const remoteStatus = remoteInv?.status;
      if (remoteStatus) {
        db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(remoteStatus, item.invoice_id);
        item.invoice_status = remoteStatus;
      }
      if (['PAID', 'MARKED_AS_PAID', 'CANCELLED'].includes(remoteStatus)) {
        isAlreadyPaid = true;
      }
    } catch (syncErr: any) {
      console.warn(`[approveQueueItem] Status sync check error for ${item.invoice_id}:`, syncErr.message);
    }
  }

  if (['PAID', 'MARKED_AS_PAID', 'CANCELLED'].includes(item.invoice_status)) {
    isAlreadyPaid = true;
  }

  const realTime = new Date().toISOString();
  const simulatedTime = getSimulatedNow().toISOString();
  const daysOverdue = item.due_date ? computeDaysOverdue(item.due_date) : 0;
  const auditId = `audit_appr_${Date.now()}`;

  if (isAlreadyPaid) {
    db.prepare(`
      UPDATE approval_queue
      SET status = 'SKIPPED'
      WHERE id = ?
    `).run(queueId);

    const summaryText = `skipped: invoice already paid for ${item.client_name} (${item.invoice_number}). Status: ${item.invoice_status}.`;
    const details = {
      timestamp: realTime,
      realTime,
      simulatedTime,
      daysOverdue,
      tool: item.tool,
      action: 'USER_APPROVAL',
      approvedBy: 'user',
      queueId,
      invoiceId: item.invoice_id,
      source: item.source || 'gemini-live',
      providerUsed,
      summaryText,
    };

    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
      VALUES (?, 'USER_APPROVAL', 'invoice', ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      item.invoice_id,
      JSON.stringify(details),
      realTime,
      simulatedTime,
      daysOverdue,
      realTime
    );

    return {
      success: true,
      queueId,
      approvedBy: 'user',
      providerUsed,
      status: 'SKIPPED',
      skipped: true,
      reason: 'skipped: invoice already paid',
    };
  }

  // If it's a reminder or escalation, send via PayPal remind
  if (item.paypal_invoice_id) {
    const remindRes = await provider.remindInvoice(item.paypal_invoice_id, {
      subject: item.subject || `Payment Reminder: ${item.invoice_number}`,
      note: item.message,
    });
    providerUsed = remindRes?.providerUsed || providerName;
  }

  // Update queue item
  db.prepare(`
    UPDATE approval_queue
    SET status = 'APPROVED'
    WHERE id = ?
  `).run(queueId);

  // Update associated followups
  db.prepare(`
    UPDATE followups
    SET status = 'SENT', sent_at = CURRENT_TIMESTAMP
    WHERE invoice_id = ? AND message = ?
  `).run(item.invoice_id, item.message);

  // Log audit row with approved_by=user and providerUsed
  const details = {
    timestamp: realTime,
    realTime,
    simulatedTime,
    daysOverdue,
    tool: item.tool,
    action: 'USER_APPROVAL',
    approvedBy: 'user',
    queueId,
    invoiceId: item.invoice_id,
    source: item.source || 'gemini-live',
    providerUsed,
    summaryText: `User manually approved queued ${item.tone || item.tool} communication for ${item.client_name} (${item.invoice_number}). Sent via PayPal [${providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}].`,
  };

  db.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    auditId,
    'USER_APPROVAL',
    'invoice',
    item.invoice_id,
    JSON.stringify(details),
    realTime,
    simulatedTime,
    daysOverdue,
    realTime
  );

  return { success: true, queueId, approvedBy: 'user', providerUsed };
}

/**
 * User rejects an item from the approval queue.
 */
export function rejectQueueItem(queueId: string): any {
  const db = getDb();
  const item = db.prepare(`
    SELECT q.*, i.invoice_number, c.name as client_name
    FROM approval_queue q
    JOIN invoices i ON i.id = q.invoice_id
    JOIN clients c ON c.id = i.client_id
    WHERE q.id = ?
  `).get(queueId) as any;

  if (!item) {
    throw new Error(`Queue item not found: ${queueId}`);
  }

  db.prepare(`
    UPDATE approval_queue
    SET status = 'REJECTED'
    WHERE id = ?
  `).run(queueId);

  db.prepare(`
    UPDATE followups
    SET status = 'REJECTED'
    WHERE invoice_id = ? AND message = ?
  `).run(item.invoice_id, item.message);

  const realTime = new Date().toISOString();
  const simulatedTime = getSimulatedNow().toISOString();
  const daysOverdue = item.due_date ? computeDaysOverdue(item.due_date) : 0;

  const auditId = `audit_rej_${Date.now()}`;
  const details = {
    timestamp: realTime,
    realTime,
    simulatedTime,
    daysOverdue,
    tool: item.tool,
    action: 'USER_REJECTION',
    approvedBy: 'user',
    queueId,
    invoiceId: item.invoice_id,
    summaryText: `User rejected queued ${item.tone || item.tool} communication for ${item.client_name} (${item.invoice_number}).`,
  };

  db.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    auditId,
    'USER_REJECTION',
    'invoice',
    item.invoice_id,
    JSON.stringify(details),
    realTime,
    simulatedTime,
    daysOverdue,
    realTime
  );

  return { success: true, queueId, status: 'REJECTED' };
}
