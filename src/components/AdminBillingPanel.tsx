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

      <p className="text-sm text-slate-600 mb-4">
        Manage billing, payment methods, invoices, and cancellation in Stripe.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/upgrade')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <CreditCard className="w-4 h-4" />
          Upgrade plan
        </button>

        {planId !== 'free' && (
          <>
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

      <p className="text-xs text-slate-500 mt-4">Need a larger deployment? Contact us.</p>
    </div>
  );
}
