export interface MandateConfig {
  autoSendTones: string[];
  requireApprovalForTones: string[];
  maxLateFeePercent: number;
}

export const mandate: MandateConfig = {
  autoSendTones: ['friendly', 'nudge', 'neutral'],
  requireApprovalForTones: ['firm', 'formal'],
  maxLateFeePercent: 5,
};

/**
 * Returns the mandate rules as plain-English strings for display in the UI / audit log.
 */
export function getMandateRules(): string[] {
  return [
    `Auto-send tones permitted without review: ${mandate.autoSendTones.join(', ')}.`,
    `Tones requiring explicit human approval: ${mandate.requireApprovalForTones.join(', ')} (firm & formal tones are blocked from auto-sending).`,
    `Maximum allowable proposed late fee is ${mandate.maxLateFeePercent}%. Any fee exceeding this threshold is blocked.`,
    `Escalations are drafted into the approval queue only and are never sent directly to clients.`,
  ];
}

