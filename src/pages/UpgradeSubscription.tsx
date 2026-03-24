import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../hooks/useTenant';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { canAccessAdmin, getPlanDisplayName, type User as EntitlementsUser } from '../utils/entitlements';
import { PRICING, getDefaultRegion, formatPrice } from '../config/pricing';
import { toggleDevForcePro } from '../utils/devFlags';

export default function UpgradeSubscription() {
  const { user, organisation, refreshUserRole } = useAuth();
  const { tenant, refetch: refetchTenant } = useTenant();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryParams = new URLSearchParams(window.location.search);
  const checkoutCanceled = queryParams.get('canceled') === 'true';
  const region = getDefaultRegion();
  const pricing = PRICING[region];

  const entitlementUser: EntitlementsUser | null = useMemo(() => (
    user
      ? {
          id: user.id,
          role: (user.role ?? 'viewer') as EntitlementsUser['role'],
          is_platform_admin: Boolean(user.is_platform_admin),
          platform: Boolean(user.platform),
          can_edit: Boolean(user.can_edit),
          name: user.user_metadata?.name ?? null,
          organisation_id: user.organisation_id ?? null,
        }
      : null
  ), [user]);

  if (!entitlementUser || !canAccessAdmin(entitlementUser)) {
    navigate('/dashboard');
    return null;
  }

  const handleToggleDevForcePro = async () => {
    if (!organisation?.id || !tenant) return;

    try {
      await toggleDevForcePro(organisation.id, tenant.plan_id);
      await refreshUserRole();
      await refetchTenant();
    } catch (upgradeError) {
      console.error('[UpgradeSubscription] Error toggling plan:', upgradeError);
      alert('Failed to toggle plan. Please try again.');
    }
  };

  const handleUpgrade = async (priceId: string) => {
    if (!organisation) {
      setError('Organisation not found');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            priceId,
            organisationId: organisation.id,
            successUrl: `${window.location.origin}/admin?upgrade=success`,
            cancelUrl: `${window.location.origin}/upgrade?canceled=true`,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      const { sessionUrl, url } = await response.json();
      window.location.href = sessionUrl || url;
    } catch (upgradeError) {
      console.error('Upgrade error:', upgradeError);
      setError(upgradeError instanceof Error ? upgradeError.message : 'Failed to start upgrade process');
      setIsLoading(false);
    }
  };

  const standardMonthlyPrice =
    import.meta.env.VITE_STRIPE_PRICE_STANDARD_MONTHLY;
  const standardAnnualPrice =
    import.meta.env.VITE_STRIPE_PRICE_STANDARD_ANNUAL;
  const proMonthlyPrice = import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY;
  const proAnnualPrice = import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL;

  const missingEnvVars = [];
  if (!standardMonthlyPrice) missingEnvVars.push('VITE_STRIPE_PRICE_STANDARD_MONTHLY');
  if (!standardAnnualPrice) missingEnvVars.push('VITE_STRIPE_PRICE_STANDARD_ANNUAL');
  if (!proMonthlyPrice) missingEnvVars.push('VITE_STRIPE_PRICE_PRO_MONTHLY');
  if (!proAnnualPrice) missingEnvVars.push('VITE_STRIPE_PRICE_PRO_ANNUAL');

  return (
    <div className="min-h-screen bg-neutral-50">
      <nav className="bg-white shadow-sm border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary-600" />
              <div>
                <h1 className="text-2xl font-bold text-neutral-900">Upgrade Subscription</h1>
                <p className="text-sm text-neutral-600">Choose your plan</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {import.meta.env.DEV && tenant && (
                <label className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tenant.plan_id === 'professional'}
                    onChange={handleToggleDevForcePro}
                    className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs font-medium text-amber-900">
                    DEV: Toggle Professional Plan
                  </span>
                  {tenant.plan_id === 'professional' && (
                    <span className="px-1.5 py-0.5 bg-amber-200 text-amber-900 text-xs font-bold rounded">
                      PRO
                    </span>
                  )}
                </label>
              )}
              <button
                onClick={() => navigate('/admin')}
                className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Admin
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {missingEnvVars.length > 0 && (
          <div className="mb-6 p-4 bg-warning-50 border border-warning-200 rounded-lg">
            <p className="text-sm text-warning-800 font-semibold mb-2">Configuration Required</p>
            <p className="text-sm text-warning-700 mb-2">
              The following Stripe environment variables are missing. Buttons will be disabled until configured:
            </p>
            <ul className="text-sm text-warning-700 list-disc list-inside">
              {missingEnvVars.map((envVar) => (
                <li key={envVar}><code className="bg-warning-100 px-1 rounded">{envVar}</code></li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {checkoutCanceled && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-900">
              Checkout was canceled. Your plan has not changed. You can try again whenever you&apos;re ready.
            </p>
          </div>
        )}

        {organisation && (
          <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              Current Plan: <strong>{getPlanDisplayName(organisation.plan_id || 'free')}</strong>
              {organisation.subscription_status !== 'active' && (organisation.plan_id || 'free') !== 'professional' && (
                <span className="ml-2 text-blue-600">
                  (Status: {organisation.subscription_status})
                </span>
              )}
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border-2 border-neutral-200 p-8 flex flex-col">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-neutral-900 mb-6">Standard</h2>

              <div className="space-y-4 mb-8">
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">10 reports per month</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">Up to 2 users</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">Clean, branded PDF reports</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold text-neutral-900">
                  {formatPrice(region, pricing.standard.monthly)}
                </span>
                <span className="text-neutral-600">/month</span>
              </div>
              <button
                onClick={() => handleUpgrade(standardMonthlyPrice)}
                disabled={isLoading || !standardMonthlyPrice}
                className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Standard'
                )}
              </button>

              <div className="flex items-baseline gap-2 mb-2 mt-6">
                <span className="text-3xl font-bold text-neutral-900">
                  {formatPrice(region, pricing.standard.annual)}
                </span>
                <span className="text-neutral-600">/year</span>
                <span className="text-sm text-success-600 font-medium">2 months free</span>
              </div>
              <button
                onClick={() => handleUpgrade(standardAnnualPrice)}
                disabled={isLoading || !standardAnnualPrice}
                className="w-full px-4 py-3 bg-neutral-100 text-neutral-900 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Standard'
                )}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg border-2 border-primary-600 p-8 flex flex-col relative">
            <div className="absolute top-0 right-0 px-3 py-1 bg-primary-600 text-white text-xs font-bold rounded-bl-lg rounded-tr-lg">
              RECOMMENDED
            </div>

            <div className="flex-1">
              <h2 className="text-2xl font-bold text-neutral-900 mb-6">Professional</h2>

              <div className="space-y-4 mb-8">
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">30 reports per month</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">Up to 5 users</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-success-600" />
                  <span className="text-neutral-700">Portfolio view & multi-site management</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold text-neutral-900">
                  {formatPrice(region, pricing.professional.monthly)}
                </span>
                <span className="text-neutral-600">/month</span>
              </div>
              <button
                onClick={() => handleUpgrade(proMonthlyPrice)}
                disabled={isLoading || !proMonthlyPrice}
                className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Professional'
                )}
              </button>

              <div className="flex items-baseline gap-2 mb-2 mt-6">
                <span className="text-3xl font-bold text-neutral-900">
                  {formatPrice(region, pricing.professional.annual)}
                </span>
                <span className="text-neutral-600">/year</span>
                <span className="text-sm text-success-600 font-medium">2 months free</span>
              </div>
              <button
                onClick={() => handleUpgrade(proAnnualPrice)}
                disabled={isLoading || !proAnnualPrice}
                className="w-full px-4 py-3 bg-neutral-100 text-neutral-900 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Professional'
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-neutral-500">
          <p>All plans include secure payment processing via Stripe.</p>
          <p className="mt-2">Your subscription will renew automatically unless canceled.</p>
        </div>
      </div>
    </div>
  );
}
