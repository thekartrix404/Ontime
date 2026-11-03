import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const content = fs.readFileSync(envPath, 'utf-8');
for (const line of content.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key] && val) process.env[key] = val;
  }
}

const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
  for (const model of ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest']) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: 'Say pong',
      });
      console.log(`Model ${model} OK:`, res.text?.trim());
    } catch (err: any) {
      console.log(`Model ${model} Error:`, err.message);
    }
  }
}

run();
