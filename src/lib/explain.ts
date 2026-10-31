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

/**
 * Generates 2-3 plain-English sentences for the approval card.
 * The prompt receives finished numbers from code and must not compute anything.
 */
export async function explainRecommendation(
  score: number,
  level: RiskLevel | string,
  reasons: string[],
  terms: ProposedTerms | Record<string, any>
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

CLIENT RISK ASSESSMENT:
- Risk Score: ${score}/100
- Risk Level: ${level.toUpperCase()}
- Identified Factors:
${reasonsList}

PRE-CALCULATED TERMS (DO NOT RECALCULATE ANY NUMBERS):
${termsSummary}

Instructions:
- Return exactly 2 to 3 clear, professional sentences explaining why these terms are recommended.
- Do not compute, change, or invent any monetary figures; use the pre-computed figures exactly as given.`;

  return generateText(prompt, EXPLAIN_SYSTEM_INSTRUCTION, 'low');
}
