import { useMemo, useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  getPlan,
  getPlanConfig,
  getPlanDisplayName,
  getSubscriptionStatusDisplayName,
  type PlanId,
} from '../utils/entitlements';
import { getUserLimitForOrganisation } from '../utils/planLimits';
import { getReportCreationEntitlement, type ReportCreationEntitlement } from '../utils/reportCreationEntitlements';
import { getUserSeatEntitlement, type UserSeatEntitlement } from '../utils/userSeatEntitlements';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getPrimaryCta(plan: PlanId) {
  if (plan === 'professional') {
    return 'Manage subscription';
  }

  if (plan === 'trial') {
    return 'Upgrade to Standard (10 reports • 2 users)';
  }

  return 'Upgrade to Professional (30 reports • 5 users)';
}

function getSecondaryCta(plan: PlanId) {
  if (plan === 'trial') return 'Upgrade to Professional (30 reports • 5 users)';
  return null;
}

function getPlanDescriptor(plan: PlanId): string {
  if (plan === 'trial') return 'Includes 5 reports and 1 user';
  if (plan === 'professional') return '30 reports per month • up to 5 users • portfolio access';
  return '10 reports per month • up to 2 users';
}

export default function AdminBillingPanel() {
  const navigate = useNavigate();
  const { organisation } = useAuth();
  const [reportEntitlement, setReportEntitlement] = useState<ReportCreationEntitlement | null>(null);
  const [seatEntitlement, setSeatEntitlement] = useState<UserSeatEntitlement | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchBillingData = async () => {
      if (!organisation?.id) {
        setIsLoading(false);
        return;
      }

      try {
        const [reportData, seatData] = await Promise.all([
          getReportCreationEntitlement(organisation.id),
          getUserSeatEntitlement(organisation.id),
        ]);
        setReportEntitlement(reportData);
        setSeatEntitlement(seatData);
      } catch (error) {
        console.error('[AdminBillingPanel] Failed to load billing data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBillingData();
  }, [organisation?.id]);

  const planId = getPlan(organisation);
  const planName = getPlanDisplayName(planId);
  const planConfig = getPlanConfig(organisation);
  const reportLimit = reportEntitlement?.monthly_report_limit ?? planConfig.reportLimit;
  const reportsUsed = reportEntitlement?.monthly_report_count ?? 0;
  const seatLimit = seatEntitlement?.user_limit ?? getUserLimitForOrganisation(organisation);
  const seatsUsed = seatEntitlement?.active_member_count ?? 0;

  const statusLabel = useMemo(() => {
    if (planId === 'trial') {
      return reportEntitlement?.is_trial_expired ? 'Trial expired' : 'Trial';
    }
    return getSubscriptionStatusDisplayName(organisation?.subscription_status ?? 'inactive');
  }, [organisation?.subscription_status, planId, reportEntitlement?.is_trial_expired]);

  const trialExpiry = reportEntitlement?.trial_ends_at || organisation?.trial_ends_at || null;
  const trialDaysRemaining = useMemo(() => {
    if (planId !== 'trial' || !trialExpiry) return null;
    const now = new Date();
    const expiryDate = new Date(trialExpiry);
    const diffMs = expiryDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [planId, trialExpiry]);
  const isTrialNearExpiry = (trialDaysRemaining ?? Number.MAX_SAFE_INTEGER) <= 2;
  const primaryCta = getPrimaryCta(planId);
  const secondaryCta = getSecondaryCta(planId);
  const planDescriptor = getPlanDescriptor(planId);

  return (
    <div className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-6">
      <h2 className="text-xl font-semibold text-slate-900 mb-2">Billing</h2>
      <p className="text-sm text-slate-600 mb-5">
        Plan and upgrade decisions. For detailed operational tracking, use the Usage & Limits tab.
      </p>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Current plan</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">{planName}</dd>
          <p className="text-sm text-slate-600 mt-1">{planDescriptor}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">{statusLabel}</dd>
          {planId === 'trial' && trialExpiry && (
            <p
              className={`text-sm mt-1 ${isTrialNearExpiry ? 'text-amber-700 font-medium' : 'text-slate-600'}`}
            >
              {trialDaysRemaining !== null && trialDaysRemaining <= 7
                ? `Trial expires in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}`
                : `Trial ends on ${formatDate(trialExpiry)}`}
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <p className="text-xs uppercase tracking-wide text-slate-500 px-1">Plan usage snapshot</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Reports used this month</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">
            {isLoading ? 'Loading…' : `${reportsUsed} / ${reportLimit}`}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Seats in use</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">
            {isLoading ? 'Loading…' : `${seatsUsed} / ${seatLimit}`}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/upgrade')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <CreditCard className="w-4 h-4" />
          {primaryCta}
        </button>
        {secondaryCta && (
          <button
            onClick={() => navigate('/upgrade')}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
          >
            {secondaryCta}
          </button>
        )}
      </div>
    </div>
  );
}
