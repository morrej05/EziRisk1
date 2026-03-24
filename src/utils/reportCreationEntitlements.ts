import { supabase } from '../lib/supabase';

export interface ReportCreationEntitlement {
  allowed: boolean;
  reason: string | null;
  resolved_plan: 'free' | 'standard' | 'professional' | string;
  monthly_report_limit: number;
  monthly_report_count: number;
  trial_ends_at: string | null;
  is_trial_expired: boolean;
}

export async function getReportCreationEntitlement(organisationId: string): Promise<ReportCreationEntitlement> {
  const { data, error } = await supabase.rpc('get_report_creation_entitlement', {
    p_org_id: organisationId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to check report creation entitlements');
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    allowed: Boolean(row?.allowed),
    reason: row?.reason ?? null,
    resolved_plan: row?.resolved_plan ?? 'free',
    monthly_report_limit: Number(row?.monthly_report_limit ?? 0),
    monthly_report_count: Number(row?.monthly_report_count ?? 0),
    trial_ends_at: row?.trial_ends_at ?? null,
    is_trial_expired: Boolean(row?.is_trial_expired),
  };
}
