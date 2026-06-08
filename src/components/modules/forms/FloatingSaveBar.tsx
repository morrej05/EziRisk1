import { useEffect } from 'react';
import { Save, AlertCircle } from 'lucide-react';

interface FloatingSaveBarProps {
  onSave: () => void | Promise<void>;
  isSaving: boolean;
  statusText?: string;
  /** When true, shows an amber "Unsaved changes" indicator and warns on page leave. */
  isDirty?: boolean;
}

export default function FloatingSaveBar({ onSave, isSaving, statusText, isDirty }: FloatingSaveBarProps) {
  // Warn the user if they try to leave with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message but require returnValue to be set
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 border-t shadow-lg z-40 transition-colors ${
        isDirty ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isDirty && !isSaving && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Unsaved changes
            </span>
          )}
          {statusText && !isDirty && (
            <span className="text-sm text-slate-600">{statusText}</span>
          )}
          {statusText && isDirty && (
            <span className="text-xs text-amber-600">{statusText}</span>
          )}
        </div>

        <button
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await onSave();
          }}
          disabled={isSaving}
          className={`flex items-center gap-2 px-6 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isDirty && !isSaving
              ? 'bg-amber-600 text-white hover:bg-amber-700'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Module'}
        </button>
      </div>
    </div>
  );
}
