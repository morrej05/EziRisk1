export const PRICING = {
  US: {
    currency: 'USD',
    symbol: '$',
    free: { monthly: 0, annual: 0 },
    standard: { monthly: 99, annual: 990 },
    professional: { monthly: 189, annual: 1890 },
  },
  UK: {
    currency: 'GBP',
    symbol: '£',
    free: { monthly: 0, annual: 0 },
    standard: { monthly: 79, annual: 790 },
    professional: { monthly: 149, annual: 1490 },
  },
} as const;

export type Region = keyof typeof PRICING;
export type PlanTier = 'free' | 'standard' | 'professional';
export type BillingPeriod = 'monthly' | 'annual';

export function getPricing(region: Region, tier: PlanTier, period: BillingPeriod): number {
  return PRICING[region][tier][period];
}

export function formatPrice(region: Region, amount: number): string {
  const { symbol } = PRICING[region];
  return `${symbol}${amount}`;
}

export function getDefaultRegion(): Region {
  return 'UK';
}
