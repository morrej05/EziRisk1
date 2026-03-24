/**
 * Role Definitions and Responsibilities
 *
 * ADMIN (Organisation Admin):
 * - Manage organisation settings
 * - Manage users within their organisation
 * - Configure client branding
 * - View and upgrade subscription plans
 * - Access all features within their organisation's plan limits
 *
 * PLATFORM ADMIN (Platform Administrator):
 * - All admin permissions, plus:
 * - Manage all organisations across the platform
 * - Configure platform-wide settings
 * - Manage subscription plans and feature flags
 * - Impersonate organisations for support purposes
 * - Access global analytics and reporting
 * - Bypass all feature gates and subscription checks
 *
 * Note: Platform Admin is NOT a separate role.
 * Access is determined by the platform flag on the user state.
 */

export type PlanType = 'free' | 'standard' | 'professional';
export type PlanId = PlanType;
export type DisciplineType = 'engineering' | 'assessment' | 'both';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
export type UserRole = 'admin' | 'surveyor' | 'viewer';

export interface PlanConfig {
  reportLimit: number;
  userLimit: number;
  pdfWatermark: boolean;
  portfolioAccess: boolean;
}

const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: {
    reportLimit: 5,
    userLimit: 1,
    pdfWatermark: true,
    portfolioAccess: false,
  },
  standard: {
    reportLimit: 10,
    userLimit: 2,
    pdfWatermark: false,
    portfolioAccess: false,
  },
  professional: {
    reportLimit: 30,
    userLimit: 5,
    pdfWatermark: false,
    portfolioAccess: true,
  },
};

const DEFAULT_PLAN: PlanId = 'free';

export function isDev(): boolean {
  return import.meta.env.DEV === true;
}

export interface Organisation {
  id: string;
  name: string;
  plan_type?: string | null; // legacy field retained for backwards compatibility in data shape
  plan_id?: string | null;
  discipline_type: DisciplineType;
  enabled_addons: string[];
  max_editors: number;
  subscription_status: SubscriptionStatus;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_cycle?: 'monthly' | 'annual' | null;
  cancel_at_period_end?: boolean | null;
  stripe_current_period_end?: string | null;
  created_at?: string;
  updated_at?: string;
  trial_ends_at?: string | null;
}

export interface User {
  id: string;
  role: UserRole;
  is_platform_admin: boolean;
  platform?: boolean;
  can_edit: boolean;
  name?: string | null;
  organisation_id?: string | null;
}

export interface UserWithOrg extends User {
  organisation?: Organisation;
}

export function getPlan(org?: Organisation | null): PlanId {
  const raw = org?.plan_id;
  if (raw === 'free' || raw === 'standard' || raw === 'professional') {
    return raw;
  }
  return DEFAULT_PLAN;
}

export function getPlanConfig(org?: Organisation | null): PlanConfig {
  return PLAN_CONFIGS[getPlan(org)];
}

export function canCreateReport(org: Organisation | null | undefined, currentReportCount: number): boolean {
  return currentReportCount < getPlanConfig(org).reportLimit;
}

export function canInviteUser(org: Organisation | null | undefined, currentUserCount: number): boolean {
  return currentUserCount < getPlanConfig(org).userLimit;
}

export function isWatermarked(org?: Organisation | null): boolean {
  return getPlanConfig(org).pdfWatermark;
}

export function canAccessPortfolio(org?: Organisation | null): boolean {
  return getPlanConfig(org).portfolioAccess;
}

export function isOrgAdmin(user: User): boolean {
  return user.role === 'admin';
}

export function isPlatformAdmin(user: User): boolean {
  return user.platform === true || user.is_platform_admin === true;
}

export function getPlanTier(org: Organisation): PlanId {
  return getPlan(org);
}

export function isPaidActive(org?: Organisation | null): boolean {
  const status = org?.subscription_status;
  return status === 'active' || status === 'trialing';
}

export function canEdit(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return true;
  if (user.role === 'viewer') return false;
  if (!user.can_edit) return false;
  if (!org) return false;
  return isPaidActive(org);
}

export function canAccessProFeatures(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!org) return false;
  return getPlan(org) === 'professional' && isPaidActive(org);
}

export function canAccessExplosionSafety(user?: User | null, org?: Organisation | null): boolean {
  if (user && isPlatformAdmin(user)) return true;
  if (!org) return false;
  if (isDev()) return true;
  return getPlan(org) === 'professional' && isPaidActive(org);
}

export function hasAddon(user: User, org?: Organisation | null, addonKey?: string): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!org || !addonKey) return false;
  return org.enabled_addons?.includes(addonKey) ?? false;
}

export function canSwitchDiscipline(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!org) return false;
  return getPlan(org) === 'professional' && org.discipline_type === 'both';
}

export function canAccessAdmin(user: User): boolean {
  return isOrgAdmin(user);
}

export function canAccessPlatformSettings(user: User): boolean {
  return isPlatformAdmin(user);
}

export function canViewData(org?: Organisation | null): boolean {
  void org;
  return true;
}

export function canExportData(org?: Organisation | null): boolean {
  void org;
  return true;
}

export function isSubscriptionActive(org?: Organisation | null): boolean {
  return Boolean(org) && isPaidActive(org);
}

export function shouldShowUpgradePrompts(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return false;
  if (!org) return true;
  return getPlan(org) !== 'professional';
}

export function needsActiveSubscription(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return false;
  if (!org) return true;
  return !isPaidActive(org);
}

export function getMaxEditors(plan: PlanType): number {
  return PLAN_CONFIGS[plan].userLimit;
}

export function canManageUsers(user: User): boolean {
  return isOrgAdmin(user);
}

export function canManageBranding(user: User): boolean {
  return isOrgAdmin(user);
}

export function canCreateSurveys(user: User, org?: Organisation | null): boolean {
  return canEdit(user, org);
}

export function canDeleteSurveys(user: User): boolean {
  return isOrgAdmin(user);
}

export function canIssueSurveys(user: User, org?: Organisation | null): boolean {
  return canEdit(user, org);
}

export function canAccessPillarB(user: User, org?: Organisation | null): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!org) return false;

  const hasAccess = getPlan(org) === 'free' || getPlan(org) === 'standard' || getPlan(org) === 'professional';

  if (import.meta.env.DEV) {
    console.log('[PillarB/Assessments] 🔑 Access check:', {
      userId: user.id,
      orgId: org?.id,
      plan_id: org?.plan_id,
      resolved: getPlan(org),
      hasAccess,
      isPlatformAdmin: isPlatformAdmin(user),
    });
  }

  return hasAccess;
}

export function getPlanDisplayName(plan: PlanType | string): string {
  const planStr = plan.toString().trim().toLowerCase();
  if (planStr === 'professional') return 'Professional';
  if (planStr === 'standard') return 'Standard';
  if (planStr === 'free') return 'Free';
  return 'Free';
}

export function getSubscriptionStatusDisplayName(status: SubscriptionStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    case 'past_due':
      return 'Past Due';
    case 'canceled':
      return 'Canceled';
    case 'inactive':
      return 'No active subscription';
    default:
      return 'Unknown';
  }
}

export const PLAN_FEATURES = {
  free: {
    name: 'Free',
    maxEditors: PLAN_CONFIGS.free.userLimit,
    proFeatures: false,
    addons: false,
    disciplineSwitching: false,
    description: '7-day free trial, up to 5 reports, 1 user, PDF watermark',
  },
  standard: {
    name: 'Standard',
    maxEditors: PLAN_CONFIGS.standard.userLimit,
    proFeatures: false,
    addons: true,
    disciplineSwitching: false,
    description: 'Up to 10 reports, 2 users',
  },
  professional: {
    name: 'Professional',
    maxEditors: PLAN_CONFIGS.professional.userLimit,
    proFeatures: true,
    addons: true,
    disciplineSwitching: true,
    description: 'Up to 30 reports, 5 users, portfolio access',
  },
} as const;

export const ADDON_KEYS = {
  FRA_FORM: 'fra_form',
  BCM_FORM: 'bcm_form',
  ATEX_FORM: 'atex_form',
  ASEAR_FORM: 'asear_form',
};

export const ADDON_DISPLAY_NAMES = {
  [ADDON_KEYS.FRA_FORM]: 'Fire Risk Assessment',
  [ADDON_KEYS.BCM_FORM]: 'Business Continuity Management',
  [ADDON_KEYS.ATEX_FORM]: 'ATEX Assessment',
  [ADDON_KEYS.ASEAR_FORM]: 'ASEAR Assessment',
};

export const ENTITLEMENTS = {
  standard: {
    canAccessRiskEngineering: false,
    canGenerateAiExecutiveSummary: false,
    canShareWithClients: false,
    canUseApprovalWorkflow: false,
  },
  professional: {
    canAccessRiskEngineering: true,
    canGenerateAiExecutiveSummary: true,
    canShareWithClients: true,
    canUseApprovalWorkflow: true,
  },
} as const;

export function canAccessRiskEngineering(org?: Organisation | null): boolean {
  if (!org) return false;
  return getPlan(org) === 'professional' && ENTITLEMENTS.professional.canAccessRiskEngineering;
}

export function canGenerateAiSummary(org?: Organisation | null): boolean {
  if (!org) return false;
  return getPlan(org) === 'professional' && ENTITLEMENTS.professional.canGenerateAiExecutiveSummary;
}

export function canShareWithClients(org?: Organisation | null): boolean {
  if (!org) return false;
  return getPlan(org) === 'professional' && ENTITLEMENTS.professional.canShareWithClients;
}

export function canUseApprovalWorkflow(org?: Organisation | null): boolean {
  if (!org) return false;
  return getPlan(org) === 'professional' && ENTITLEMENTS.professional.canUseApprovalWorkflow;
}
