import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, UserCircle, Mail, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { updateDisplayName } from '../../lib/profile/updateDisplayName';
import { resolveDisplayName } from '../../utils/pdfIdentity';
import { needsDisplayName } from '../../utils/displayNameGuard';

export default function ProfilePage() {
  const { user, refreshUserRole } = useAuth();

  const existingName = user?.name && !user.name.includes('@') ? user.name : '';

  const [name, setName] = useState(existingName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Please enter your display name.');
      return;
    }
    if (trimmed.includes('@')) {
      setError('Display name cannot be an email address — please enter your full name.');
      return;
    }
    if (trimmed.length < 2) {
      setError('Display name must be at least 2 characters.');
      return;
    }
    if (!user?.id) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await updateDisplayName(user.id, trimmed);
      await refreshUserRole();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const displayedName = resolveDisplayName(user) ?? null;
  const showMissingNameWarning = needsDisplayName(user);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

        {/* Back link */}
        <div className="mb-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Link>
        </div>

        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-600 flex-shrink-0">
            <UserCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Profile settings</h1>
            <p className="text-sm text-slate-500">Manage your display name and account details</p>
          </div>
        </div>

        {/* Missing-name callout */}
        {showMissingNameWarning && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-medium text-amber-800">
              Your display name is missing or looks like an email address.
            </p>
            <p className="mt-1 text-sm text-amber-700">
              Your name appears on every report you create. Please set it before issuing or generating documents.
            </p>
          </div>
        )}

        {/* Email section — read-only */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm mb-4">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Email address</h2>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>{user?.email ?? '—'}</span>
              <span className="ml-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                Read-only
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Email changes are managed by your organisation administrator.
            </p>
          </div>
        </div>

        {/* Display name section */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Display name</h2>
          </div>
          <div className="px-5 py-5">
            <p className="text-sm text-slate-600 mb-4">
              This name appears on every assessment report you create and issue. Use your full name
              so documents are correctly attributed.
            </p>

            {displayedName && !showMissingNameWarning && (
              <p className="mb-3 text-xs text-slate-500">
                Currently shown as: <span className="font-medium text-slate-700">{displayedName}</span>
              </p>
            )}

            <label
              htmlFor="display-name-input"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Full name
            </label>
            <input
              id="display-name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="e.g. James Morrell"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

            {/* Success confirmation */}
            {saved && !error && (
              <div className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Display name saved successfully.
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
