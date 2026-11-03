import fs from 'fs';
import path from 'path';

// Helper to load .env.local if running in a standalone script outside Next.js
export function ensureEnvLoaded() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    }
  }
}

ensureEnvLoaded();

export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export interface InvoiceItem {
  name: string;
  quantity: string;
  unit_amount: {
    currency_code: string;
    value: string; // e.g. "1200.00"
  };
  description?: string;
  tax?: {
    name: string;
    percent: string;
  };
}

export type PayPalPaymentTermType =
  | 'DUE_ON_RECEIPT'
  | 'DUE_ON_DATE_SPECIFIED'
  | 'NET_10'
  | 'NET_15'
  | 'NET_30'
  | 'NET_45'
  | 'NET_60'
  | 'NET_90'
  | 'NO_DUE_DATE';

export interface CreateInvoiceInput {
  recipientEmail: string;
  recipientName?: {
    given_name?: string;
    surname?: string;
  };
  recipientAddress?: {
    address_line_1?: string;
    admin_area_2?: string;
    admin_area_1?: string;
    postal_code?: string;
    country_code?: string;
  };
  items: InvoiceItem[];
  currency?: string;
  invoiceNumber?: string;
  reference?: string;
  invoiceDate?: string; // YYYY-MM-DD
  dueDate?: string;     // YYYY-MM-DD
  termType?: PayPalPaymentTermType | string;
  note?: string;
  term?: string;
  merchantEmail?: string;
}

export interface SendInvoiceOptions {
  sendToRecipient?: boolean;
  sendToInvoicer?: boolean;
  subject?: string;
  note?: string;
}

export interface RemindInvoiceOptions {
  sendToRecipient?: boolean;
  sendToInvoicer?: boolean;
  subject?: string;
  note?: string;
}

export interface RecordPaymentInput {
  method?: 'PAYPAL' | 'BANK_TRANSFER' | 'CASH' | 'CHECK' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'EXTERNAL' | 'OTHER' | string;
  paymentDate?: string; // YYYY-MM-DD
  amount: string;       // e.g. "1200.00"
  currency?: string;
  note?: string;
  paymentId?: string;
}

export interface PaymentProvider {
  getToken(): Promise<string>;
  generateNextInvoiceNumber?(): Promise<string>;
  createInvoice(input: CreateInvoiceInput): Promise<any>;
  sendInvoice(invoiceId: string, options?: SendInvoiceOptions): Promise<any>;
  getInvoice(invoiceId: string): Promise<any>;
  remindInvoice(invoiceId: string, options?: RemindInvoiceOptions): Promise<any>;
  recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<any>;
}

export class SandboxPayPalProvider implements PaymentProvider {
  private baseUrl: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(baseUrl: string = PAYPAL_SANDBOX_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getToken(): Promise<string> {
    ensureEnvLoaded();
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;

    if (!clientId || !secret) {
      throw new Error('PayPal credentials missing: PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set in process.env');
    }

    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60000) {
      return this.cachedToken.token;
    }

    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get PayPal token (${response.status}): ${errText}`);
    }

    const data = await response.json();
    this.cachedToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in || 3600) * 1000,
    };

    return data.access_token;
  }

  async generateNextInvoiceNumber(): Promise<string> {
    const token = await this.getToken();
    try {
      const response = await fetch(`${this.baseUrl}/v2/invoicing/generate-next-invoice-number`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fetch_id: 'false' }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.invoice_number) {
          return data.invoice_number;
        }
      }
    } catch {
      // Fallback below
    }
    return `INV-${Date.now()}`;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<any> {
    const token = await this.getToken();
    const merchantEmail = input.merchantEmail || process.env.PAYPAL_MERCHANT_EMAIL;

    const invoiceNumber = input.invoiceNumber || (await this.generateNextInvoiceNumber());
    const invoiceDate = input.invoiceDate || new Date().toISOString().split('T')[0];
    const currency = input.currency || 'USD';

    // Format items and verify amount strings
    const items = input.items.map((item) => {
      const numVal = parseFloat(item.unit_amount.value);
      const stringValue = isNaN(numVal) ? item.unit_amount.value : numVal.toFixed(2);
      return {
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit_amount: {
          currency_code: item.unit_amount.currency_code || currency,
          value: stringValue,
        },
      };
    });

    const body: any = {
      detail: {
        invoice_number: invoiceNumber,
        reference: input.reference,
        invoice_date: invoiceDate,
        currency_code: currency,
        note: input.note,
        term: input.term,
      },
      primary_recipients: [
        {
          billing_info: {
            name: input.recipientName,
            email_address: input.recipientEmail,
            ...(input.recipientAddress ? { address: input.recipientAddress } : {}),
          },
        },
      ],
      items,
    };

    if (input.termType || input.dueDate) {
      let termType = input.termType || (input.dueDate ? 'DUE_ON_DATE_SPECIFIED' : 'DUE_ON_RECEIPT');
      // Normalize common aliases to PayPal v2 enums
      if (termType === 'NET_14') termType = input.dueDate ? 'DUE_ON_DATE_SPECIFIED' : 'NET_15';
      if (termType === 'NET_7') termType = input.dueDate ? 'DUE_ON_DATE_SPECIFIED' : 'NET_10';
      if (input.dueDate && termType !== 'DUE_ON_DATE_SPECIFIED') {
        // If a specific due_date is provided, PayPal requires DUE_ON_DATE_SPECIFIED
        termType = 'DUE_ON_DATE_SPECIFIED';
      }

      body.detail.payment_term = {
        term_type: termType,
        due_date: input.dueDate,
      };
    }

    if (merchantEmail) {
      body.invoicer = {
        email_address: merchantEmail,
      };
    }

    const response = await fetch(`${this.baseUrl}/v2/invoicing/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to create PayPal invoice (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let invoiceId = data.id;
    if (!invoiceId && data.href) {
      invoiceId = data.href.split('/').pop();
    }
    if (!invoiceId && response.headers.get('location')) {
      invoiceId = response.headers.get('location')?.split('/').pop();
    }
    if (invoiceId) {
      data.id = invoiceId;
    }
    data.providerUsed = 'sandbox';

    return data;
  }

  async sendInvoice(invoiceId: string, options?: SendInvoiceOptions): Promise<any> {
    const token = await this.getToken();
    const sendBody: Record<string, any> = {
      send_to_recipient: options?.sendToRecipient ?? true,
      send_to_invoicer: options?.sendToInvoicer ?? false,
    };
    if (options?.subject) sendBody.subject = options.subject;
    if (options?.note) sendBody.note = options.note;

    const response = await fetch(`${this.baseUrl}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendBody),
    });

    const responseText = await response.text();
    console.log(`[sendInvoice] HTTP Status: ${response.status}`);
    console.log(`[sendInvoice] Response Body: ${responseText || '(empty)'}`);

    if (!response.ok) {
      throw new Error(`Failed to send PayPal invoice (${response.status}): ${responseText}`);
    }

    if (!responseText) {
      return { success: true, status: response.status, invoiceId, providerUsed: 'sandbox' };
    }

    try {
      const parsed = JSON.parse(responseText);
      parsed.providerUsed = 'sandbox';
      return parsed;
    } catch {
      return { success: true, status: response.status, body: responseText, providerUsed: 'sandbox' };
    }
  }

  async getInvoice(invoiceId: string): Promise<any> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get PayPal invoice (${response.status}): ${errText}`);
    }

    const data = await response.json();
    data.providerUsed = 'sandbox';
    return data;
  }

  async remindInvoice(invoiceId: string, options?: RemindInvoiceOptions): Promise<any> {
    const token = await this.getToken();
    const remindBody: Record<string, any> = {
      send_to_recipient: options?.sendToRecipient ?? true,
      send_to_invoicer: options?.sendToInvoicer ?? false,
    };
    if (options?.subject) remindBody.subject = options.subject;
    if (options?.note) remindBody.note = options.note;

    const response = await fetch(`${this.baseUrl}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(remindBody),
    });

    const responseText = await response.text();
    console.log(`[remindInvoice] HTTP Status: ${response.status}`);
    console.log(`[remindInvoice] Response Body: ${responseText || '(empty)'}`);

    if (!response.ok) {
      throw new Error(`Failed to send PayPal invoice reminder (${response.status}): ${responseText}`);
    }

    if (!responseText || response.status === 204) {
      return { success: true, status: response.status, invoiceId, providerUsed: 'sandbox' };
    }

    try {
      const parsed = JSON.parse(responseText);
      parsed.providerUsed = 'sandbox';
      return parsed;
    } catch {
      return { success: true, status: response.status, body: responseText, providerUsed: 'sandbox' };
    }
  }

  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<any> {
    const token = await this.getToken();
    const numVal = parseFloat(input.amount);
    const amountStr = isNaN(numVal) ? input.amount : numVal.toFixed(2);
    const paymentDate = input.paymentDate || new Date().toISOString().split('T')[0];

    const body: Record<string, any> = {
      method: input.method || 'OTHER',
      payment_date: paymentDate,
      amount: {
        currency_code: input.currency || 'USD',
        value: amountStr,
      },
    };

    if (input.note) {
      body.note = input.note;
    }

    if (input.paymentId) {
      body.payment_id = input.paymentId;
    }

    const response = await fetch(`${this.baseUrl}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    console.log(`[recordPayment] HTTP Status: ${response.status}`);
    console.log(`[recordPayment] Response Body: ${responseText || '(empty)'}`);

    if (!response.ok) {
      throw new Error(`Failed to record PayPal payment (${response.status}): ${responseText}`);
    }

    if (!responseText) {
      return { success: true, status: response.status, invoiceId, providerUsed: 'sandbox' };
    }

    try {
      const parsed = JSON.parse(responseText);
      parsed.providerUsed = 'sandbox';
      return parsed;
    } catch {
      return { success: true, status: response.status, body: responseText, providerUsed: 'sandbox' };
    }
  }
}

export class MockPayPalProvider implements PaymentProvider {
  private invoices = new Map<string, any>();
  private counter = 1000;

  async getToken(): Promise<string> {
    return 'mock_access_token_' + Date.now();
  }

  async generateNextInvoiceNumber(): Promise<string> {
    return `MOCK-INV-${++this.counter}`;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<any> {
    const invoiceId = `MOCK-INV2-${Date.now()}`;
    const invoiceNumber = input.invoiceNumber || (await this.generateNextInvoiceNumber());
    const invoice = {
      id: invoiceId,
      status: 'DRAFT',
      detail: {
        invoice_number: invoiceNumber,
        invoice_date: input.invoiceDate || new Date().toISOString().split('T')[0],
        currency_code: input.currency || 'USD',
        note: input.note,
        payment_term: {
          term_type: input.termType || 'NET_14',
          due_date: input.dueDate,
        },
      },
      primary_recipients: [
        {
          billing_info: {
            name: input.recipientName,
            email_address: input.recipientEmail,
          },
        },
      ],
      items: input.items,
      amount: {
        currency_code: input.currency || 'USD',
        value: input.items
          .reduce((sum, item) => sum + parseFloat(item.unit_amount.value) * parseFloat(item.quantity || '1'), 0)
          .toFixed(2),
      },
      providerUsed: 'mock',
    };
    this.invoices.set(invoiceId, invoice);
    return invoice;
  }

  async sendInvoice(invoiceId: string, options?: SendInvoiceOptions): Promise<any> {
    const invoice = this.invoices.get(invoiceId);
    if (invoice) invoice.status = 'SENT';
    return { success: true, status: 'SENT', invoiceId, providerUsed: 'mock' };
  }

  async getInvoice(invoiceId: string): Promise<any> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);
    return { ...invoice, providerUsed: 'mock' };
  }

  async remindInvoice(invoiceId: string, options?: RemindInvoiceOptions): Promise<any> {
    const invoice = this.invoices.get(invoiceId);
    return { success: true, invoiceId, reminderSent: true, subject: options?.subject, note: options?.note, providerUsed: 'mock' };
  }

  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<any> {
    const invoice = this.invoices.get(invoiceId);
    if (invoice) invoice.status = 'PAID';
    return { payment_id: `MOCK-PAY-${Date.now()}`, providerUsed: 'mock' };
  }
}

export class FallbackPaymentProvider implements PaymentProvider {
  private primary: SandboxPayPalProvider;
  private fallback: MockPayPalProvider;

  constructor() {
    this.primary = new SandboxPayPalProvider();
    this.fallback = new MockPayPalProvider();
  }

  private isNetworkError(err: any): boolean {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.cause?.code || err?.code;
    return msg.includes('fetch failed') || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';
  }

  async getToken(): Promise<string> {
    try {
      return await this.primary.getToken();
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.getToken();
      }
      throw err;
    }
  }

  async generateNextInvoiceNumber(): Promise<string> {
    try {
      return await this.primary.generateNextInvoiceNumber();
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.generateNextInvoiceNumber();
      }
      throw err;
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<any> {
    try {
      return await this.primary.createInvoice(input);
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.createInvoice(input);
      }
      throw err;
    }
  }

  async sendInvoice(invoiceId: string, options?: SendInvoiceOptions): Promise<any> {
    try {
      return await this.primary.sendInvoice(invoiceId, options);
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.sendInvoice(invoiceId, options);
      }
      throw err;
    }
  }

  async getInvoice(invoiceId: string): Promise<any> {
    try {
      return await this.primary.getInvoice(invoiceId);
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.getInvoice(invoiceId);
      }
      throw err;
    }
  }

  async remindInvoice(invoiceId: string, options?: RemindInvoiceOptions): Promise<any> {
    try {
      return await this.primary.remindInvoice(invoiceId, options);
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.remindInvoice(invoiceId, options);
      }
      throw err;
    }
  }

  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<any> {
    try {
      return await this.primary.recordPayment(invoiceId, input);
    } catch (err: any) {
      if (this.isNetworkError(err)) {
        return this.fallback.recordPayment(invoiceId, input);
      }
      throw err;
    }
  }
}

// Active provider instance (defaults to Sandbox if credentials present with Mock fallback)
let activeProvider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!activeProvider) {
    ensureEnvLoaded();
    if (process.env.PAYPAL_MODE === 'mock') {
      activeProvider = new MockPayPalProvider();
    } else if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET) {
      activeProvider = new FallbackPaymentProvider();
    } else {
      activeProvider = new MockPayPalProvider();
    }
  }
  return activeProvider;
}

export function setPaymentProvider(provider: PaymentProvider) {
  activeProvider = provider;
}

// Direct function exports as requested in requirements
export async function getToken(): Promise<string> {
  return getPaymentProvider().getToken();
}

export async function createInvoice(input: CreateInvoiceInput): Promise<any> {
  return getPaymentProvider().createInvoice(input);
}

export async function sendInvoice(invoiceId: string, options?: SendInvoiceOptions): Promise<any> {
  return getPaymentProvider().sendInvoice(invoiceId, options);
}

export async function getInvoice(invoiceId: string): Promise<any> {
  return getPaymentProvider().getInvoice(invoiceId);
}

export async function remindInvoice(invoiceId: string, options?: RemindInvoiceOptions): Promise<any> {
  return getPaymentProvider().remindInvoice(invoiceId, options);
}

export async function recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<any> {
  return getPaymentProvider().recordPayment(invoiceId, input);
}
