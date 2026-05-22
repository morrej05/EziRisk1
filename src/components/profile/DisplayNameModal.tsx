import { useState } from 'react';
import { X, UserCircle } from 'lucide-react';
import { updateDisplayName } from '../../lib/profile/updateDisplayName';
import { useAuth } from '../../contexts/AuthContext';

interface DisplayNameModalProps {
  /** 'prompt' = first-login nudge; 'edit' = user-initiated profile edit */
  mode: 'prompt' | 'edit';
  /** Called after a successful save (and refreshUserRole completes) */
  onSaved: () => void;
  /** Called when the user dismisses without saving. Omit to hide the dismiss option. */
  onDismiss?: () => void;
}

export default function DisplayNameModal({ mode, onSaved, onDismiss }: DisplayNameModalProps) {
  const { user, refreshUserRole } = useAuth();

  const existingName =
    mode === 'edit' && user?.name && !user.name.includes('@') ? user.name : '';

  const [name, setName] = useState(existingName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    try {
      await updateDisplayName(user.id, trimmed);
      await refreshUserRole();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-4"
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-name-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 flex-shrink-0">
              <UserCircle className="h-5 w-5" />
            </div>
            <div>
              {mode === 'prompt' && (
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Set up your profile
                </p>
              )}
              <h2
                id="display-name-modal-title"
                className="text-lg font-semibold text-slate-900"
              >
                {mode === 'prompt' ? 'What should we call you?' : 'Update your display name'}
              </h2>
            </div>
          </div>

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="ml-2 p-1 text-slate-400 hover:text-slate-600 rounded transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body copy – prompt mode only */}
        {mode === 'prompt' && (
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Your display name appears on every report you create. Use your full name so
            assessments are correctly attributed before you issue or generate a document.
          </p>
        )}

        {/* Input */}
        <div className="mt-5">
          <label
            htmlFor="display-name-input"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Display name
          </label>
          <input
            id="display-name-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            placeholder="e.g. James Morrell"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              {mode === 'prompt' ? 'Skip for now' : 'Cancel'}
            </button>
          )}
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
  );
}
