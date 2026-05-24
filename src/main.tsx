import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';


if (!import.meta.env.DEV) {
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
}

const COOKIE_CONSENT_KEY = 'ezirisk_cookie_consent';

const maybeInitMonitoring = () => {
  if (localStorage.getItem(COOKIE_CONSENT_KEY) !== 'accept') {
    return;
  }
  const monitoringWindow = window as Window & {
    mf?: { init: (params: string) => void };
    MF?: { init: (params: string) => void };
  };
  const mf = monitoringWindow.mf || monitoringWindow.MF;
  const mfParams = import.meta.env.VITE_MF_PARAMS;

  if (!mf || typeof mf.init !== 'function' || !mfParams) {
    return;
  }

  try {
    mf.init(mfParams);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[MF] Monitoring init skipped:', error);
    }
  }
};

maybeInitMonitoring();

window.addEventListener('ezirisk:cookie-consent', (event) => {
  const customEvent = event as CustomEvent<{ choice?: string }>;
  if (customEvent.detail?.choice === 'accept') {
    maybeInitMonitoring();
  }
});

// Register service worker for safe navigation handling
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (import.meta.env.DEV) {
          console.log('[App] Service Worker registered:', registration.scope);
        }
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[App] Service Worker registration failed:', error);
        }
      });
  });

  // Handle navigation messages from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NAVIGATE') {
      // Navigate using relative URL only
      const url = event.data.url;
      if (url && typeof url === 'string') {
        window.location.href = url;
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
