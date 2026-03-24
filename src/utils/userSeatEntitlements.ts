import { supabase } from '../lib/supabase';
import { getPlanConfig, getPlanDisplayName, type Organisation } from './entitlements';

export interface UserSeatEntitlement {
  allowed: boolean;
  reason: string | null;
  resolved_plan: string;
  user_limit: number;
  active_member_count: number;
  is_over_limit: boolean;
}

const FALLBACK_REASON = 'Your organisation has reached its user seat limit. Upgrade to add more users.';

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
    resolved_plan: row.resolved_plan ?? 'trial',
    user_limit: Number(row.user_limit ?? 1),
    active_member_count: Number(row.active_member_count ?? 0),
    is_over_limit: Boolean(row.is_over_limit),
  };
}

export function getUserSeatUpgradeMessage(organisation: Organisation | null | undefined): string {
  const plan = organisation?.plan_id ?? 'trial';
  const displayPlan = getPlanDisplayName(plan);
  const currentLimit = getPlanConfig(organisation).userLimit;
  return `${displayPlan} includes up to ${currentLimit} active user${currentLimit === 1 ? '' : 's'}. Upgrade to add more users.`;
}

export function normalizeSeatLimitErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return FALLBACK_REASON;
  }

  if (error.message.includes('get_user_seat_entitlement')) {
    return 'Unable to verify user seat entitlement right now. Please retry in a moment or contact support if this continues.';
  }

  if (error.message.includes('user seat limit')) {
    return error.message;
  }

  return error.message || FALLBACK_REASON;
}
