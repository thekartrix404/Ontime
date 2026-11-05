import { NextResponse } from 'next/server';
import { ensureEnvLoaded } from '@/lib/paypal';

ensureEnvLoaded();

export async function GET() {
  const paypalMode = (process.env.PAYPAL_MODE || 'mock').toLowerCase() === 'sandbox' ? 'sandbox' : 'mock';
  const llmMode = (process.env.LLM_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';

  return NextResponse.json({
    paypalMode,
    llmMode,
  });
}

