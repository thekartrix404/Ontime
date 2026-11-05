import { NextRequest, NextResponse } from 'next/server';
import { extractInvoice } from '@/lib/extract';
import { getDb } from '@/lib/db';
import { scoreClient, PastInvoice } from '@/lib/risk';
import { proposeTerms } from '@/lib/terms';
import { explainRecommendation } from '@/lib/explain';
import { getSimulatedNow } from '@/lib/clock';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailText = body?.emailText;

    if (!emailText || typeof emailText !== 'string' || !emailText.trim()) {
      return NextResponse.json(
        { error: 'Email text is required' },
        { status: 400 }
      );
    }

    // 1. Extract invoice using Gemini LLM
    const extraction = await extractInvoice(emailText);

    if (!extraction.data && !extraction.success) {
      return NextResponse.json(
        {
          error: extraction.error || 'Failed to extract invoice data from email',
          extraction,
        },
        { status: 422 }
      );
    }

    const extractedData = extraction.data!;

    // 2. Match client in DB by email (case-insensitive)
    const db = getDb();
    let clientRow: any = null;
    let pastInvoices: PastInvoice[] = [];

    if (extractedData.client_email) {
      clientRow = db
        .prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE')
        .get(extractedData.client_email);

      if (clientRow) {
        const rows = db
          .prepare(
            `SELECT i.amount, i.due_date as dueDate, p.payment_date as paidDate, i.status
             FROM invoices i
             LEFT JOIN payments p ON p.invoice_id = i.id
             WHERE i.client_id = ?
             ORDER BY i.issue_date DESC`
          )
          .all(clientRow.id) as any[];

        pastInvoices = rows.map((r) => ({
          amount: r.amount,
          dueDate: r.dueDate,
          paidDate: r.paidDate,
          status: r.status,
        }));
      }
    }

    // 3. Compute total amount in code (NO LLM math)
    const lineItems = extractedData.line_items || [];
    const totalCents = lineItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 1;
      const unitCents = Math.round((Number(item.unit_price) || 0) * 100);
      return sum + qty * unitCents;
    }, 0);
    const totalAmount = (totalCents / 100).toFixed(2);

    // 4. Rules-based risk engine
    const riskResult = scoreClient(pastInvoices, totalAmount);

    // 5. Terms strategist
    const proposedTerms = proposeTerms(riskResult.level, totalAmount);

    // Standard baseline terms
    const originalTerms = {
      summary: 'Net-30',
      description: `Full amount ($${totalAmount}) due within 30 days of completion. No deposit or early-pay incentive.`,
      netDays: 30,
      totalAmount,
    };

    // 6. Explain recommendation with real DB numbers
    const explanation = await explainRecommendation(
      riskResult.score,
      riskResult.level,
      riskResult.reasons,
      proposedTerms,
      riskResult.metrics
    );

    // 7. Log draft created audit event for guided demo tracking
    const realTime = new Date().toISOString();
    const simulatedNow = getSimulatedNow().toISOString();
    const clientDisplayName = extractedData.client_name || extractedData.company || clientRow?.name || 'Client';
    const draftDetails = {
      summaryText: `Extracted draft invoice from client email for ${clientDisplayName} ($${totalAmount} ${extractedData.currency || 'USD'}, risk level: ${riskResult.level.toUpperCase()}).`,
      clientName: clientDisplayName,
      company: extractedData.company || clientRow?.company,
      totalAmount,
      riskLevel: riskResult.level,
      source: extraction.source || 'gemini-live',
    };

    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `audit_draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      'DRAFT_CREATED',
      'draft',
      clientRow?.id || 'new_client',
      JSON.stringify(draftDetails),
      realTime,
      simulatedNow,
      0,
      realTime
    );

    return NextResponse.json({
      extraction,
      client: {
        id: clientRow?.id || null,
        name: extractedData.client_name || clientRow?.name || null,
        company: extractedData.company || clientRow?.company || null,
        email: extractedData.client_email || clientRow?.email || null,
        isNew: !clientRow,
      },
      totalAmount,
      risk: riskResult,
      proposedTerms,
      originalTerms,
      explanation: typeof explanation === 'string' ? explanation : explanation.text,
      explanationSource: (explanation as any).source || 'gemini-live',
    });
  } catch (err: any) {
    console.error('Error in /api/draft:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error processing invoice draft' },
      { status: 500 }
    );
  }
}
