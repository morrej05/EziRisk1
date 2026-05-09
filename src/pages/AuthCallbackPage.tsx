import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const RESET_PASSWORD_PATH = '/reset-password';
const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
const DEFAULT_UNAUTHENTICATED_PATH = '/signin';

function getSafeRelativePath(value: string | null, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  return value;
}

function getCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  return { searchParams, hashParams };
}

function resolveNextPath(searchParams: URLSearchParams, hashParams: URLSearchParams) {
  return getSafeRelativePath(
    searchParams.get('next') ?? hashParams.get('next'),
    DEFAULT_AUTHENTICATED_PATH
  );
}

function isRecoveryFlow(searchParams: URLSearchParams, hashParams: URLSearchParams, nextPath: string) {
  return (
    searchParams.get('type') === 'recovery' ||
    hashParams.get('type') === 'recovery' ||
    nextPath.startsWith(RESET_PASSWORD_PATH)
  );
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const completeAuthCallback = async () => {
      const { searchParams, hashParams } = getCallbackParams();
      const nextPath = resolveNextPath(searchParams, hashParams);
      const recoveryFlow = isRecoveryFlow(searchParams, hashParams, nextPath);
      const code = searchParams.get('code');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          if (isMounted) setError(exchangeError.message);
          return;
        }

        navigate(recoveryFlow ? RESET_PASSWORD_PATH : nextPath, { replace: true });
        return;
      }

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) {
          if (isMounted) setError(sessionError.message);
          return;
        }

        navigate(recoveryFlow ? RESET_PASSWORD_PATH : nextPath, { replace: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      navigate(session ? nextPath : DEFAULT_UNAUTHENTICATED_PATH, { replace: true });
    };

    void completeAuthCallback();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Completing sign in</h1>
          <p className="text-sm text-neutral-600 mt-2">Please wait while we finish verifying your secure link.</p>
        </div>

        {error ? (
          <>
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
            <Link to="/signin" className="block w-full text-center py-2 px-4 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors">
              Back to sign in
            </Link>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-600">Verifying link...</p>
          </div>
        )}
      </div>
    </div>
  );
}
