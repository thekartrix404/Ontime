import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import path from 'path';

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

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const FALLBACK_MODEL = 'gemini-3.5-flash';

function getAiClient(): GoogleGenAI {
  ensureEnvLoaded();
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment or .env.local');
  }
  return new GoogleGenAI({ apiKey });
}

function resolveThinkingLevel(level?: string): ThinkingLevel {
  if (!level) return ThinkingLevel.LOW;
  const upper = level.toUpperCase();
  if (upper === 'LOW') return ThinkingLevel.LOW;
  if (upper === 'MEDIUM') return ThinkingLevel.MEDIUM;
  if (upper === 'HIGH') return ThinkingLevel.HIGH;
  // "minimal is not supported" -> fall back to LOW
  return ThinkingLevel.LOW;
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
) {
  // Try primary model (gemini-3.8-flash) with an 8s timeout
  try {
    return await callWithTimeout(GEMINI_MODEL, prompt, config, 8000);
  } catch (err: any) {
    // If gemini-3.8-flash hangs, times out, drops connection (ECONNRESET),
    // or returns 503 UNAVAILABLE, fall back to gemini-3.5-flash
    try {
      return await callWithTimeout(FALLBACK_MODEL, prompt, config, 15000);
    } catch (fallbackErr: any) {
      throw err;
    }
  }
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
): Promise<T> {
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

  const response = await callGeminiWithRetry(prompt, config);

  const text = response.text;
  if (!text) {
    throw new Error('Gemini API returned an empty response');
  }

  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    throw new Error(`Failed to parse Gemini response as JSON: ${err.message}. Raw: ${text}`);
  }
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
): Promise<string> {
  const resolvedLevel = resolveThinkingLevel(thinkingLevel);

  const config: Record<string, any> = {
    thinkingConfig: {
      thinkingLevel: resolvedLevel,
    },
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const response = await callGeminiWithRetry(prompt, config);

  return (response.text || '').trim();
}

