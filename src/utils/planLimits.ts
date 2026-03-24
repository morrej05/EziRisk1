import type { Organisation } from './entitlements';

export type CanonicalPlanId = 'solo' | 'team' | 'consultancy';

export const PLAN_LIMITS: Record<CanonicalPlanId, { users: number }> = {
  solo: { users: 1 },
  team: { users: 5 },
  consultancy: { users: 20 },
};

export function resolveCanonicalPlanId(organisation?: Organisation | null): CanonicalPlanId {
  const plan = (organisation?.plan_id ?? organisation?.plan_type ?? 'solo').toString().trim().toLowerCase();

  if (plan === 'team' || plan === 'consultancy' || plan === 'solo') {
    return plan;
  }

  return 'solo';
}

export function getUserLimitForOrganisation(organisation?: Organisation | null): number {
  return PLAN_LIMITS[resolveCanonicalPlanId(organisation)].users;
}
