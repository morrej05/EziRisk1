import { AlertTriangle, Lock } from 'lucide-react';
import { type UpgradeBlockReason } from '../utils/upgradeBlocks';

interface UpgradeBlockModalProps {
  open: boolean;
  reason: UpgradeBlockReason;
  detail?: string | null;
  onClose: () => void;
  onUpgrade: () => void;
}

const COPY: Record<UpgradeBlockReason, { title: string; description: string }> = {
  report_limit: {
    title: 'Monthly report limit reached',
    description: 'You have reached your current plan report allowance. Upgrade to create more reports.',
  },
  user_limit: {
    title: 'User seat limit reached',
    description: 'Your organisation has reached its active user limit. Upgrade to invite more users.',
  },
  trial_expired: {
    title: 'Trial expired',
    description: 'Your 7-day trial has expired. Upgrade to continue creating reports.',
  },
  portfolio_locked: {
    title: 'Portfolio access requires upgrade',
    description: 'Portfolio analytics are available on plans with portfolio access.',
  },
};

export default function UpgradeBlockModal({
  open,
  reason,
  detail,
  onClose,
  onUpgrade,
}: UpgradeBlockModalProps) {
  if (!open) return null;

  const copy = COPY[reason];

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
          <p className="text-sm text-slate-700">{copy.description}</p>
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
            Upgrade plan
          </button>
        </div>
      </div>
    </div>
  );
}
