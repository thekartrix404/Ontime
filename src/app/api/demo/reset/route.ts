import { NextResponse } from 'next/server';
import { resetDemo, getSimulatedNow } from '@/lib/clock';

export async function POST() {
  try {
    resetDemo();
    const simulatedNow = getSimulatedNow();

    return NextResponse.json({
      success: true,
      message: 'Demo state successfully reset to seed defaults.',
      simulatedDate: simulatedNow.toISOString().split('T')[0],
    });
  } catch (err: any) {
    console.error('Failed to reset demo:', err);
    return NextResponse.json({ error: err.message || 'Reset failed' }, { status: 500 });
  }
}

