import { X, AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** @deprecated Use isDestructive instead. Kept for backward compatibility. */
  confirmButtonClass?: string;
  isDestructive?: boolean;
}

/**
 * Branded confirmation dialog — replaces window.confirm() across the app.
 *
 * Usage:
 *   const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
 *
 *   // Where you used to call confirm():
 *   setConfirmState({
 *     title: 'Remove user',
 *     message: 'This cannot be undone.',
 *     confirmText: 'Remove',
 *     isDestructive: true,
 *     onConfirm: doTheAction,
 *   });
 *
 *   // In JSX:
 *   <ConfirmModal
 *     isOpen={confirmState !== null}
 *     onClose={() => setConfirmState(null)}
 *     onConfirm={confirmState?.onConfirm ?? (() => {})}
 *     title={confirmState?.title ?? ''}
 *     message={confirmState?.message ?? ''}
 *     confirmText={confirmState?.confirmText}
 *     isDestructive={confirmState?.isDestructive}
 *   />
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            {isDestructive && (
              <div className="shrink-0 flex items-center justify-center h-9 w-9 rounded-full bg-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              <p className="mt-1 text-sm text-slate-600 leading-snug">{message}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors ml-2"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
              isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
