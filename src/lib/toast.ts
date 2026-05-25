/**
 * Imperative toast notifications — no React context required.
 * Call showToast() anywhere; the ToastContainer in App.tsx subscribes and
 * renders the toasts.
 *
 * Usage:
 *   import { showToast } from '../lib/toast';
 *   showToast('Saved successfully', 'success');
 *   showToast('Failed to load', 'error');
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

type Listener = (toast: ToastMessage) => void;

const listeners: Set<Listener> = new Set();

export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showToast(message: string, type: ToastType = 'info'): void {
  const toast: ToastMessage = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    type,
  };
  listeners.forEach((l) => l(toast));
}
