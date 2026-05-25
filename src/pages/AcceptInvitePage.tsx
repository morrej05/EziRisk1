import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Set by AuthCallbackPage when the user arrived via a magic link (confirmed
  // account being added to a new organisation).  In this path we skip the
  // password form entirely: the user already has a password, and we just need
  // to activate their pending membership via ensure_org_for_user().
  const isExistingUser = Boolean(
    (location.state as { isExistingUser?: boolean } | null)?.isExistingUser,
  );

  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (!session) {
        // No session — invite link may have expired or already been used.
        navigate('/signin', { replace: true });
        return;
      }

      setEmail(session.user.email ?? null);

      if (isExistingUser) {
        // Confirmed user joining a new organisation.
        // Activate the pending membership directly — AuthContext won't do this
        // automatically because it only calls ensure_org_for_user() when
        // profileMembership is null, and existing users always have one.
        try {
          await supabase.rpc('ensure_org_for_user', { user_id: session.user.id });
        } catch {
          // Non-fatal: if RPC fails the user can still reach the dashboard;
          // membership may activate on their next sign-in.
          console.warn('[AcceptInvitePage] ensure_org_for_user RPC failed');
        }

        // Hard reload so AuthContext re-initialises fresh and picks up the
        // newly activated membership and updated user_profiles.organisation_id.
        window.location.replace('/dashboard');
        return;
      }

      setReady(true);
    };

    void init();
    return () => { isMounted = false; };
  }, [navigate, isExistingUser]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError(null);
    setLoading(true);

    // Set the password and clear the invite_flow flag from metadata so that
    // future sign-ins (magic link, social) don't re-enter this flow.
    // The USER_UPDATED event triggers AuthContext.fetchUserRole() which calls
    // ensure_org_for_user() and activates the invited membership.
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { invite_flow: null },
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setDone(true);
    // Brief pause so the success state is visible, then land on dashboard.
    setTimeout(() => {
      navigate('/dashboard', { replace: true });
    }, 1200);
  };

  const handleSkip = async () => {
    // The user already has a password (they were an existing Supabase user
    // being added to a new organisation). Clear the flag and proceed.
    await supabase.auth.updateUser({ data: { invite_flow: null } });
    navigate('/dashboard', { replace: true });
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8">
          <div className="text-center py-4">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-600">
              {isExistingUser ? 'Joining your organisation…' : 'Setting up your account…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-neutral-900">Password set!</h1>
          <p className="text-sm text-neutral-600">Taking you to your dashboard…</p>
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Welcome to EziRisk</h1>
          <p className="text-sm text-neutral-600 mt-2">
            Set a password for{' '}
            {email ? (
              <span className="font-medium text-neutral-800">{email}</span>
            ) : (
              'your account'
            )}{' '}
            to finish accepting your invitation.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                required
                minLength={8}
                className="block w-full px-3 py-2 pr-10 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                placeholder="At least 8 characters"
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
              required
              minLength={8}
              className="block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              placeholder="Repeat password"
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {loading ? 'Setting password…' : 'Set password & continue'}
          </button>
        </form>

        <div className="text-center space-y-2">
          <p className="text-xs text-slate-500">Already have a password for this account?</p>
          <button
            onClick={handleSkip}
            disabled={loading}
            className="text-sm text-slate-600 hover:text-slate-900 underline underline-offset-2 transition-colors"
          >
            Skip — take me to the dashboard
          </button>
        </div>

        <p className="text-center text-xs text-slate-400">
          <Link to="/signin" className="hover:text-slate-600">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
