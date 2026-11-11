import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getPaymentProviderForInvoice,
  getProviderNameForInvoice,
  ensureEnvLoaded,
} from '@/lib/paypal';
import { getSimulatedNow, computeDaysOverdue } from '@/lib/clock';

ensureEnvLoaded();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const invoiceId = body.invoiceId;

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
    }

    const db = getDb();
    const invoice = db.prepare(`
      SELECT i.*, c.name as client_name, c.company
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      WHERE i.id = ?
    `).get(invoiceId) as any;

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const simulatedNow = getSimulatedNow();
    const paymentDate = simulatedNow.toISOString().split('T')[0];

    // Must use provider that created the invoice; never silently fall back when PAYPAL_MODE=sandbox
    const provider = getPaymentProviderForInvoice(invoice);
    const expectedProvider = getProviderNameForInvoice(invoice);

    let paypalPaymentResult: any = null;
    let providerUsed = expectedProvider;

    if (invoice.paypal_invoice_id) {
      try {
        paypalPaymentResult = await provider.recordPayment(invoice.paypal_invoice_id, {
          amount: invoice.amount,
          currency: invoice.currency || 'USD',
          paymentDate,
          method: 'PAYPAL',
          note: 'Marked as paid via OnTime dashboard',
        });
        providerUsed = paypalPaymentResult?.providerUsed || expectedProvider;
      } catch (err: any) {
        console.error(`[recordPayment] PayPal call error for ${invoiceId}:`, err);
        if (process.env.PAYPAL_MODE === 'sandbox') {
          return NextResponse.json(
            { error: `Failed to record payment in PayPal Sandbox: ${err.message}` },
            { status: 500 }
          );
        }
      }
    }

    // Update invoice status to MARKED_AS_PAID
    db.prepare(`
      UPDATE invoices
      SET status = 'MARKED_AS_PAID'
      WHERE id = ?
    `).run(invoiceId);

    // Insert payment record
    const paymentId = `pay_${Date.now()}`;
    db.prepare(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, payment_method, reference_id, created_at)
      VALUES (?, ?, ?, ?, 'PAYPAL', ?, CURRENT_TIMESTAMP)
    `).run(
      paymentId,
      invoiceId,
      invoice.amount,
      paymentDate,
      paypalPaymentResult?.payment_id || `MANUAL-${Date.now()}`
    );

    // Record audit row
    const auditId = `audit_pay_${Date.now()}`;
    const clientName = invoice.client_name || invoice.company || 'Client';
    if (paypalPaymentResult?.providerUsed) {
      providerUsed = paypalPaymentResult.providerUsed;
    }
    const realTime = new Date().toISOString();
    const simulatedTime = simulatedNow.toISOString();
    const daysOverdue = computeDaysOverdue(invoice.due_date, simulatedNow);

    const auditDetails = {
      timestamp: realTime,
      realTime,
      simulatedTime,
      daysOverdue,
      action: 'PAYMENT_RECORDED',
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      clientName,
      amount: invoice.amount,
      providerUsed,
      summaryText: `Recorded payment of $${invoice.amount} for invoice ${invoice.invoice_number} (${clientName}) via PayPal [${providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}]. Status set to MARKED_AS_PAID.`,
      approvedBy: 'user',
    };

    db.prepare(`
      INSERT INTO audit_log (id, action, entity_type, entity_id, details, real_time, simulated_time, days_overdue, created_at)
      VALUES (?, 'PAYMENT_RECORDED', 'invoice', ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      invoiceId,
      JSON.stringify(auditDetails),
      realTime,
      simulatedTime,
      daysOverdue,
      realTime
    );

    return NextResponse.json({
      success: true,
      invoiceId,
      status: 'MARKED_AS_PAID',
      paymentId,
    });
  } catch (err: any) {
    console.error('Failed to mark invoice as paid:', err);
    return NextResponse.json({ error: err.message || 'Payment recording failed' }, { status: 500 });
  }
}

