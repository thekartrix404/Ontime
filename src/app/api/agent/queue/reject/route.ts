import { NextResponse } from 'next/server';
import { rejectQueueItem } from '@/lib/guard';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queueId = body.queueId;

    if (!queueId) {
      return NextResponse.json({ error: 'queueId is required' }, { status: 400 });
    }

    const result = rejectQueueItem(queueId);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Failed to reject queue item:', err);
    return NextResponse.json({ error: err.message || 'Rejection failed' }, { status: 500 });
  }
}

