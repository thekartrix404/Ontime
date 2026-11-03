import { NextResponse } from 'next/server';
import { advanceSimulatedDays, setSimulatedRelativeToDueDate, getSimulatedNow, computeDaysOverdue } from '@/lib/clock';
import { runFollowUpAgent } from '@/lib/agent';
import { getDb } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let newDate: Date;
    let daysDescription = '';
    let selectedInvoiceNumber = '';
    let resultingDaysOverdue = 0;

    if (body.invoiceId && typeof body.relativeDays === 'number') {
      const db = getDb();
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(body.invoiceId) as any;
      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found for relative jump' }, { status: 404 });
      }

      newDate = setSimulatedRelativeToDueDate(invoice.due_date, body.relativeDays);
      selectedInvoiceNumber = invoice.invoice_number;
      resultingDaysOverdue = computeDaysOverdue(invoice.due_date, newDate);
      daysDescription = `${body.relativeDays >= 0 ? '+' + body.relativeDays : body.relativeDays} days relative to ${invoice.invoice_number}`;
    } else {
      const days = Number(body.days);
      if (isNaN(days) || days <= 0) {
        return NextResponse.json({ error: 'Valid positive number of days or invoiceId with relativeDays required' }, { status: 400 });
      }
      newDate = advanceSimulatedDays(days);
      daysDescription = `+${days} days`;
    }

    // Run follow-up agent loop
    const agentResult = await runFollowUpAgent();

    return NextResponse.json({
      success: true,
      description: daysDescription,
      selectedInvoiceNumber,
      resultingDaysOverdue,
      simulatedDate: newDate.toISOString().split('T')[0],
      agentResult,
    });
  } catch (err: any) {
    console.error('Failed to advance clock and run agent:', err);
    return NextResponse.json({ error: err.message || 'Agent run failed' }, { status: 500 });
  }
}

