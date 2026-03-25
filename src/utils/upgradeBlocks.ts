export type UpgradeBlockReason = 'report_limit' | 'user_limit' | 'trial_expired' | 'portfolio_locked';

interface ReportEntitlementLike {
  reason?: string | null;
  is_trial_expired?: boolean;
}

const TRIAL_EXPIRED_PATTERN = /(trial).*(expired)/i;

export function inferReportUpgradeReason(entitlement?: ReportEntitlementLike | null): UpgradeBlockReason {
  if (entitlement?.is_trial_expired) {
    return 'trial_expired';
  }

  if (TRIAL_EXPIRED_PATTERN.test(entitlement?.reason ?? '')) {
    return 'trial_expired';
  }

  return 'report_limit';
}

export function inferReportUpgradeReasonFromMessage(message?: string | null): UpgradeBlockReason {
  if (TRIAL_EXPIRED_PATTERN.test(message ?? '')) {
    return 'trial_expired';
  }

  return 'report_limit';
}

export function inferUserUpgradeReason(): UpgradeBlockReason {
  return 'user_limit';
}
