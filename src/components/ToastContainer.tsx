import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { subscribeToToasts, type ToastMessage, type ToastType } from '../lib/toast';

const AUTO_DISMISS_MS = 4500;

const STYLES: Record<ToastType, { wrapper: string; icon: string; IconEl: React.ElementType }> = {
  success: {
    wrapper: 'bg-white border-l-4 border-emerald-500 shadow-lg',
    icon: 'text-emerald-500',
    IconEl: CheckCircle2,
  },
  error: {
    wrapper: 'bg-white border-l-4 border-red-500 shadow-lg',
    icon: 'text-red-500',
    IconEl: AlertCircle,
  },
  warning: {
    wrapper: 'bg-white border-l-4 border-amber-500 shadow-lg',
    icon: 'text-amber-500',
    IconEl: AlertTriangle,
  },
  info: {
    wrapper: 'bg-white border-l-4 border-slate-500 shadow-lg',
    icon: 'text-slate-500',
    IconEl: Info,
  },
};

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const { wrapper, icon, IconEl } = STYLES[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg px-4 py-3 ${wrapper} animate-in slide-in-from-right-5 duration-200`}
    >
      <IconEl className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} />
      <p className="flex-1 text-sm text-slate-800 leading-snug">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToToasts((toast) => {
      setToasts((prev) => [...prev, toast]);
    });
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
