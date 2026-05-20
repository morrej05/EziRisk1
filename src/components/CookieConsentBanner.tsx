import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const CONSENT_KEY = 'ezirisk_cookie_consent';

const PUBLIC_PATHS = new Set([
  '/',
  '/signin',
  '/pricing',
  '/contact',
  '/reset-password',
  '/public/documents',
  '/privacy',
  '/terms',
  '/disclaimer',
  '/security',
  '/acceptable-use',
  '/subprocessors',
]);

const isPublicPath = (pathname: string) => {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  return pathname.startsWith('/external/') || pathname.startsWith('/client/document/');
};

export default function CookieConsentBanner() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  const showOnCurrentRoute = useMemo(() => isPublicPath(pathname), [pathname]);

  useEffect(() => {
    if (!showOnCurrentRoute) {
      setVisible(false);
      return;
    }

    const consent = localStorage.getItem(CONSENT_KEY);
    setVisible(!consent);
  }, [showOnCurrentRoute, pathname]);

  const setConsent = (choice: 'accept' | 'reject') => {
    localStorage.setItem(CONSENT_KEY, choice);
    window.dispatchEvent(
      new CustomEvent('ezirisk:cookie-consent', { detail: { choice } }),
    );
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] border-t border-neutral-200 bg-white/95 backdrop-blur-sm shadow-lg" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="text-sm text-neutral-700">
          This site uses cookies to improve your experience.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConsent('reject')} 
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => setConsent('accept')} 
            className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Accept
          </button>
          <Link
            to="/privacy"
            className="rounded-md px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50"
          >
            Privacy & Cookie Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
