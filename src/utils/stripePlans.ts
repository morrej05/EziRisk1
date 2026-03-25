export type PlanType = 'standard' | 'professional';
export type PlanInterval = 'month' | 'year';
export type BillingCycle = 'monthly' | 'annual';

export interface StripePlanMapping {
  planType: PlanType;
  interval: PlanInterval;
}

const STRIPE_PRICE_STANDARD_MONTHLY =
  import.meta.env.VITE_STRIPE_PRICE_STANDARD_MONTHLY;
const STRIPE_PRICE_STANDARD_ANNUAL =
  import.meta.env.VITE_STRIPE_PRICE_STANDARD_ANNUAL;
const STRIPE_PRICE_PRO_MONTHLY = import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY;
const STRIPE_PRICE_PRO_ANNUAL = import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL;

const PLAN_PRICE_IDS: Record<PlanType, Record<BillingCycle, string | undefined>> = {
  standard: {
    monthly: STRIPE_PRICE_STANDARD_MONTHLY,
    annual: STRIPE_PRICE_STANDARD_ANNUAL,
  },
  professional: {
    monthly: STRIPE_PRICE_PRO_MONTHLY,
    annual: STRIPE_PRICE_PRO_ANNUAL,
  },
};

export const PRICE_TO_PLAN: Record<string, StripePlanMapping> = {
  [STRIPE_PRICE_STANDARD_MONTHLY || '']: {
    planType: 'standard',
    interval: 'month'
  },
  [STRIPE_PRICE_STANDARD_ANNUAL || '']: {
    planType: 'standard',
    interval: 'year'
  },
  [STRIPE_PRICE_PRO_MONTHLY || '']: {
    planType: 'professional',
    interval: 'month'
  },
  [STRIPE_PRICE_PRO_ANNUAL || '']: {
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

export function getPriceIdForPlan(planType: PlanType, billingCycle: BillingCycle): string | null {
  return PLAN_PRICE_IDS[planType][billingCycle] || null;
}
