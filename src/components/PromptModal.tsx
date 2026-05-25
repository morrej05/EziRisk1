import { FormEvent, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the entered value when the user confirms. */
  onConfirm: (value: string) => void;
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** If set, the user must type this exact string to enable the confirm button. */
  requiredValue?: string;
  /** Helper text shown below the input when requiredValue is set. */
  requiredValueHint?: string;
}

/**
 * Branded text-input dialog — replaces window.prompt() across the app.
 *
 * Usage (free-form input):
 *   setPromptState({
 *     title: 'Name this view',
 *     placeholder: 'My saved view',
 *     onConfirm: (name) => saveView(name),
 *   });
 *
 * Usage (type-to-confirm pattern):
 *   setPromptState({
 *     title: 'Delete account',
 *     message: 'This is permanent and cannot be undone.',
 *     requiredValue: 'DELETE',
 *     requiredValueHint: 'Type DELETE to confirm',
 *     confirmText: 'Delete account',
 *     onConfirm: () => deleteAccount(),
 *   });
 */
export default function PromptModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  label,
  placeholder = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  requiredValue,
  requiredValueHint,
}: PromptModalProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isValid = requiredValue ? value === requiredValue : value.trim().length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onConfirm(value);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
          {message && <p className="text-sm text-slate-600">{message}</p>}

          <div>
            {label && (
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
            )}
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
            {requiredValueHint && (
              <p className="mt-1 text-xs text-slate-500">{requiredValueHint}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
                requiredValue
                  ? 'bg-red-600 hover:bg-red-700 disabled:opacity-50'
                  : 'bg-slate-900 hover:bg-slate-800 disabled:opacity-50'
              } disabled:cursor-not-allowed`}
            >
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
