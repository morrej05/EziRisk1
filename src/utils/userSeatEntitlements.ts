import { supabase } from '../lib/supabase';
import type { Organisation } from './entitlements';
import { getUserLimitForOrganisation, resolveCanonicalPlanId } from './planLimits';

export interface UserSeatEntitlement {
  allowed: boolean;
  reason: string | null;
  resolved_plan: string;
  user_limit: number;
  active_member_count: number;
  is_over_limit: boolean;
}

const FALLBACK_REASON = 'Your organisation has reached its user seat limit. Upgrade to add more users.';
const DEFAULT_LIMIT_MESSAGE = 'Your organisation has reached the user limit for its current plan.';
const TRIAL_EXPIRED_MESSAGE = 'Your free trial has ended. Upgrade to add team members. Existing data is still available.';

interface UserSeatLimitCopy {
  title: string;
  body: string;
}

export async function getUserSeatEntitlement(organisationId: string): Promise<UserSeatEntitlement> {
  const { data, error } = await supabase.rpc('get_user_seat_entitlement', {
    p_org_id: organisationId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to check user seat entitlement');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('User seat entitlement result was empty');
  }

  return {
    allowed: Boolean(row.allowed),
    reason: row.reason ?? null,
    resolved_plan: row.resolved_plan ?? 'free',
    user_limit: Number(row.user_limit ?? 1),
    active_member_count: Number(row.active_member_count ?? 0),
    is_over_limit: Boolean(row.is_over_limit),
  };
}

export function getUserSeatUpgradeMessage(organisation: Organisation | null | undefined): string {
  const plan = resolveCanonicalPlanId(organisation);
  const currentLimit = getUserLimitForOrganisation(organisation);
  const displayPlan = plan.charAt(0).toUpperCase() + plan.slice(1);
  return `${displayPlan} includes up to ${currentLimit} active user${currentLimit === 1 ? '' : 's'}. Upgrade to add more users.`;
}

export function getUserSeatLimitCopy(
  _seatEntitlement: UserSeatEntitlement | null | undefined,
  organisation: Organisation | null | undefined,
): UserSeatLimitCopy {
  const resolvedPlan = resolveCanonicalPlanId(organisation);
  const userLimit = getUserLimitForOrganisation(organisation);

  return {
    title: 'User limit reached',
    body: `${resolvedPlan.charAt(0).toUpperCase() + resolvedPlan.slice(1)} includes ${userLimit} active user${userLimit === 1 ? '' : 's'}. Upgrade to add more users.`,
  };
}

export function normalizeSeatLimitErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return DEFAULT_LIMIT_MESSAGE;
  }

  if (error.message.includes('get_user_seat_entitlement')) {
    return 'Unable to verify user seat entitlement right now. Please retry in a moment or contact support if this continues.';
  }

  const normalised = error.message.trim().toLowerCase();
  if (normalised.includes('trial') && normalised.includes('expired')) {
    return TRIAL_EXPIRED_MESSAGE;
  }

  if (
    normalised.includes('user_limit_reached')
    || normalised.includes('user limit reached')
    || normalised.includes('seat limit')
    || normalised.includes('user seat limit')
    || normalised.includes('upgrade')
  ) {
    return DEFAULT_LIMIT_MESSAGE;
  }

  return error.message || FALLBACK_REASON;
}
