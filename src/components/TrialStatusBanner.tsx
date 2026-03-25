import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getReportCreationEntitlement, type ReportCreationEntitlement } from '../utils/reportCreationEntitlements';

function getTrialDaysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;

  const now = new Date();
  const expiryDate = new Date(trialEndsAt);
  const diffMs = expiryDate.getTime() - now.getTime();

  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export default function TrialStatusBanner() {
  const { organisation } = useAuth();
  const [reportEntitlement, setReportEntitlement] = useState<ReportCreationEntitlement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchEntitlement = async () => {
      if (!organisation?.id || organisation.plan_id !== 'free') {
        setReportEntitlement(null);
        return;
      }

      try {
        const entitlement = await getReportCreationEntitlement(organisation.id);
        if (!cancelled) {
          setReportEntitlement(entitlement);
        }
      } catch (error) {
        console.error('[TrialStatusBanner] Failed to fetch report entitlements:', error);
      }
    };

    fetchEntitlement();

    return () => {
      cancelled = true;
    };
  }, [organisation?.id, organisation?.plan_id]);

  if (!organisation || organisation.plan_id !== 'free' || !reportEntitlement) {
    return null;
  }

  const reportLimit = reportEntitlement.monthly_report_limit || 5;
  const reportsUsed = reportEntitlement.monthly_report_count;
  const reportsRemaining = Math.max(0, reportLimit - reportsUsed);
  const daysRemaining = getTrialDaysRemaining(reportEntitlement.trial_ends_at ?? organisation.trial_ends_at ?? null);
  const isExpired = reportEntitlement.is_trial_expired;

  const statusTone = (() => {
    if (isExpired || reportsRemaining === 0) {
      return {
        container: 'border-red-200 bg-red-50',
        text: 'text-red-900',
        subtext: 'text-red-700',
        button: 'bg-red-600 text-white hover:bg-red-700',
      };
    }

    if (reportsRemaining <= 1 || (daysRemaining !== null && daysRemaining <= 2)) {
      return {
        container: 'border-amber-200 bg-amber-50',
        text: 'text-amber-900',
        subtext: 'text-amber-700',
        button: 'bg-amber-600 text-white hover:bg-amber-700',
      };
    }

    return {
      container: 'border-blue-200 bg-blue-50',
      text: 'text-blue-900',
      subtext: 'text-blue-700',
      button: 'bg-blue-600 text-white hover:bg-blue-700',
    };
  })();

  const trialSummary = isExpired
    ? `Trial expired • ${reportsUsed} of ${reportLimit} reports used`
    : `Trial: ${reportsUsed} of ${reportLimit} reports used • ${daysRemaining ?? 0} day${daysRemaining === 1 ? '' : 's'} remaining`;

  const secondaryMessage = isExpired
    ? 'Your free trial has ended. Existing data is still available. Upgrade to continue creating reports and adding users.'
    : reportsRemaining === 0
      ? 'You have reached your trial report limit. Upgrade to continue creating reports.'
      : reportsRemaining === 1
        ? 'You have 1 trial report remaining.'
        : null;

  return (
    <div className={`border-b ${statusTone.container}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${statusTone.text}`}>{trialSummary}</p>
            {secondaryMessage && <p className={`text-xs ${statusTone.subtext}`}>{secondaryMessage}</p>}
          </div>
          <Link
            to="/upgrade"
            className={`inline-flex w-fit items-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${statusTone.button}`}
          >
            Upgrade
          </Link>
        </div>
      </div>
    </div>
  );
}
