import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSimulatedNow, computeDaysOverdue } from '@/lib/clock';
import { getMandateRules } from '@/lib/mandate';

export async function GET() {
  try {
    const db = getDb();
    const simulatedNow = getSimulatedNow();

    // Invoices list with client and project links
    const invoicesRaw = db.prepare(`
      SELECT
        i.*,
        c.name as client_name,
        c.company as client_company,
        c.email as client_email
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ORDER BY i.created_at DESC
    `).all() as any[];

    // Calculate days overdue and linked invoices
    const invoices = invoicesRaw.map((inv) => {
      const daysOverdue = computeDaysOverdue(inv.due_date, simulatedNow);
      let linkedInvoice: any = null;
      if (inv.project_id) {
        const other = invoicesRaw.find((o) => o.project_id === inv.project_id && o.id !== inv.id);
        if (other) {
          linkedInvoice = {
            id: other.id,
            invoiceNumber: other.invoice_number,
            amount: other.amount,
            status: other.status,
            type: inv.notes?.toLowerCase().includes('deposit') ? 'Balance' : 'Deposit',
          };
        }
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        clientId: inv.client_id,
        clientName: inv.client_name,
        company: inv.client_company,
        amount: inv.amount,
        currency: inv.currency,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        status: inv.status,
        terms: inv.terms,
        notes: inv.notes,
        paypalInvoiceId: inv.paypal_invoice_id,
        projectId: inv.project_id,
        daysOverdue,
        linkedInvoice,
      };
    });

    // Approval queue items (PENDING)
    const queueRaw = db.prepare(`
      SELECT
        q.*,
        i.invoice_number,
        i.amount,
        c.name as client_name,
        c.company as client_company
      FROM approval_queue q
      JOIN invoices i ON i.id = q.invoice_id
      JOIN clients c ON c.id = i.client_id
      WHERE q.status = 'PENDING'
      ORDER BY q.created_at DESC
    `).all() as any[];

    const approvalQueue = queueRaw.map((item) => ({
      id: item.id,
      invoiceId: item.invoice_id,
      invoiceNumber: item.invoice_number,
      clientName: item.client_name || item.client_company,
      amount: item.amount,
      tool: item.tool,
      tone: item.tone,
      subject: item.subject,
      message: item.message,
      ruleBlocked: item.rule_blocked,
      proposedLateFeePercent: item.proposed_late_fee_percent,
      source: item.source || 'gemini-live',
      createdAt: item.created_at,
    }));

    // Recent activity: guard decisions ONLY per mandate requirement
    const auditRaw = db.prepare(`
      SELECT *
      FROM audit_log
      WHERE action IN ('GUARD_ALLOWED', 'GUARD_BLOCKED', 'GUARD_QUEUED')
      ORDER BY COALESCE(real_time, created_at) DESC
      LIMIT 25
    `).all() as any[];

    const agentActivity = auditRaw.map((row) => {
      let parsedDetails: any = null;
      try {
        parsedDetails = JSON.parse(row.details);
      } catch {
        parsedDetails = { summaryText: row.details };
      }

      const realTime = row.real_time || row.created_at;
      const simulatedTime = row.simulated_time || (parsedDetails && parsedDetails.simulatedTime) || (parsedDetails && parsedDetails.timestamp) || realTime;
      const daysOverdue = row.days_overdue !== null && row.days_overdue !== undefined
        ? row.days_overdue
        : (parsedDetails && typeof parsedDetails.daysOverdue === 'number' ? parsedDetails.daysOverdue : null);

      let summaryText = parsedDetails.summaryText || row.details;
      if (typeof summaryText === 'string' && summaryText.trim().startsWith('{')) {
        try {
          const inner = JSON.parse(summaryText);
          summaryText = inner.summaryText || 'Agent activity logged';
        } catch {
          // ignore
        }
      }

      const decision: 'allowed' | 'blocked' | 'queued_review' =
        row.action === 'GUARD_ALLOWED'
          ? 'allowed'
          : row.action === 'GUARD_QUEUED'
          ? 'queued_review'
          : 'blocked';

      return {
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        timestamp: realTime,
        realTime,
        simulatedTime,
        daysOverdue,
        details: parsedDetails,
        summaryText,
        decision,
        tool: parsedDetails.tool || 'system',
        source: parsedDetails.source || (row.action.includes('GUARD') ? 'gemini-live' : undefined),
        providerUsed: parsedDetails.providerUsed,
      };
    });

    // Real audit events for guided demo checklist tracking
    const auditActions = (db.prepare('SELECT DISTINCT action FROM audit_log').all() as any[]).map((r) => r.action);
    const demoEvents = {
      draftCreated: auditActions.includes('DRAFT_CREATED'),
      termsApproved: auditActions.some((a: string) => a.startsWith('TERMS_APPROVED') || a === 'INVOICE_SENT_AS_IS'),
      guardAllowed: auditActions.includes('GUARD_ALLOWED'),
      guardBlocked: auditActions.includes('GUARD_BLOCKED'),
      userApproval: auditActions.includes('USER_APPROVAL'),
      paymentRecorded: auditActions.includes('PAYMENT_RECORDED'),
    };

    return NextResponse.json({
      simulatedDate: simulatedNow.toISOString().split('T')[0],
      simulatedFullDate: simulatedNow.toISOString(),
      invoices,
      approvalQueue,
      agentActivity,
      demoEvents,
      mandateRules: getMandateRules(),
    });
  } catch (err: any) {
    console.error('Failed to get dashboard data:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch dashboard data' }, { status: 500 });
  }
}

