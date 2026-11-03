import { z } from 'zod';
import { generateJson, LlmSource } from './llm';

export const LineItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unit_price: z.number().nonnegative('Unit price must be non-negative'),
});

export const ExtractedInvoiceSchema = z.object({
  client_name: z.string().nullable(),
  company: z.string().nullable().default(null),
  client_email: z.string().nullable(),
  currency: z.string().default('USD'),
  project_type: z.string().nullable(),
  line_items: z.array(LineItemSchema),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

export interface ExtractionSuccess {
  success: true;
  data: ExtractedInvoice;
  missingFields: string[];
  source: LlmSource;
}

export interface ExtractionFailure {
  success: false;
  error: string;
  missingFields: string[];
  data?: ExtractedInvoice | null;
  source: LlmSource;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

const EXTRACTION_SYSTEM_INSTRUCTION = `You are a precision invoice extraction assistant.
Extract structured invoice details from the client email into JSON.
CRITICAL RULES:
1. Never invent or assume values. If a detail (like company, client_name, client_email, or project_type) is not explicitly present in the email, set its value to null.
- "company" is the company, agency, or organization name that goes on the invoice (or null if not mentioned).
- "client_name" is the individual person's name / contact person (or null if not mentioned).
2. Never calculate totals, subtotals, or taxes. Only extract individual line item description, quantity, and unit_price.
3. If currency is not explicitly mentioned, default to "USD".
4. Output valid JSON matching the schema:
{
  "client_name": string or null,
  "company": string or null,
  "client_email": string or null,
  "currency": string,
  "project_type": string or null,
  "line_items": [
    {
      "description": string,
      "quantity": number,
      "unit_price": number
    }
  ]
}`;

function fallbackExtract(emailText: string): ExtractedInvoice {
  // Extract email address
  const emailMatch = emailText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const client_email = emailMatch ? emailMatch[0] : null;

  // Extract company
  let company: string | null = null;
  const companyMatch = emailText.match(/\b([A-Za-z0-9\s&]+(?:LLC|Inc|Ltd|Corp|Enterprises|Solutions|Dynamics|Horizons))\b/i);
  if (companyMatch) {
    company = companyMatch[1].trim();
  }

  // Extract contact name
  let client_name: string | null = null;
  const attnMatch = emailText.match(/attention\s+([A-Za-z\s]+?)(?:\s*\(|\s+at|\s+for|\s*,|\s*\n)/i);
  if (attnMatch) {
    client_name = attnMatch[1].trim();
  } else {
    const signoffMatch = emailText.match(/(?:Best regards|Cheers|Thanks|Sincerely|Best)[,\s]+([A-Za-z\s]+)$/im);
    if (signoffMatch) {
      client_name = signoffMatch[1].trim();
    }
  }

  // Extract line items
  const line_items: Array<{ description: string; quantity: number; unit_price: number }> = [];

  // Match items with prices like: "Description" - 1 unit at $1,800.00
  const itemRegex = /(?:Item \d+:|\d+\.)?\s*["']?([^"'\n]+?)["']?\s*[-:]?\s*(\d+)?\s*(?:unit|units|day|days)?\s*(?:at|for)?\s*\$([0-9,]+(?:\.[0-9]{2})?)/gi;
  let match;
  while ((match = itemRegex.exec(emailText)) !== null) {
    const desc = match[1].trim();
    if (desc.toLowerCase().includes('total') || desc.toLowerCase().includes('scope')) continue;
    const qty = match[2] ? parseInt(match[2], 10) : 1;
    const price = parseFloat(match[3].replace(/,/g, ''));
    if (!isNaN(price) && desc.length > 2) {
      line_items.push({
        description: desc,
        quantity: isNaN(qty) ? 1 : qty,
        unit_price: price,
      });
    }
  }

  // Fallback single item if regex loop missed
  if (line_items.length === 0) {
    const priceMatch = emailText.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
    const descMatch = emailText.match(/["']([^"']+)["']/);
    if (priceMatch) {
      line_items.push({
        description: descMatch ? descMatch[1] : 'Professional Services',
        quantity: 1,
        unit_price: parseFloat(priceMatch[1].replace(/,/g, '')),
      });
    }
  }

  return {
    client_name,
    company,
    client_email,
    currency: 'USD',
    project_type: line_items[0]?.description || null,
    line_items,
  };
}

/**
 * Extracts invoice information from an email text using Gemini.
 * Validates with Zod, retries once on failure, and returns an error object listing missing fields instead of guessing.
 */
export async function extractInvoice(emailText: string): Promise<ExtractionResult> {
  const prompt = `Please extract the invoice details from the following email text:\n\n"""\n${emailText}\n"""\n\nRemember: never invent values, use null for anything not in the email, and never calculate totals.`;

  let lastError: Error | null = null;
  let parsedJson: any = null;

  // Try initial call, retry once on failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const jsonRes = await generateJson(prompt, EXTRACTION_SYSTEM_INSTRUCTION, 'low');
      const validated = ExtractedInvoiceSchema.parse(jsonRes.data);

      // Check for missing fields that are essential for invoice generation
      const missingFields: string[] = [];
      if (!validated.client_name) missingFields.push('client_name');
      if (!validated.client_email) missingFields.push('client_email');
      if (!validated.line_items || validated.line_items.length === 0) {
        missingFields.push('line_items');
      }

      // If client_email or line_items are missing, return failure listing missing fields instead of guessing
      if (missingFields.includes('client_email') || missingFields.includes('line_items')) {
        return {
          success: false,
          error: `Incomplete invoice data. Missing required fields: ${missingFields.join(', ')}`,
          missingFields,
          data: validated,
          source: jsonRes.source,
        };
      }

      return {
        success: true,
        data: validated,
        missingFields,
        source: jsonRes.source,
      };
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err);
      // If free tier quota is exhausted (429 / RESOURCE_EXHAUSTED), fall back gracefully
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
        const fallbackData = fallbackExtract(emailText);
        const missingFields: string[] = [];
        if (!fallbackData.client_name) missingFields.push('client_name');
        if (!fallbackData.client_email) missingFields.push('client_email');
        if (!fallbackData.line_items || fallbackData.line_items.length === 0) {
          missingFields.push('line_items');
        }

        if (missingFields.includes('client_email') || missingFields.includes('line_items')) {
          return {
            success: false,
            error: 'AI quota reached, using fallback. Incomplete invoice data: missing ' + missingFields.join(', '),
            missingFields,
            data: fallbackData,
            source: 'rule-fallback',
          };
        }

        return {
          success: true,
          data: fallbackData,
          missingFields,
          source: 'rule-fallback',
        };
      }

      if (attempt === 1) {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  const partialData = fallbackExtract(emailText);
  const missing: string[] = [];
  if (!partialData.client_name) missing.push('client_name');
  if (!partialData.client_email) missing.push('client_email');
  if (!partialData.line_items || partialData.line_items.length === 0) missing.push('line_items');

  return {
    success: false,
    error: `Invoice extraction failed after retry (${lastError?.message || 'Gemini error'}). Showing manual edit form with partial fields prefilled.`,
    missingFields: missing.length > 0 ? missing : ['manual_review_required'],
    data: partialData,
    source: 'rule-fallback',
  };
}
