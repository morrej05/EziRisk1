import type { Organisation } from './entitlements';

export type CanonicalPlanId = 'free' | 'standard' | 'professional';

export const PLAN_LIMITS: Record<CanonicalPlanId, { users: number }> = {
  free: { users: 1 },
  standard: { users: 2 },
  professional: { users: 5 },
};

export function resolveCanonicalPlanId(organisation?: Organisation | null): CanonicalPlanId {
  const plan = (organisation?.plan_id ?? 'free').toString().trim().toLowerCase();

  if (plan === 'free' || plan === 'standard' || plan === 'professional') {
    return plan;
  }

  return 'free';
}

export function getUserLimitForOrganisation(organisation?: Organisation | null): number {
  return PLAN_LIMITS[resolveCanonicalPlanId(organisation)].users;
}
