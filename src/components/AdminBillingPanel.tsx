import { useMemo, useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
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

type CanonicalPlanId = 'free' | 'standard' | 'professional';

function resolvePlanId(organisation: any): CanonicalPlanId {
  const rawPlan = organisation?.plan_id ?? 'free';

  if (rawPlan === 'standard' || rawPlan === 'professional' || rawPlan === 'free') {
    return rawPlan;
  }

  return 'free';
}

function getPlanLabel(planId: CanonicalPlanId): string {
  switch (planId) {
    case 'standard':
      return 'Standard';
    case 'professional':
      return 'Professional';
    case 'free':
    default:
      return 'Free';
  }
}

function getStatusLabel(status?: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'past_due':
      return 'Past due';
    case 'canceled':
      return 'Canceled';
    case 'trialing':
      return 'Trial';
    case 'unpaid':
      return 'Unpaid';
    case 'inactive':
    default:
      return 'Inactive';
  }
}

export default function AdminBillingPanel() {
  const navigate = useNavigate();
  const { organisation } = useAuth();
  const [reportEntitlement, setReportEntitlement] = useState<ReportCreationEntitlement | null>(null);
  const [seatEntitlement, setSeatEntitlement] = useState<UserSeatEntitlement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [isConfirmingDowngrade, setIsConfirmingDowngrade] = useState(false);
  const [planChangeMessage, setPlanChangeMessage] = useState<string | null>(null);
  const [planChangeError, setPlanChangeError] = useState<string | null>(null);

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

  const openStripePortal = async () => {
    if (!organisation?.id || isOpeningPortal) return;

    setIsOpeningPortal(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-portal-session`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            organisationId: organisation.id,
            returnUrl: `${window.location.origin}/admin`,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to open billing portal');
      }

      if (data.portalUrl || data.url) {
        window.location.href = data.portalUrl || data.url;
        return;
      }

      throw new Error('No portal URL returned');
    } catch (error) {
      console.error('[AdminBillingPanel] Failed to open Stripe portal:', error);
      alert('Unable to open billing management right now. Please try again.');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const confirmDowngradeToStandard = async () => {
    if (!organisation?.id || isChangingPlan) return;

    setIsChangingPlan(true);
    setPlanChangeMessage(null);
    setPlanChangeError(null);

    try {
      const { error } = await supabase.functions.invoke('change-subscription-plan', {
        body: {
          organisationId: organisation.id,
          targetPlan: 'standard',
        },
      });

      if (error) {
        throw new Error(error.message || 'Failed to change plan');
      }

      setPlanChangeMessage('Your plan has been updated to Standard.');
      setIsConfirmingDowngrade(false);
    } catch (error) {
      console.error('[AdminBillingPanel] Failed to downgrade plan:', error);
      setPlanChangeError('Unable to downgrade to Standard right now. Please try again.');
    } finally {
      setIsChangingPlan(false);
    }
  };

  const planId = resolvePlanId(organisation);
  const planName = getPlanLabel(planId);

  const reportLimit = reportEntitlement?.monthly_report_limit ?? 0;
  const reportsUsed = reportEntitlement?.monthly_report_count ?? 0;
  const seatLimit = seatEntitlement?.user_limit ?? getUserLimitForOrganisation(organisation);
  const seatsUsed = seatEntitlement?.active_member_count ?? 0;

  const statusLabel = useMemo(() => {
    return getStatusLabel(organisation?.subscription_status);
  }, [organisation?.subscription_status]);

  const trialExpiry = reportEntitlement?.trial_ends_at || organisation?.trial_ends_at || null;
  const trialDaysRemaining = useMemo(() => {
    if (planId !== 'free' || !trialExpiry) return null;
    const now = new Date();
    const expiryDate = new Date(trialExpiry);
    const diffMs = expiryDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [planId, trialExpiry]);

  const hasCancellationScheduled = Boolean(organisation?.cancel_at_period_end && organisation?.stripe_current_period_end);
  const isOverPlanLimit = seatsUsed > seatLimit || reportsUsed > reportLimit;
  const reportUsagePercent = reportLimit > 0 ? (reportsUsed / reportLimit) * 100 : 0;
  const seatUsagePercent = seatLimit > 0 ? (seatsUsed / seatLimit) * 100 : 0;
  const isReportLimitReached = reportLimit > 0 && reportsUsed >= reportLimit;
  const isSeatLimitReached = seatLimit > 0 && seatsUsed >= seatLimit;
  const isNearReportLimit = !isReportLimitReached && reportUsagePercent >= 80;
  const isNearSeatLimit = !isSeatLimitReached && seatUsagePercent >= 80;

  return (
    <div className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-6">
      <h2 className="text-xl font-semibold text-slate-900 mb-2">Billing</h2>
      <p className="text-sm text-slate-600 mb-5">
        Current subscription and usage snapshot for your organisation.
      </p>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Current plan</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">{planName}</dd>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Subscription status</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">{statusLabel}</dd>
          {planId === 'free' && trialExpiry && (
            <p className="text-sm mt-1 text-slate-600">
              {trialDaysRemaining !== null && trialDaysRemaining <= 7
                ? `Trial expires in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}`
                : `Trial ends on ${formatDate(trialExpiry)}`}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Current report usage</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">
            {isLoading ? 'Loading…' : `${reportsUsed} / ${reportLimit}`}
          </dd>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Current seat usage</dt>
          <dd className="text-base font-semibold text-slate-900 mt-1">
            {isLoading ? 'Loading…' : `${seatsUsed} / ${seatLimit}`}
          </dd>
        </div>
      </dl>

      {hasCancellationScheduled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Your subscription will remain active until the end of the current billing period. After that, your organisation will move to Free.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Current period end: {formatDate(organisation.stripe_current_period_end)}
          </p>
        </div>
      )}

      {isOverPlanLimit && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">
            Your organisation is above the limits of its current plan. Existing data is preserved, but some actions may be restricted until usage is back within limits.
          </p>
        </div>
      )}

      {isNearReportLimit && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            You’ve used {reportsUsed} of {reportLimit} reports this month.
          </p>
        </div>
      )}

      {isReportLimitReached && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">
            You’ve reached your monthly report limit ({reportLimit}). Upgrade to continue creating reports.
          </p>
          <button
            onClick={() => navigate('/upgrade')}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 transition-colors"
          >
            Upgrade
          </button>
        </div>
      )}

      {isNearSeatLimit && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            You’re close to your seat limit ({seatsUsed} of {seatLimit} users).
          </p>
        </div>
      )}

      {isSeatLimitReached && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">
            You’ve reached your user limit ({seatLimit}). Upgrade to add more team members.
          </p>
          <button
            onClick={() => navigate('/upgrade')}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 transition-colors"
          >
            Upgrade
          </button>
        </div>
      )}

      <p className="text-sm text-slate-600 mb-4">
        Manage billing, payment methods, invoices, and cancellation in Stripe.
      </p>
      <p className="text-sm text-slate-600 mb-4">
        Plan changes keep your existing data. If your organisation is above the limits of the new plan, some actions may be restricted until usage is back within limits.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {planId === 'free' && (
          <>
            <button
              onClick={() => navigate('/upgrade?plan=standard')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Upgrade to Standard
            </button>
            <button
              onClick={() => navigate('/upgrade?plan=professional')}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Upgrade to Professional
            </button>
          </>
        )}

        {planId === 'standard' && (
          <>
            <button
              onClick={() => navigate('/upgrade?plan=professional')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Upgrade to Professional
            </button>
            <button
              onClick={openStripePortal}
              disabled={isOpeningPortal}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-60"
            >
              {isOpeningPortal ? 'Opening Stripe…' : 'Manage billing'}
            </button>
            <button
              onClick={openStripePortal}
              disabled={isOpeningPortal}
              className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              Cancel subscription
            </button>
          </>
        )}

        {planId === 'professional' && (
          <>
            <button
              onClick={() => setIsConfirmingDowngrade(true)}
              disabled={isChangingPlan}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-60"
            >
              Downgrade to Standard
            </button>
            <button
              onClick={openStripePortal}
              disabled={isOpeningPortal}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-60"
            >
              {isOpeningPortal ? 'Opening Stripe…' : 'Manage billing'}
            </button>

            <button
              onClick={openStripePortal}
              disabled={isOpeningPortal}
              className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              Cancel subscription
            </button>
          </>
        )}
      </div>

      {planChangeMessage && <p className="text-sm text-green-700 mt-3">{planChangeMessage}</p>}
      {planChangeError && <p className="text-sm text-red-700 mt-3">{planChangeError}</p>}

      <p className="text-xs text-slate-500 mt-4">Need a larger deployment? Contact us.</p>

      {isConfirmingDowngrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Confirm downgrade</h3>
            <p className="text-sm text-slate-700 mb-3">
              Downgrading to Standard reduces your limits to:
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-700 mb-3 space-y-1">
              <li>2 users</li>
              <li>10 reports per month</li>
            </ul>
            <p className="text-sm text-slate-700">Existing data will be retained.</p>
            <p className="text-sm text-slate-700 mt-1">
              If you are above these limits, some actions will be restricted until usage is reduced.
            </p>
            {(seatsUsed > 2 || reportsUsed > 10) && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-900">
                Your organisation currently exceeds Standard plan limits. Downgrading will preserve existing data, but some actions will be restricted until usage is reduced.
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsConfirmingDowngrade(false)}
                disabled={isChangingPlan}
                className="inline-flex items-center px-4 py-2 border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmDowngradeToStandard}
                disabled={isChangingPlan}
                className="inline-flex items-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {isChangingPlan ? 'Confirming…' : 'Confirm downgrade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
