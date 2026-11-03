import { generateText } from './llm';
import { ProposedTerms } from './terms';
import { RiskLevel } from './risk';

const EXPLAIN_SYSTEM_INSTRUCTION = `You are an assistant for an intelligent invoicing platform called OnTime.
Your job is to write a concise, professional, 2 to 3 sentence explanation for an approval card presented to a freelancer or business owner before they send an invoice.
The explanation explains why specific payment terms are recommended based on the client's risk assessment and pre-calculated terms.

CRITICAL RULES:
1. Write exactly 2 to 3 plain-English sentences.
2. The LLM NEVER does arithmetic or calculates amounts. All financial figures, discounts, deposits, and dates have already been calculated in code and supplied to you. Never compute, adjust, or recalculate numbers.
3. State the client's risk context directly and clearly based on the provided reasons.
4. Explain clearly why the proposed terms safeguard cash flow while remaining reasonable.`;

export interface ClientMetrics {
  totalInvoices?: number;
  lateInvoices?: number;
  averageDaysLate?: number;
  typicalInvoiceSize?: number;
}

/**
 * Generates 2-3 plain-English sentences for the approval card.
 * Receives the real numbers from the database (invoice count, late count, average days late, proposed amounts).
 * The prompt receives finished numbers from code and must not compute anything.
 */
export async function explainRecommendation(
  score: number,
  level: RiskLevel | string,
  reasons: string[],
  terms: ProposedTerms | Record<string, any>,
  metrics?: ClientMetrics
): Promise<string> {
  const reasonsList = reasons && reasons.length > 0
    ? reasons.map((r) => `- ${r}`).join('\n')
    : '- No prior payment history or risk factors recorded';

  let termsSummary = `Recommended Terms: ${terms.summary || terms.termType || 'Custom'}\nTotal Amount: $${terms.totalAmount}`;
  if (terms.discountAmount) {
    termsSummary += `\nEarly-pay Discount: $${terms.discountAmount} (${terms.discountPercentage}% off, net payable $${terms.discountedAmount} within ${terms.netDays} days)`;
  }
  if (terms.depositAmount) {
    termsSummary += `\nUpfront Deposit: $${terms.depositAmount} (${terms.depositPercentage}%), Delivery Balance: $${terms.deliveryAmount} (${terms.deliveryPercentage}%)`;
  }
  if (terms.description) {
    termsSummary += `\nTerm Details: ${terms.description}`;
  }

  const prompt = `Write 2 to 3 plain-English sentences for the approval card explaining this payment terms recommendation.

REAL DATABASE CLIENT FACTS:
- Past Invoice Count: ${metrics?.totalInvoices ?? (reasons.some(r => r.includes('New client')) ? 0 : 'N/A')}
- Past Late Count: ${metrics?.lateInvoices ?? 0}
- Average Days Late: ${metrics?.averageDaysLate ?? 0}
- Risk Score: ${score}/100
- Risk Level: ${level.toUpperCase()}
- Identified Risk Factors:
${reasonsList}

PROPOSED AMOUNTS (ALREADY CALCULATED IN CODE):
${termsSummary}

INSTRUCTIONS:
- Use ONLY the facts provided. Do not state any number or history that is not in the input.
- Return exactly 2 to 3 clear, professional, plain-English sentences explaining why these terms are recommended.
- The LLM NEVER computes numbers or does arithmetic. State the pre-computed figures exactly as given.`;

  try {
    return await generateText(prompt, EXPLAIN_SYSTEM_INSTRUCTION, 'low');
  } catch (err: any) {
    console.warn('Gemini text generation failed, using grounded fallback explanation:', err?.message || err);
    if (level === 'high') {
      return `Based on a high risk score of ${score}/100 and a history of late payments (${reasons[0] || 'past delays'}), structured milestone terms are recommended. We propose a 40% upfront deposit of $${terms.depositAmount} before work commences and a 60% balance of $${terms.deliveryAmount} upon delivery. This structure safeguards your cash flow while remaining transparent and fair for the client.`;
    }
    if (level === 'medium') {
      return `This client has a moderate risk score of ${score}/100 (${reasons[0] || 'new client'}). We recommend Net-7 payment terms with a 2% early-pay discount to encourage timely settlement. Paying within 7 days allows the client to save $${terms.discountAmount}, paying $${terms.discountedAmount} instead of the full $${terms.totalAmount}.`;
    }
    return `With a low risk score of ${score}/100 and a consistent on-time payment track record, this client qualifies for standard Net-14 terms. Full amount ($${terms.totalAmount}) is due within 14 days of invoice issue. This reinforces a reliable working relationship while preserving predictable cash flow.`;
  }
}
