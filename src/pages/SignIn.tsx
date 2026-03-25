import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle } from 'lucide-react';
import LegalLinks from '../components/legal/LegalLinks';
import { resolveLogoUrl } from '../utils/logo';

type SignupPlan = 'free' | 'standard' | 'professional';
type BillingCycle = 'monthly' | 'annual';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SignupPlan>('free');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const { signIn, signUp, resetPassword } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: authError } = isSignUp
        ? await signUp(email, password)
        : await signIn(email, password);

      if (authError) {
        setError(authError.message);
      } else if (isSignUp && selectedPlan !== 'free') {
        navigate(
          `/upgrade?signupFlow=1&signupPlan=${selectedPlan}&signupBillingCycle=${billingCycle}`,
          { replace: true }
        );
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetLoading(true);

    try {
      const { error: resetError } = await resetPassword(resetEmail);

      if (resetError) {
        setError(resetError.message);
      } else {
        setResetSuccess(true);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 flex flex-col">
      <nav className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              {!logoError ? (
                <img
                  src={resolveLogoUrl()}
                  alt="EziRisk"
                  className="h-9 w-auto"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <span className="text-2xl font-bold text-neutral-900">EziRisk</span>
              )}
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="text-center text-3xl font-bold text-neutral-900">
              {isSignUp ? 'Create your account' : 'Sign in to your account'}
            </h2>
            <p className="mt-2 text-center text-sm text-neutral-600">
              {isSignUp ? 'Start your 14-day free trial' : 'Access your fire risk reports'}
            </p>
          </div>

          <form className="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-sm" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-start gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {isSignUp && (
              <div className="space-y-4">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-900">Choose your starting plan</p>
                  <p className="mt-1 text-sm text-neutral-700">Includes 1 user and 5 reports.</p>
                  <p className="text-sm text-neutral-700">Upgrade anytime for more users and reports.</p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {([
                    { id: 'free', label: 'Free Trial', description: '14 days • 1 user • 5 reports' },
                    { id: 'standard', label: 'Standard', description: 'Paid plan after account setup' },
                    { id: 'professional', label: 'Professional', description: 'Paid plan after account setup' },
                  ] as const).map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        selectedPlan === plan.id
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-neutral-300 bg-white text-neutral-800 hover:border-primary-500'
                      }`}
                    >
                      <p className="text-sm font-semibold">{plan.label}</p>
                      <p className={`mt-1 text-xs ${selectedPlan === plan.id ? 'text-primary-100' : 'text-neutral-600'}`}>
                        {plan.description}
                      </p>
                    </button>
                  ))}
                </div>

                {selectedPlan !== 'free' && (
                  <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
                    <p className="text-sm text-neutral-700">
                      Your account is created first, then you&apos;ll continue to secure Stripe checkout.
                    </p>
                    <div className="inline-flex rounded-md border border-neutral-300 p-1">
                      {(['monthly', 'annual'] as const).map((cycle) => (
                        <button
                          key={cycle}
                          type="button"
                          onClick={() => setBillingCycle(cycle)}
                          className={`px-3 py-1.5 text-sm rounded ${
                            billingCycle === cycle ? 'bg-primary-600 text-white' : 'text-neutral-700 hover:bg-neutral-100'
                          }`}
                        >
                          {cycle === 'monthly' ? 'Monthly' : 'Annual'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
                    Password
                  </label>
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(true);
                        setResetEmail(email);
                        setError(null);
                        setResetSuccess(false);
                      }}
                      className="text-sm text-neutral-600 hover:text-neutral-900"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Please wait...' : isSignUp ? 'Sign up' : 'Sign in'}
              </button>
            </div>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
                className="text-neutral-600 hover:text-neutral-900"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <footer className="bg-neutral-900 text-neutral-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className="text-sm text-neutral-500">© {new Date().getFullYear()} EziRisk. All rights reserved.</p>
            <LegalLinks
              className="flex flex-wrap items-center gap-4"
              itemClassName="text-sm text-neutral-400 hover:text-white transition-colors"
            />
          </div>
        </div>
      </footer>

      {showForgotPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Reset your password</h3>
            <p className="text-sm text-neutral-600 mb-6">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {resetSuccess ? (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
                  <p className="text-sm">
                    Password reset link sent! Check your email for instructions.
                  </p>
                </div>
                  <button
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetSuccess(false);
                      setResetEmail('');
                    }}
                    className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
                  >
                    Close
                  </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="reset-email" className="block text-sm font-medium text-neutral-700 mb-1">
                    Email address
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="you@example.com"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setError(null);
                      setResetEmail('');
                    }}
                    className="flex-1 px-4 py-2 border border-neutral-300 text-neutral-700 rounded-md hover:bg-neutral-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {resetLoading ? 'Sending...' : 'Send reset link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
