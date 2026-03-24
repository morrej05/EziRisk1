export type PlanType = 'standard' | 'professional';
export type PlanInterval = 'month' | 'year';

export interface StripePlanMapping {
  planType: PlanType;
  interval: PlanInterval;
}

const STRIPE_PRICE_STANDARD_MONTHLY =
  import.meta.env.VITE_STRIPE_PRICE_STANDARD_MONTHLY || import.meta.env.VITE_STRIPE_PRICE_CORE_MONTHLY;
const STRIPE_PRICE_STANDARD_ANNUAL =
  import.meta.env.VITE_STRIPE_PRICE_STANDARD_ANNUAL || import.meta.env.VITE_STRIPE_PRICE_CORE_ANNUAL;

export const PRICE_TO_PLAN: Record<string, StripePlanMapping> = {
  [STRIPE_PRICE_STANDARD_MONTHLY || '']: {
    planType: 'standard',
    interval: 'month'
  },
  [STRIPE_PRICE_STANDARD_ANNUAL || '']: {
    planType: 'standard',
    interval: 'year'
  },
  [import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY || '']: {
    planType: 'professional',
    interval: 'month'
  },
  [import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL || '']: {
    planType: 'professional',
    interval: 'year'
  },
};

export function getPlanFromPriceId(priceId: string): StripePlanMapping | null {
  return PRICE_TO_PLAN[priceId] || null;
}

export function getDefaultPlan(): PlanType {
  return 'standard';
}
