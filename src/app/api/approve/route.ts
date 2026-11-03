import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import {
  getPaymentProvider,
  CreateInvoiceInput,
  ensureEnvLoaded,
} from '@/lib/paypal';
import { RiskLevel } from '@/lib/risk';
import { proposeTerms } from '@/lib/terms';

ensureEnvLoaded();

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

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

    const {
      client_name,
      company,
      client_email,
      currency = 'USD',
      project_type,
      line_items,
      terms_mode = 'PROPOSED', // 'PROPOSED' | 'AS_IS'
      risk_level = 'low',      // 'low' | 'medium' | 'high'
    } = body;

    if (!client_email || !line_items || line_items.length === 0) {
      return NextResponse.json(
        { error: 'client_email and at least one line item are required' },
        { status: 400 }
      );
    }

    // DEMO SAFETY: always send to process.env.PAYPAL_TEST_CLIENT_EMAIL, never to extracted client email
    const demoClientEmail =
      process.env.PAYPAL_TEST_CLIENT_EMAIL || 'sb-yxz2w53641592@personal.example.com';

    // 1. Compute total money in code (NEVER with LLM)
    const totalCents = line_items.reduce((sum: number, item: any) => {
      const qty = Number(item.quantity) || 1;
      const unitCents = Math.round((Number(item.unit_price) || 0) * 100);
      return sum + qty * unitCents;
    }, 0);
    const totalAmount = (totalCents / 100).toFixed(2);

    const db = getDb();

    // 2. Ensure client exists in database
    let client = db
      .prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE')
      .get(client_email) as any;

    if (!client) {
      const newClientId = 'client_' + crypto.randomUUID().slice(0, 8);
      db.prepare(
        `INSERT INTO clients (id, name, email, company, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        newClientId,
        client_name || company || 'Client',
        client_email,
        company || null
      );
      client = {
        id: newClientId,
        name: client_name || company || 'Client',
        email: client_email,
        company: company || null,
      };
    } else if (company && !client.company) {
      db.prepare('UPDATE clients SET company = ? WHERE id = ?').run(company, client.id);
      client.company = company;
    }

    const provider = getPaymentProvider();
    const todayStr = new Date().toISOString().split('T')[0];
    const createdInvoices: any[] = [];
    const auditLogs: string[] = [];

    // -----------------------------------------------------------------
    // Mode A: SEND AS-IS (Standard single invoice, Net-30)
    // -----------------------------------------------------------------
    if (terms_mode === 'AS_IS') {
      const dueDateStr = addDays(new Date(), 30);
      const invoiceNumber = await (provider.generateNextInvoiceNumber
        ? provider.generateNextInvoiceNumber()
        : `INV-${Date.now()}`);

      const createInput: CreateInvoiceInput = {
        recipientEmail: demoClientEmail,
        recipientName: {
          given_name: client_name || client.name || 'Valued Client',
        },
        currency,
        invoiceNumber,
        invoiceDate: todayStr,
        dueDate: dueDateStr,
        termType: 'DUE_ON_DATE_SPECIFIED',
        note: `Standard terms. Full payment of $${totalAmount} due within 30 days (${dueDateStr}).`,
        items: line_items.map((item: any) => ({
          name: item.description,
          quantity: String(item.quantity || 1),
          unit_amount: {
            currency_code: currency,
            value: Number(item.unit_price).toFixed(2),
          },
        })),
      };

      const ppInvoice = await provider.createInvoice(createInput);
      const ppId = ppInvoice.id;

      // Send immediately
      await provider.sendInvoice(ppId, {
        sendToRecipient: true,
        subject: `Invoice ${invoiceNumber} from OnTime`,
        note: createInput.note,
      });

      const payerViewUrl = extractPayerViewUrl(ppInvoice, ppId);
      const localInvoiceId = 'inv_' + crypto.randomUUID().slice(0, 8);

      db.prepare(
        `INSERT INTO invoices
         (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, paypal_invoice_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', 'Net-30', ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        localInvoiceId,
        client.id,
        invoiceNumber,
        totalAmount,
        currency,
        todayStr,
        dueDateStr,
        createInput.note,
        ppId
      );

      const providerTag = ` [Provider: ${ppInvoice?.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}]`;
      const auditMsg = `Sent standard invoice ${invoiceNumber} as-is for $${totalAmount} USD to ${client.name} (${client.email}). PayPal Invoice ID: ${ppId}.${providerTag}`;
      db.prepare(
        `INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'INVOICE_SENT_AS_IS', 'invoice', ?, ?, CURRENT_TIMESTAMP)`
      ).run('audit_' + crypto.randomUUID().slice(0, 8), localInvoiceId, auditMsg);

      return NextResponse.json({
        success: true,
        terms_mode: 'AS_IS',
        invoices: [
          {
            id: localInvoiceId,
            invoice_number: invoiceNumber,
            amount: totalAmount,
            currency,
            status: 'SENT',
            terms: 'Net-30',
            due_date: dueDateStr,
            paypal_invoice_id: ppId,
            payer_view_url: payerViewUrl,
            client_email: client.email, // Real email shown in UI
            demo_recipient_email: demoClientEmail,
          },
        ],
        audit: [auditMsg],
      });
    }

    // -----------------------------------------------------------------
    // Mode B: PROPOSED TERMS based on Risk Level
    // -----------------------------------------------------------------
    const proposed = proposeTerms(risk_level as RiskLevel, totalAmount);

    if (risk_level === 'low') {
      // LOW RISK: One invoice, Net-14
      const dueDateStr = addDays(new Date(), 14);
      const invoiceNumber = await (provider.generateNextInvoiceNumber
        ? provider.generateNextInvoiceNumber()
        : `INV-${Date.now()}`);

      const createInput: CreateInvoiceInput = {
        recipientEmail: demoClientEmail,
        recipientName: {
          given_name: client_name || client.name || 'Valued Client',
        },
        currency,
        invoiceNumber,
        invoiceDate: todayStr,
        dueDate: dueDateStr,
        termType: 'DUE_ON_DATE_SPECIFIED',
        note: `Net-14 payment terms. Full amount ($${totalAmount}) due within 14 days of invoice.`,
        items: line_items.map((item: any) => ({
          name: item.description,
          quantity: String(item.quantity || 1),
          unit_amount: {
            currency_code: currency,
            value: Number(item.unit_price).toFixed(2),
          },
        })),
      };

      const ppInvoice = await provider.createInvoice(createInput);
      const ppId = ppInvoice.id;

      await provider.sendInvoice(ppId, {
        sendToRecipient: true,
        subject: `Invoice ${invoiceNumber} (Net-14 terms)`,
        note: createInput.note,
      });

      const payerViewUrl = extractPayerViewUrl(ppInvoice, ppId);
      const localId = 'inv_' + crypto.randomUUID().slice(0, 8);

      db.prepare(
        `INSERT INTO invoices
         (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, paypal_invoice_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', 'Net-14', ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        localId,
        client.id,
        invoiceNumber,
        totalAmount,
        currency,
        todayStr,
        dueDateStr,
        createInput.note,
        ppId
      );

      const providerTag = ` [Provider: ${ppInvoice?.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}]`;
      const auditMsg = `Approved low-risk terms (Net-14). Created and sent PayPal invoice ${invoiceNumber} for $${totalAmount} USD to ${client.name} (${client.email}). PayPal ID: ${ppId}.${providerTag}`;
      db.prepare(
        `INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'TERMS_APPROVED_LOW', 'invoice', ?, ?, CURRENT_TIMESTAMP)`
      ).run('audit_' + crypto.randomUUID().slice(0, 8), localId, auditMsg);

      createdInvoices.push({
        id: localId,
        invoice_number: invoiceNumber,
        amount: totalAmount,
        currency,
        status: 'SENT',
        terms: 'Net-14',
        due_date: dueDateStr,
        paypal_invoice_id: ppId,
        payer_view_url: payerViewUrl,
        client_email: client.email,
        demo_recipient_email: demoClientEmail,
      });
      auditLogs.push(auditMsg);
    } else if (risk_level === 'medium') {
      // MEDIUM RISK: One invoice, Net-7 with 2% early-pay discount stated in invoice note
      const dueDateStr = addDays(new Date(), 7);
      const invoiceNumber = await (provider.generateNextInvoiceNumber
        ? provider.generateNextInvoiceNumber()
        : `INV-${Date.now()}`);

      const noteStr = `Net-7 payment terms with 2% early-pay discount. Pay $${proposed.discountedAmount} within 7 days (by ${dueDateStr}) to save $${proposed.discountAmount}, or full amount ($${totalAmount}) thereafter.`;

      const createInput: CreateInvoiceInput = {
        recipientEmail: demoClientEmail,
        recipientName: {
          given_name: client_name || client.name || 'Valued Client',
        },
        currency,
        invoiceNumber,
        invoiceDate: todayStr,
        dueDate: dueDateStr,
        termType: 'DUE_ON_DATE_SPECIFIED',
        note: noteStr,
        items: line_items.map((item: any) => ({
          name: item.description,
          quantity: String(item.quantity || 1),
          unit_amount: {
            currency_code: currency,
            value: Number(item.unit_price).toFixed(2),
          },
        })),
      };

      const ppInvoice = await provider.createInvoice(createInput);
      const ppId = ppInvoice.id;

      await provider.sendInvoice(ppId, {
        sendToRecipient: true,
        subject: `Invoice ${invoiceNumber} (Net-7 + 2% Early-Pay Discount)`,
        note: noteStr,
      });

      const payerViewUrl = extractPayerViewUrl(ppInvoice, ppId);
      const localId = 'inv_' + crypto.randomUUID().slice(0, 8);

      db.prepare(
        `INSERT INTO invoices
         (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, paypal_invoice_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', 'Net-7 + 2% discount', ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        localId,
        client.id,
        invoiceNumber,
        totalAmount,
        currency,
        todayStr,
        dueDateStr,
        noteStr,
        ppId
      );

      const providerTag = ` [Provider: ${ppInvoice?.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}]`;
      const auditMsg = `Approved medium-risk terms. Created and sent PayPal invoice ${invoiceNumber} for $${totalAmount} USD with Net-7 and 2% early discount ($${proposed.discountAmount} off) to ${client.name} (${client.email}). PayPal ID: ${ppId}.${providerTag}`;
      db.prepare(
        `INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'TERMS_APPROVED_MEDIUM', 'invoice', ?, ?, CURRENT_TIMESTAMP)`
      ).run('audit_' + crypto.randomUUID().slice(0, 8), localId, auditMsg);

      createdInvoices.push({
        id: localId,
        invoice_number: invoiceNumber,
        amount: totalAmount,
        currency,
        status: 'SENT',
        terms: 'Net-7 + 2% early discount',
        due_date: dueDateStr,
        paypal_invoice_id: ppId,
        payer_view_url: payerViewUrl,
        client_email: client.email,
        demo_recipient_email: demoClientEmail,
        discountAmount: proposed.discountAmount,
        discountedAmount: proposed.discountedAmount,
      });
      auditLogs.push(auditMsg);
    } else {
      // HIGH RISK: Two invoices linked by project_id
      // Send 40% deposit invoice now; create 60% balance invoice as DRAFT until "Mark delivered"
      const projectId = 'proj_' + Date.now();
      const depositAmount = proposed.depositAmount!;
      const deliveryAmount = proposed.deliveryAmount!;
      const projectName = project_type || 'Contract Project';

      // 1. Upfront Deposit Invoice (40%)
      const depositInvNumber = await (provider.generateNextInvoiceNumber
        ? provider.generateNextInvoiceNumber()
        : `INV-${Date.now()}-DEP`);

      const depositInput: CreateInvoiceInput = {
        recipientEmail: demoClientEmail,
        recipientName: {
          given_name: client_name || client.name || 'Valued Client',
        },
        currency,
        invoiceNumber: depositInvNumber,
        invoiceDate: todayStr,
        dueDate: todayStr,
        termType: 'DUE_ON_RECEIPT',
        note: `40% upfront deposit for ${projectName}. Required before project commencement.`,
        items: [
          {
            name: `${projectName} (40% Upfront Deposit)`,
            description: `40% deposit for ${projectName} (Total project value: $${totalAmount})`,
            quantity: '1',
            unit_amount: {
              currency_code: currency,
              value: depositAmount,
            },
          },
        ],
      };

      const ppDeposit = await provider.createInvoice(depositInput);
      const ppDepositId = ppDeposit.id;

      // Send the deposit invoice immediately
      await provider.sendInvoice(ppDepositId, {
        sendToRecipient: true,
        subject: `Deposit Invoice ${depositInvNumber} (40% Upfront Deposit)`,
        note: depositInput.note,
      });

      const depositPayerView = extractPayerViewUrl(ppDeposit, ppDepositId);
      const localDepositId = 'inv_' + crypto.randomUUID().slice(0, 8);

      db.prepare(
        `INSERT INTO invoices
         (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, paypal_invoice_id, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', '40% Deposit', ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        localDepositId,
        client.id,
        depositInvNumber,
        depositAmount,
        currency,
        todayStr,
        todayStr,
        depositInput.note,
        ppDepositId,
        projectId
      );

      // 2. Final Balance Invoice (60%) - KEEP AS DRAFT!
      const deliveryInvNumber = await (provider.generateNextInvoiceNumber
        ? provider.generateNextInvoiceNumber()
        : `INV-${Date.now()}-BAL`);

      const deliveryInput: CreateInvoiceInput = {
        recipientEmail: demoClientEmail,
        recipientName: {
          given_name: client_name || client.name || 'Valued Client',
        },
        currency,
        invoiceNumber: deliveryInvNumber,
        invoiceDate: todayStr,
        dueDate: todayStr,
        termType: 'DUE_ON_RECEIPT',
        note: `60% final balance for ${projectName}. Payable upon completion and final delivery.`,
        items: [
          {
            name: `${projectName} (60% Balance on Delivery)`,
            description: `Final 60% balance for ${projectName} upon completion and delivery.`,
            quantity: '1',
            unit_amount: {
              currency_code: currency,
              value: deliveryAmount,
            },
          },
        ],
      };

      const ppDelivery = await provider.createInvoice(deliveryInput);
      const ppDeliveryId = ppDelivery.id;
      const deliveryPayerView = extractPayerViewUrl(ppDelivery, ppDeliveryId);
      const localDeliveryId = 'inv_' + crypto.randomUUID().slice(0, 8);

      db.prepare(
        `INSERT INTO invoices
         (id, client_id, invoice_number, amount, currency, issue_date, due_date, status, terms, notes, paypal_invoice_id, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', '60% on Delivery', ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        localDeliveryId,
        client.id,
        deliveryInvNumber,
        deliveryAmount,
        currency,
        todayStr,
        todayStr,
        deliveryInput.note,
        ppDeliveryId,
        projectId
      );

      const providerTag = ` [Provider: ${ppDeposit?.providerUsed === 'sandbox' ? 'PayPal Sandbox' : 'MockPayPal provider'}]`;
      const auditMsg = `Approved high-risk terms (40% deposit / 60% delivery) for ${projectName} (Project: ${projectId}). Sent deposit invoice ${depositInvNumber} ($${depositAmount}, PayPal: ${ppDepositId}). Created balance invoice ${deliveryInvNumber} ($${deliveryAmount}, PayPal: ${ppDeliveryId}) as DRAFT pending delivery.${providerTag}`;
      db.prepare(
        `INSERT INTO audit_log (id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'TERMS_APPROVED_HIGH', 'project', ?, ?, CURRENT_TIMESTAMP)`
      ).run('audit_' + crypto.randomUUID().slice(0, 8), projectId, auditMsg);

      createdInvoices.push({
        id: localDepositId,
        invoice_number: depositInvNumber,
        amount: depositAmount,
        currency,
        status: 'SENT',
        terms: '40% Deposit',
        is_deposit: true,
        project_id: projectId,
        paypal_invoice_id: ppDepositId,
        payer_view_url: depositPayerView,
        client_email: client.email,
        demo_recipient_email: demoClientEmail,
      });

      createdInvoices.push({
        id: localDeliveryId,
        invoice_number: deliveryInvNumber,
        amount: deliveryAmount,
        currency,
        status: 'DRAFT',
        terms: '60% on Delivery',
        is_delivery: true,
        project_id: projectId,
        paypal_invoice_id: ppDeliveryId,
        payer_view_url: deliveryPayerView,
        client_email: client.email,
        demo_recipient_email: demoClientEmail,
      });

      auditLogs.push(auditMsg);
    }

    return NextResponse.json({
      success: true,
      terms_mode,
      risk_level,
      invoices: createdInvoices,
      audit: auditLogs,
    });
  } catch (err: any) {
    console.error('Error in /api/approve:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to approve and send invoice' },
      { status: 500 }
    );
  }
}
