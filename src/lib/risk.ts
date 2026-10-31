export type RiskLevel = 'low' | 'medium' | 'high';

export interface PastInvoice {
  amount?: string | number;
  dueDate: string;      // YYYY-MM-DD or ISO string
  paidDate?: string | null; // YYYY-MM-DD or ISO string
  status?: string;
}

export interface ClientPaymentHistory {
  invoices?: PastInvoice[];
  clientAgeDays?: number;
}

export interface ClientScoreResult {
  score: number; // 0 - 100
  level: RiskLevel;
  reasons: string[];
  metrics: {
    totalInvoices: number;
    lateInvoices: number;
    averageDaysLate: number;
    typicalInvoiceSize: number;
  };
}

/**
 * Calculates days late between due date and paid date.
 * Returns 0 if paid on time or early.
 */
function getDaysLate(dueDateStr: string, paidDateStr?: string | null): number {
  if (!paidDateStr) return 0;
  const due = new Date(dueDateStr).getTime();
  const paid = new Date(paidDateStr).getTime();
  const diffDays = Math.round((paid - due) / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

/**
 * Pure function to score a client's risk (0-100) based on payment history and invoice amount.
 *
 * Inputs from payment history:
 * - average days late
 * - share of invoices paid late
 * - invoice size vs the client's typical size
 * - client age / history length (no history = medium risk with reason "New client, no payment history")
 */
export function scoreClient(
  history: ClientPaymentHistory | PastInvoice[] | null | undefined,
  invoiceAmount: string | number
): ClientScoreResult {
  const invoices: PastInvoice[] = Array.isArray(history)
    ? history
    : history?.invoices || [];

  const currentAmount = typeof invoiceAmount === 'number'
    ? invoiceAmount
    : parseFloat(invoiceAmount) || 0;

  // Case 1: No history -> Medium risk
  if (!invoices || invoices.length === 0) {
    return {
      score: 50,
      level: 'medium',
      reasons: ['New client, no payment history'],
      metrics: {
        totalInvoices: 0,
        lateInvoices: 0,
        averageDaysLate: 0,
        typicalInvoiceSize: 0,
      },
    };
  }

  const reasons: string[] = [];
  const totalInvoices = invoices.length;
  let lateCount = 0;
  let totalDaysLate = 0;
  let totalPastAmount = 0;

  for (const inv of invoices) {
    const invAmount = typeof inv.amount === 'number' ? inv.amount : parseFloat(String(inv.amount || '0'));
    totalPastAmount += isNaN(invAmount) ? 0 : invAmount;

    const daysLate = getDaysLate(inv.dueDate, inv.paidDate);
    if (daysLate > 0) {
      lateCount++;
      totalDaysLate += daysLate;
    }
  }

  const avgDaysLate = lateCount > 0 ? Math.round(totalDaysLate / lateCount) : 0;
  const lateRate = lateCount / totalInvoices;
  const typicalInvoiceSize = totalInvoices > 0 ? totalPastAmount / totalInvoices : 0;

  // Base score starting at 10 (low baseline)
  let score = 10;

  // 1. Share of invoices paid late
  if (lateCount === 0) {
    reasons.push(`Always pays on time (${totalInvoices} of ${totalInvoices} invoices paid on time)`);
  } else {
    // e.g. "Paid late on 3 of the last 4 invoices"
    reasons.push(`Paid late on ${lateCount} of the last ${totalInvoices} invoices`);
    score += Math.round(lateRate * 45); // up to +45
  }

  // 2. Average days late
  if (avgDaysLate > 0) {
    // e.g. "Average 19 days late"
    reasons.push(`Average ${avgDaysLate} days late`);
    // Scale days late: 1-7 days (+10), 8-14 days (+20), 15+ days (+30)
    const latenessScore = Math.min(30, Math.round(avgDaysLate * 1.5));
    score += latenessScore;
  }

  // 3. Invoice size vs typical size
  if (typicalInvoiceSize > 0 && currentAmount > typicalInvoiceSize * 1.5) {
    const ratio = (currentAmount / typicalInvoiceSize).toFixed(1);
    reasons.push(
      `Invoice amount ($${currentAmount.toFixed(2)}) is ${ratio}x higher than client's typical size ($${typicalInvoiceSize.toFixed(2)})`
    );
    score += 15;
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Risk Level classification:
  // Low: 0 - 35
  // Medium: 36 - 69
  // High: 70 - 100
  let level: RiskLevel = 'low';
  if (score >= 70) {
    level = 'high';
  } else if (score >= 35) {
    level = 'medium';
  }

  return {
    score,
    level,
    reasons,
    metrics: {
      totalInvoices,
      lateInvoices: lateCount,
      averageDaysLate: avgDaysLate,
      typicalInvoiceSize,
    },
  };
}
