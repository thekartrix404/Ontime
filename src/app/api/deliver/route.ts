import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { getPaymentProvider, ensureEnvLoaded } from '@/lib/paypal';

ensureEnvLoaded();

function extractPayerViewUrl(invoiceData: any, paypalId: string): string {
  if (invoiceData?.detail?.metadata?.payer_view_url) {
    return invoiceData.detail.metadata.payer_view_url;
  }
  const payerLink = invoiceData?.links?.find((l: any) => l.rel === 'payer-view');
  if (payerLink?.href) {
    return payerLink.href;
  }
  return `https://www.sandbox.paypal.com/invoice/payer-view/details/${encodeURIComponent(paypalId)}`;
}

export async function POST(req: NextRequest) {
  try {
    ensureEnvLoaded();
    const body = await req.json();
    const { invoiceId, projectId } = body;

    if (!invoiceId && !projectId) {
      return NextResponse.json(
        { error: 'invoiceId or projectId is required' },
        { status: 400 }
      );
    }

    const db = getDb();
    let invoice: any = null;

    if (invoiceId) {
      invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    } else if (projectId) {
      invoice = db
        .prepare("SELECT * FROM invoices WHERE project_id = ? AND status = 'DRAFT'")
        .get(projectId);
    }

    if (!invoice) {
      return NextResponse.json(
        { error: 'Draft delivery invoice not found' },
        { status: 404 }
      );
    }

    if (invoice.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `Invoice is already in '${invoice.status}' state` },
        { status: 400 }
      );
    }

    const provider = getPaymentProvider();
    const ppId = invoice.paypal_invoice_id;

    // Send the draft invoice via PayPal API
    await provider.sendInvoice(ppId, {
      sendToRecipient: true,
      subject: `Final Balance Invoice ${invoice.invoice_number} (Project Delivered)`,
      note: invoice.notes || 'Project delivered. Please complete payment for the remaining balance.',
    });

    // Update status in local database to SENT
    db.prepare("UPDATE invoices SET status = 'SENT' WHERE id = ?").run(invoice.id);

    // Write audit log entry in plain English
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id) as any;
    const auditMsg = `Project delivered! Sent final balance invoice ${invoice.invoice_number} for $${invoice.amount} ${invoice.currency} to ${client?.name || 'client'} (${client?.email || ''}). PayPal ID: ${ppId}.`;

    db.prepare(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
       VALUES (?, 'PROJECT_DELIVERED_INVOICE_SENT', 'invoice', ?, ?, CURRENT_TIMESTAMP)`
    ).run('audit_' + crypto.randomUUID().slice(0, 8), invoice.id, auditMsg);

    // Fetch PayPal representation to get fresh payer view link
    let payerViewUrl: string;
    try {
      const fetched = await provider.getInvoice(ppId);
      payerViewUrl = extractPayerViewUrl(fetched, ppId);
    } catch {
      payerViewUrl = `https://www.sandbox.paypal.com/invoice/payer-view/details/${encodeURIComponent(ppId)}`;
    }

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'SENT',
        terms: invoice.terms,
        paypal_invoice_id: ppId,
        payer_view_url: payerViewUrl,
        project_id: invoice.project_id,
        client_email: client?.email,
      },
      audit: auditMsg,
    });
  } catch (err: any) {
    console.error('Error in /api/deliver:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to mark delivered and send balance invoice' },
      { status: 500 }
    );
  }
}
