import { z } from 'zod';
import { generateJson } from './llm';

export const LineItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unit_price: z.number().nonnegative('Unit price must be non-negative'),
});

export const ExtractedInvoiceSchema = z.object({
  client_name: z.string().nullable(),
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
}

export interface ExtractionFailure {
  success: false;
  error: string;
  missingFields: string[];
  data?: ExtractedInvoice | null;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

const EXTRACTION_SYSTEM_INSTRUCTION = `You are a precision invoice extraction assistant.
Extract structured invoice details from the client email into JSON.
CRITICAL RULES:
1. Never invent or assume values. If a detail (like client email, client name, or project type) is not explicitly present in the email, set its value to null.
2. Never calculate totals, subtotals, or taxes. Only extract individual line item description, quantity, and unit_price.
3. If currency is not explicitly mentioned, default to "USD".
4. Output valid JSON matching the schema:
{
  "client_name": string or null,
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
      parsedJson = await generateJson(prompt, EXTRACTION_SYSTEM_INSTRUCTION, 'low');
      const validated = ExtractedInvoiceSchema.parse(parsedJson);

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
        };
      }

      return {
        success: true,
        data: validated,
        missingFields,
      };
    } catch (err: any) {
      lastError = err;
      if (attempt === 1) {
        // Short pause before retry
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  return {
    success: false,
    error: `Invoice extraction failed: ${lastError?.message || 'Unknown error'}`,
    missingFields: ['parsing_failed'],
    data: null,
  };
}
