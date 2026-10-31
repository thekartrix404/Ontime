import { RiskLevel } from './risk';

export interface ProposedTerms {
  level: RiskLevel;
  summary: string;
  termType: 'NET_14' | 'NET_7' | 'DEPOSIT_AND_DELIVERY';
  totalAmount: string; // e.g. "1200.00"
  netDays: number;
  description: string;

  // Medium risk discount fields
  discountPercentage?: number; // 2
  discountAmount?: string;     // e.g. "24.00"
  discountedAmount?: string;   // e.g. "1176.00"

  // High risk milestone fields
  depositPercentage?: number;  // 40
  depositAmount?: string;      // e.g. "480.00"
  deliveryPercentage?: number; // 60
  deliveryAmount?: string;     // e.g. "720.00"
}

/**
 * Pure function to propose terms based on the client risk level and total invoice amount.
 * All amounts are strictly calculated in code and returned as strings like "480.00".
 *
 * Rules:
 * - low = Net-14
 * - medium = Net-7 + 2% early-pay discount
 * - high = 40% deposit and 60% on delivery
 */
export function proposeTerms(
  level: RiskLevel,
  invoiceAmount: string | number
): ProposedTerms {
  const total = typeof invoiceAmount === 'number'
    ? invoiceAmount
    : parseFloat(invoiceAmount) || 0;

  // Money arithmetic in cents to avoid floating point imprecision
  const totalCents = Math.round(total * 100);
  const totalAmountStr = (totalCents / 100).toFixed(2);

  switch (level) {
    case 'low': {
      return {
        level: 'low',
        termType: 'NET_14',
        summary: 'Net-14',
        netDays: 14,
        totalAmount: totalAmountStr,
        description: `Net-14 payment terms. Full amount ($${totalAmountStr}) due within 14 days of invoice.`,
      };
    }

    case 'medium': {
      const discountCents = Math.round(totalCents * 0.02);
      const discountedCents = totalCents - discountCents;
      const discountAmountStr = (discountCents / 100).toFixed(2);
      const discountedAmountStr = (discountedCents / 100).toFixed(2);

      return {
        level: 'medium',
        termType: 'NET_7',
        summary: 'Net-7 + 2% early-pay discount',
        netDays: 7,
        totalAmount: totalAmountStr,
        discountPercentage: 2,
        discountAmount: discountAmountStr,
        discountedAmount: discountedAmountStr,
        description: `Net-7 with 2% early-pay discount. Pay $${discountedAmountStr} if paid within 7 days, or full amount ($${totalAmountStr}) thereafter.`,
      };
    }

    case 'high': {
      const depositCents = Math.round(totalCents * 0.40);
      const deliveryCents = totalCents - depositCents;
      const depositAmountStr = (depositCents / 100).toFixed(2);
      const deliveryAmountStr = (deliveryCents / 100).toFixed(2);

      return {
        level: 'high',
        termType: 'DEPOSIT_AND_DELIVERY',
        summary: '40% deposit / 60% on delivery',
        netDays: 0,
        totalAmount: totalAmountStr,
        depositPercentage: 40,
        depositAmount: depositAmountStr,
        deliveryPercentage: 60,
        deliveryAmount: deliveryAmountStr,
        description: `40% upfront deposit ($${depositAmountStr}) required before work commences, and 60% balance ($${deliveryAmountStr}) upon final delivery.`,
      };
    }
  }
}
