import { NextResponse } from 'next/server';
import { advanceSimulatedDays, getSimulatedNow } from '@/lib/clock';
import { runFollowUpAgent } from '@/lib/agent';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const days = Number(body.days);

    if (isNaN(days) || days <= 0) {
      return NextResponse.json({ error: 'Valid positive number of days required' }, { status: 400 });
    }

    // Advance simulated clock
    const newDate = advanceSimulatedDays(days);

    // Run follow-up agent loop
    const agentResult = await runFollowUpAgent();

    return NextResponse.json({
      success: true,
      advancedDays: days,
      simulatedDate: newDate.toISOString().split('T')[0],
      agentResult,
    });
  } catch (err: any) {
    console.error('Failed to advance clock and run agent:', err);
    return NextResponse.json({ error: err.message || 'Agent run failed' }, { status: 500 });
  }
}

