import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SUPPORT_CONFIG, getSupportMailto } from '../../config/support';
import OrganisationBranding from '../../components/OrganisationBranding';
import PlanUsageWidget from '../../components/PlanUsageWidget';
import UserManagement from '../../components/UserManagement';
import { useAuth } from '../../contexts/AuthContext';
import AdminBillingPanel from '../../components/AdminBillingPanel';
import { getPlanDisplayName, getPlan } from '../../utils/entitlements';
import { supabase } from '../../lib/supabase';

type AdminTab = 'users' | 'organisation' | 'usage-limits' | 'billing' | 'branding';

export default function AdminPage() {
  const navigate = useNavigate();
  const { organisation, user, refreshUserRole } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const [upgradeStatus, setUpgradeStatus] = useState<'checking' | 'confirmed' | 'delayed'>('checking');

  const runUpgradeSuccessRefresh = useCallback(async () => {
    const baselinePlanId = organisation?.plan_id ?? null;
    const organisationId = user?.organisation_id ?? organisation?.id ?? null;
    const maxAttempts = 6;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await refreshUserRole();

      if (organisationId) {
        const { data, error } = await supabase
          .from('organisations')
          .select('plan_id, subscription_status')
          .eq('id', organisationId)
          .maybeSingle();

        if (error) {
          console.warn('[AdminPage] Unable to verify upgraded plan state:', error);
        } else {
          const currentPlanId = data?.plan_id ?? null;
          const currentSubscriptionStatus = data?.subscription_status ?? null;
          const planChanged = baselinePlanId ? currentPlanId !== baselinePlanId : false;
          const upgradedWithoutBaseline = !baselinePlanId && currentSubscriptionStatus === 'active';

          if (planChanged || upgradedWithoutBaseline) {
            setUpgradeStatus('confirmed');
            return;
          }
        }
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    setUpgradeStatus('delayed');
  }, [organisation?.id, organisation?.plan_id, refreshUserRole, user?.organisation_id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'success') {
      setUpgradeSuccess(true);
      setUpgradeStatus('checking');
      void runUpgradeSuccessRefresh();
      window.history.replaceState({}, '', '/admin');
      const timeoutId = window.setTimeout(() => setUpgradeSuccess(false), 12000);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [runUpgradeSuccessRefresh]);

  const tabs = [
    { id: 'users' as AdminTab, label: 'Users' },
    { id: 'organisation' as AdminTab, label: 'Organisation' },
    { id: 'usage-limits' as AdminTab, label: 'Usage & Limits' },
    { id: 'billing' as AdminTab, label: 'Billing' },
    { id: 'branding' as AdminTab, label: 'Branding' },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 min-w-0">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-slate-300" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Admin</h1>
            <p className="text-sm text-slate-600">Organisation-level administration for users, billing, and branding.</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href={getSupportMailto()} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            {SUPPORT_CONFIG.linkLabel}
          </a>
          <button
            onClick={() => navigate('/assessments')}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Assessments
          </button>
        </div>
      </div>

      <div className="mb-6 border-b border-slate-200">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 min-w-0">
        <div className="px-8 py-4 border-b border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-600">
            Admin is limited to organisation-level controls. Platform-level controls are managed in Platform Admin.
          </p>
        </div>

        {upgradeSuccess && (
          <div className="mx-8 mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">
              {upgradeStatus === 'confirmed' && 'Subscription upgraded successfully! Your new plan features are now available.'}
              {upgradeStatus === 'checking' && 'We are finalising your upgrade. Your plan features will unlock automatically in a few seconds.'}
              {upgradeStatus === 'delayed' && 'Your checkout succeeded, but plan syncing is still in progress. Features will unlock automatically shortly.'}
            </p>
          </div>
        )}

        {activeTab === 'users' && <UserManagement />}

        {activeTab === 'organisation' && (
          <div className="p-8 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Organisation</h2>
              <p className="text-sm text-slate-600">Your organisation profile and tenancy details.</p>
            </div>

            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Organisation Name</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">{organisation?.name || '—'}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Organisation ID</dt>
                <dd className="text-sm font-mono text-slate-900 mt-1 break-all">{organisation?.id || '—'}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Plan</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">{getPlanDisplayName(getPlan(organisation))}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Signed-in Admin</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">{user?.email || '—'}</dd>
              </div>
            </dl>
          </div>
        )}

        {activeTab === 'usage-limits' && (
          <div className="p-8">
            <p className="text-sm text-slate-600 mb-4">
              Usage & Limits is your operational view for monthly report credits and seat consumption.
            </p>
            <PlanUsageWidget />
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="p-8">
            <AdminBillingPanel />
          </div>
        )}

        {activeTab === 'branding' && <OrganisationBranding />}
      </div>
    </div>
  );
}
