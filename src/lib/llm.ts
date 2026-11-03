import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';

// Helper to load .env.local if running standalone outside Next.js
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

  // Ensure GEMINI_API_KEY is available if user supplied LLM_API_KEY
  if (!process.env.GEMINI_API_KEY && process.env.LLM_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.LLM_API_KEY;
  }
}

ensureEnvLoaded();

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
}

export const GEMINI_MODEL = getGeminiModel();
export const FALLBACK_MODEL = 'gemini-3.5-flash';

export function isMockMode(): boolean {
  return process.env.LLM_MODE === 'mock';
}

function getAiClient(): GoogleGenAI {
  ensureEnvLoaded();
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey && !isMockMode()) {
    throw new Error('GEMINI_API_KEY is not set in environment or .env.local');
  }
  return new GoogleGenAI({ apiKey: apiKey || 'mock-key' });
}

function resolveThinkingLevel(level?: string): ThinkingLevel {
  if (!level) return ThinkingLevel.LOW;
  const upper = level.toUpperCase();
  if (upper === 'LOW') return ThinkingLevel.LOW;
  if (upper === 'MEDIUM') return ThinkingLevel.MEDIUM;
  if (upper === 'HIGH') return ThinkingLevel.HIGH;
  return ThinkingLevel.LOW;
}

function getCacheKey(model: string, prompt: string, config: Record<string, any>): string {
  const payload = `${model}::${prompt}::${JSON.stringify(config)}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function getCachedResponse(cacheKey: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT response FROM llm_cache WHERE cache_key = ?').get(cacheKey) as { response: string } | undefined;
    return row ? row.response : null;
  } catch {
    return null;
  }
}

function saveCachedResponse(cacheKey: string, prompt: string, response: string, model: string): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO llm_cache (cache_key, prompt, response, model, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(cacheKey, prompt, response, model);
  } catch {
    // Non-fatal if cache write fails
  }
}

export type LlmSource = 'gemini-live' | 'cache' | 'mock' | 'rule-fallback';

function generateRuleFallbackContent(prompt: string, config: Record<string, any>, reason?: string): { text: string } {
  // If JSON is requested (e.g. extraction)
  if (config.responseMimeType === 'application/json') {
    const emailMatch = prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const email = emailMatch ? emailMatch[1] : null;

    // Check for dollar amounts e.g. $1,800.00
    const amtMatches = Array.from(prompt.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)/g));
    const firstAmt = amtMatches[0] ? parseFloat(amtMatches[0][1].replace(/,/g, '')) : 1000;

    let companyName: string | null = null;
    const companyMatch = prompt.match(/(?:invoice|bill)\s+(?:over\s+to\s+|to\s+)?([A-Z][A-Za-z0-9\s&]+?)(?:,|\s+attention|\s+\(finance|\s+\([a-zA-Z0-9._%+-]+@|\s+for|\s+at)/i);
    if (companyMatch) {
      companyName = companyMatch[1].trim();
      if (companyName.toLowerCase().startsWith('to ')) {
        companyName = companyName.substring(3).trim();
      }
    }

    let clientName: string | null = null;
    const nameMatch = prompt.match(/attention\s+([A-Za-z\s]+?)(?:,|\s*\(|\s+at|\s+for)/i) || prompt.match(/(?:Thanks|Best regards|Cheers),\s*([A-Za-z\s]+)/i);
    if (nameMatch) clientName = nameMatch[1].trim();

    const lines = prompt.split('\n');
    const extractedItems: Array<{ description: string; quantity: number; unit_price: number }> = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const dollarMatch = line.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
      if (dollarMatch) {
        const price = parseFloat(dollarMatch[1].replace(/,/g, ''));
        if (
          !isNaN(price) &&
          (line.match(/^\d+[\.\)]/) ||
            line.startsWith('-') ||
            line.toLowerCase().includes('unit') ||
            line.toLowerCase().includes('item') ||
            line.toLowerCase().includes('deliverable') ||
            line.toLowerCase().includes('audit') ||
            line.toLowerCase().includes('integration') ||
            line.toLowerCase().includes('redesign') ||
            line.toLowerCase().includes('maintenance'))
        ) {
          let desc = line
            .replace(/^\d+[\.\)]\s*/, '')
            .replace(/^[-•*]\s*/, '')
            .split(/-\s*\d+\s*unit/i)[0]
            .split(/-\s*\$/)[0]
            .split(/for\s*(?:the\s*)?["']?/i)[0]
            .split(/at\s*\$/i)[0]
            .replace(/["']/g, '')
            .trim();
          if (!desc || desc.length < 3) desc = 'Contract Services';

          const qtyMatch = line.match(/(\d+)\s*units?/i);
          const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

          extractedItems.push({
            description: desc,
            quantity: qty,
            unit_price: price,
          });
        }
      }
    }

    const finalLineItems =
      extractedItems.length > 0
        ? extractedItems
        : [
            {
              description: 'Contract Deliverable (Rule-Fallback)',
              quantity: 1,
              unit_price: isNaN(firstAmt) ? 1000 : firstAmt,
            },
          ];

    return {
      text: JSON.stringify({
        client_name: clientName,
        company: companyName,
        client_email: email,
        currency: 'USD',
        project_type: 'Contract Services (Rule-Fallback)',
        line_items: finalLineItems,
      }),
    };
  }

  // Plain text (explanation)
  if (prompt.includes('low') || prompt.includes('Low')) {
    return {
      text: 'Rule-based recommendation: Client has an established history of reliable on-time payments. Standard Net-14 terms are recommended.',
    };
  } else if (prompt.includes('high') || prompt.includes('High')) {
    return {
      text: 'Rule-based recommendation: Client has repeated historical payment delays. Milestone terms with a 40% upfront deposit and 60% upon delivery are recommended to safeguard cash flow.',
    };
  } else {
    return {
      text: 'Rule-based recommendation: Client has limited or standard transaction history. Net-7 terms with a 2% early-pay discount are recommended to incentivize prompt settlement.',
    };
  }
}

function generateMockContent(prompt: string, config: Record<string, any>): any {
  // If JSON is requested (e.g. extraction)
  if (config.responseMimeType === 'application/json') {
    if (prompt.includes('extract') || prompt.includes('invoice') || prompt.includes('Invoice')) {
      if (prompt.includes('Lagging') || prompt.includes('bob@lateinc.com') || prompt.includes('Bob Slow')) {
        return {
          text: JSON.stringify({
            client_name: 'Bob Slow',
            company: 'Lagging Dynamics Inc',
            client_email: 'bob@lateinc.com',
            currency: 'USD',
            project_type: 'Digital Marketing Campaign',
            line_items: [
              {
                description: 'Digital Marketing Campaign Strategy',
                quantity: 1,
                unit_price: 2000,
              },
              {
                description: 'Custom Ad Creative Bundle',
                quantity: 2,
                unit_price: 500,
              },
            ],
          }),
        };
      }

      if (prompt.includes('Reliable') || prompt.includes('alice@reliablecorp.com') || prompt.includes('Alice Vance')) {
        return {
          text: JSON.stringify({
            client_name: 'Alice Vance',
            company: 'Reliable Solutions LLC',
            client_email: 'alice@reliablecorp.com',
            currency: 'USD',
            project_type: 'Quarterly Web Infrastructure Maintenance',
            line_items: [
              {
                description: 'Quarterly Web Infrastructure Maintenance',
                quantity: 1,
                unit_price: 1800,
              },
            ],
          }),
        };
      }

      if (prompt.includes('Horizons') || prompt.includes('claire@newhorizons.io') || prompt.includes('Claire Startup')) {
        return {
          text: JSON.stringify({
            client_name: 'Claire Startup',
            company: 'New Horizons Ltd',
            client_email: 'claire@newhorizons.io',
            currency: 'USD',
            project_type: 'Brand Identity & Style Guide',
            line_items: [
              {
                description: 'Brand Identity & Style Guide',
                quantity: 1,
                unit_price: 1500,
              },
            ],
          }),
        };
      }

      if (prompt.includes('Wayne') || prompt.includes('2. Cloud')) {
        return {
          text: JSON.stringify({
            client_name: 'Bruce Wayne',
            company: 'Wayne Enterprises',
            client_email: 'finance@wayne-enterprises.example.com',
            currency: 'USD',
            project_type: 'Contract Deliverables',
            line_items: [
              {
                description: 'Mobile App Security Audit',
                quantity: 1,
                unit_price: 2400,
              },
              {
                description: 'Cloud API Integration',
                quantity: 2,
                unit_price: 600,
              },
            ],
          }),
        };
      }

      const emailMatch = prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const email = emailMatch ? emailMatch[1] : null;

      const mockInvoice = {
        client_name: email ? 'Sarah Connor' : (prompt.includes('Marcus') ? 'Marcus Vance' : 'Alice Vance'),
        company: email ? 'Cyberdyne Systems' : (prompt.includes('Acme') ? 'Acme Corp' : 'Reliable Solutions LLC'),
        client_email: email,
        currency: 'USD',
        project_type: prompt.includes('Website') ? 'Website Redesign' : 'Professional Services',
        line_items: [
          {
            description: prompt.includes('Website') ? 'Homepage and Navigation Redesign' : 'Cybersecurity Architecture Review',
            quantity: 1,
            unit_price: prompt.includes('2,000') || prompt.includes('2000') ? 2000 : 1500,
          },
        ],
      };
      return { text: JSON.stringify(mockInvoice) };
    }
    return { text: JSON.stringify({ success: true, message: 'Mock JSON response' }) };
  }

  // Plain text (e.g. explain terms)
  if (prompt.includes('explain') || prompt.includes('reason') || prompt.includes('risk')) {
    return {
      text: 'Based on client payment history, standard Net-14 terms are recommended as previous invoices were settled promptly.',
    };
  }

  return { text: 'Mock LLM Response generated successfully.' };
}

async function callWithTimeout(
  model: string,
  prompt: string,
  config: Record<string, any>,
  timeoutMs: number
) {
  const ai = getAiClient();
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: ${model} failed to respond within ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const requestPromise = ai.models.generateContent({
    model,
    contents: prompt,
    config,
  });

  try {
    return (await Promise.race([requestPromise, timeoutPromise])) as any;
  } finally {
    clearTimeout(timer!);
  }
}

async function callGeminiWithRetry(
  prompt: string,
  config: Record<string, any>
): Promise<{ text: string; source: LlmSource; fromCache?: boolean; fallbackReason?: string }> {
  const modelToUse = getGeminiModel();

  // 1. Check if LLM_MODE is mock
  if (isMockMode()) {
    const mock = generateMockContent(prompt, config);
    return { text: mock.text, source: 'mock' };
  }

  // 2. Check SQLite cache
  const cacheKey = getCacheKey(modelToUse, prompt, config);
  const cached = getCachedResponse(cacheKey);
  if (cached !== null) {
    return { text: cached, source: 'cache', fromCache: true };
  }

  // 3. Try primary model with 25s timeout
  let response: any;
  try {
    response = await callWithTimeout(modelToUse, prompt, config, 25000);
  } catch (err: any) {
    // If primary hangs or errors, try fallback with 25s timeout
    try {
      response = await callWithTimeout(FALLBACK_MODEL, prompt, config, 25000);
    } catch (fallbackErr: any) {
      // LLM_MODE is not "mock" and Gemini failed -> use "rule-fallback" templates
      const fb = generateRuleFallbackContent(prompt, config, fallbackErr?.message || err?.message);
      return {
        text: fb.text,
        source: 'rule-fallback',
        fallbackReason: fallbackErr?.message || err?.message || 'Gemini call failed',
      };
    }
  }

  // 4. Save to SQLite cache if text is present
  if (response && response.text) {
    saveCachedResponse(cacheKey, prompt, response.text, modelToUse);
    return { text: response.text, source: 'gemini-live' };
  }

  const fb = generateRuleFallbackContent(prompt, config, 'empty response');
  return {
    text: fb.text,
    source: 'rule-fallback',
    fallbackReason: 'Gemini returned empty response',
  };
}

export interface GenerateJsonResult<T = any> {
  data: T;
  source: LlmSource;
  fallbackReason?: string;
}

/**
 * Generate structured JSON using Gemini model "gemini-3.8-flash".
 * Do NOT pass temperature, top_p or top_k.
 * Uses thinking_level ("low" for extraction and wording).
 */
export async function generateJson<T = any>(
  prompt: string,
  systemInstruction?: string,
  thinkingLevel: string = 'low'
): Promise<GenerateJsonResult<T>> {
  const resolvedLevel = resolveThinkingLevel(thinkingLevel);

  const config: Record<string, any> = {
    responseMimeType: 'application/json',
    thinkingConfig: {
      thinkingLevel: resolvedLevel,
    },
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const res = await callGeminiWithRetry(prompt, config);

  const text = res.text;
  if (!text) {
    throw new Error('Gemini API returned an empty response');
  }

  try {
    const data = JSON.parse(text) as T;
    return { data, source: res.source, fallbackReason: res.fallbackReason };
  } catch (err: any) {
    throw new Error(`Failed to parse Gemini response as JSON: ${err.message}. Raw: ${text}`);
  }
}

export interface GenerateTextResult {
  text: string;
  source: LlmSource;
  fallbackReason?: string;
}

/**
 * Generate plain text using Gemini model "gemini-3.8-flash".
 * Do NOT pass temperature, top_p or top_k.
 * Uses thinking_level ("low" for extraction and wording).
 */
export async function generateText(
  prompt: string,
  systemInstruction?: string,
  thinkingLevel: string = 'low'
): Promise<GenerateTextResult> {
  const resolvedLevel = resolveThinkingLevel(thinkingLevel);

  const config: Record<string, any> = {
    thinkingConfig: {
      thinkingLevel: resolvedLevel,
    },
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const res = await callGeminiWithRetry(prompt, config);

  return {
    text: (res.text || '').trim(),
    source: res.source,
    fallbackReason: res.fallbackReason,
  };
}

export interface ToolCallResult {
  name: string;
  args: Record<string, any>;
}

export interface ToolCallResponse {
  functionCalls: ToolCallResult[];
  text?: string;
  source: LlmSource;
  fromCache?: boolean;
  fallbackUsed?: string;
}

export async function callGeminiWithTools(
  prompt: string,
  tools: any[],
  systemInstruction?: string,
  fallbackContext?: {
    daysOverdue: number;
    invoiceId: string;
    clientName: string;
    amount: string;
    dueDate: string;
  }
): Promise<ToolCallResponse> {
  const modelToUse = getGeminiModel();

  // Helper for deterministic rule-based tool calls (used by fallback & mock mode)
  const getDeterministicToolCall = (reason: string, src: LlmSource): ToolCallResponse => {
    const days = fallbackContext?.daysOverdue ?? 0;
    const invId = fallbackContext?.invoiceId || 'INV-001';
    const client = fallbackContext?.clientName || 'Valued Client';
    const amt = fallbackContext?.amount || '0.00';
    const due = fallbackContext?.dueDate || 'today';

    if (days <= 0) {
      return {
        functionCalls: [
          {
            name: 'send_reminder',
            args: {
              invoiceId: invId,
              tone: 'friendly',
              subject: `Friendly Reminder: Payment due soon for ${client}`,
              message: `Hi ${client}, this is a friendly reminder that invoice ${invId} for $${amt} is due on ${due}. Thank you for your business!`,
            },
          },
        ],
        source: src,
        fallbackUsed: reason,
      };
    } else if (days <= 7) {
      return {
        functionCalls: [
          {
            name: 'send_reminder',
            args: {
              invoiceId: invId,
              tone: 'nudge',
              subject: `Reminder: Invoice past due for ${client}`,
              message: `Hi ${client}, checking in regarding invoice ${invId} for $${amt}, which was due on ${due} (${days} days overdue). Please let us know if you need anything to process payment.`,
            },
          },
        ],
        source: src,
        fallbackUsed: reason,
      };
    } else if (days <= 20) {
      return {
        functionCalls: [
          {
            name: 'send_reminder',
            args: {
              invoiceId: invId,
              tone: 'firm',
              subject: `Important Notice: Invoice ${invId} is ${days} days overdue`,
              message: `Hello ${client}, invoice ${invId} for $${amt} is now ${days} days overdue (due date ${due}). Please remit payment immediately to keep your account current.`,
            },
          },
        ],
        source: src,
        fallbackUsed: reason,
      };
    } else {
      return {
        functionCalls: [
          {
            name: 'draft_escalation',
            args: {
              invoiceId: invId,
              tone: 'formal',
              message: `Formal Notice: Invoice ${invId} for $${amt} is severely past due by ${days} days (due ${due}). Account is flagged for immediate executive escalation.`,
            },
          },
        ],
        source: src,
        fallbackUsed: reason,
      };
    }
  };

  // 1. Mock mode handling
  if (isMockMode()) {
    return getDeterministicToolCall('mock mode', 'mock');
  }

  // 2. Cache check
  const config: Record<string, any> = {
    tools: [{ functionDeclarations: tools }],
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MEDIUM,
    },
  };
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const cacheKey = getCacheKey(modelToUse, prompt, config);
  const cached = getCachedResponse(cacheKey);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed.functionCalls)) {
        return {
          functionCalls: parsed.functionCalls,
          text: parsed.text,
          source: 'cache',
          fromCache: true,
        };
      }
    } catch {
      // Ignore cache parse error and proceed
    }
  }

  // 3. Call Gemini
  try {
    const rawRes = await callWithTimeout(modelToUse, prompt, config, 25000);
    const functionCalls: ToolCallResult[] = [];

    if (rawRes.functionCalls && Array.isArray(rawRes.functionCalls)) {
      for (const fc of rawRes.functionCalls) {
        functionCalls.push({
          name: fc.name,
          args: fc.args || {},
        });
      }
    }

    if (functionCalls.length > 0) {
      const resultObj = { functionCalls, text: rawRes.text };
      saveCachedResponse(cacheKey, prompt, JSON.stringify(resultObj), modelToUse);
      return { functionCalls, text: rawRes.text, source: 'gemini-live' };
    }

    // If Gemini returned without calling any tools, fallback to deterministic
    return getDeterministicToolCall('no tool call returned from Gemini', 'rule-fallback');
  } catch (err: any) {
    return getDeterministicToolCall(`Gemini API error (${err.message || 'unknown error'})`, 'rule-fallback');
  }
}


