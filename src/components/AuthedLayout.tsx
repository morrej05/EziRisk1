import { ReactNode, useState } from 'react';
import ProtectedRoute from './ProtectedRoute';
import AppLayout from './AppLayout';
import { useInactivityLogout } from '../hooks/useInactivityLogout';
import { useAuth } from '../contexts/AuthContext';
import { needsDisplayName } from '../utils/displayNameGuard';
import DisplayNameModal from './profile/DisplayNameModal';

interface AuthedLayoutProps {
  children: ReactNode;
}

function formatCountdown(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function InactivityLogoutModal() {
  const { isWarningVisible, remainingSeconds, staySignedIn, logOutNow } = useInactivityLogout();

  if (!isWarningVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4" role="presentation">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inactivity-logout-title"
        aria-describedby="inactivity-logout-description"
      >
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Security timeout</p>
          <h2 id="inactivity-logout-title" className="mt-2 text-xl font-semibold text-slate-900">
            Are you still there?
          </h2>
          <p id="inactivity-logout-description" className="mt-3 text-sm leading-6 text-slate-600">
            For your security, EziRisk will sign you out after 30 minutes of inactivity. Choose stay signed in to keep working on this page.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Signing out in <span className="font-semibold tabular-nums">{formatCountdown(remainingSeconds)}</span>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={logOutNow}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Log out
          </button>
          <button
            type="button"
            onClick={staySignedIn}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown once per session when the logged-in user has no valid display name.
 * Uses in-memory "dismissed" state so it never re-appears after the user
 * either saves a name or explicitly skips — until their next login.
 */
function DisplayNamePrompt() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  // Don't render while user is loading (user === null) or once dismissed.
  if (dismissed || !user || !needsDisplayName(user)) {
    return null;
  }

  return (
    <DisplayNameModal
      mode="prompt"
      onSaved={() => setDismissed(true)}
      onDismiss={() => setDismissed(true)}
    />
  );
}

export default function AuthedLayout({ children }: AuthedLayoutProps) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
      <InactivityLogoutModal />
      <DisplayNamePrompt />
    </ProtectedRoute>
  );
}
