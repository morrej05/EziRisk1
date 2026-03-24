import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { type UpgradeBlockReason } from '../utils/upgradeBlocks';
import { useAuth } from '../contexts/AuthContext';
import { getPlan } from '../utils/entitlements';

interface UpgradeExperienceCopy {
  title: string;
  reason: string;
  attemptedAction: string;
  unlocks: string;
}

interface UpgradeBlockModalProps {
  open: boolean;
  reason: UpgradeBlockReason;
  detail?: string | null;
  onClose: () => void;
  onUpgrade: () => void;
}

const COPY: Record<UpgradeBlockReason, UpgradeExperienceCopy> = {
  report_limit: {
    title: 'Report limit reached',
    reason: 'You’ve used all reports for this month.',
    attemptedAction: 'You’re trying to create a new report.',
    unlocks: 'Upgrade to continue creating reports this month.',
  },
  user_limit: {
    title: 'User limit reached',
    reason: 'You’ve reached the active user cap on your current plan.',
    attemptedAction: 'You’re trying to add another team member.',
    unlocks: 'Upgrade to add more users and keep collaboration moving.',
  },
  trial_expired: {
    title: 'Trial expired',
    reason: 'Your trial period has ended.',
    attemptedAction: 'You’re trying to keep creating reports and managing your workspace.',
    unlocks: 'Upgrade to restore full access and continue working without interruption.',
  },
  portfolio_locked: {
    title: 'Portfolio locked',
    reason: 'Portfolio analytics are not included in your current plan.',
    attemptedAction: 'You’re trying to view portfolio-level trends and exports.',
    unlocks: 'Upgrade to unlock portfolio tools and cross-site insight reporting.',
  },
};

export default function UpgradeBlockModal({
  open,
  reason,
  detail,
  onClose,
  onUpgrade,
}: UpgradeBlockModalProps) {
  const { organisation } = useAuth();
  if (!open) return null;

  const copy = COPY[reason];
  const currentPlan = getPlan(organisation);
  const actionLabel = currentPlan === 'trial'
    ? 'Upgrade to Standard'
    : currentPlan === 'professional'
      ? 'Manage subscription'
      : 'Upgrade to Professional';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-slate-700" />
            <h3 className="text-lg font-semibold text-slate-900">{copy.title}</h3>
          </div>
        </div>
        <div className="space-y-3 px-6 py-5">
          <div className="space-y-2 text-sm text-slate-700">
            <p>{copy.reason}</p>
            <p>{copy.attemptedAction}</p>
            <p className="font-medium text-slate-900">{copy.unlocks}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Plan value</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Standard: 10 reports per month • up to 2 users</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Professional: 30 reports per month • up to 5 users • portfolio tools</li>
            </ul>
          </div>
          {detail && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{detail}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Not now
          </button>
          <button
            onClick={onUpgrade}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
