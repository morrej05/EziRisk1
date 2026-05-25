import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [draftOrganisationName, setDraftOrganisationName] = useState('');
  const [isEditingOrganisationName, setIsEditingOrganisationName] = useState(false);
  const [isSavingOrganisationName, setIsSavingOrganisationName] = useState(false);
  const [organisationNameMessage, setOrganisationNameMessage] = useState<string | null>(null);
  const hasHandledUpgradeSuccessRef = useRef(false);

  useEffect(() => {
    setDraftOrganisationName(organisation?.name ?? '');
  }, [organisation?.name]);

  const runUpgradeSuccessRefresh = useCallback(async () => {
    const baselinePlanId = organisation?.plan_id ?? null;
    const organisationId = user?.organisation_id ?? organisation?.id ?? null;
    const maxAttempts = 6;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
            await refreshUserRole();
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
    const upgradeSucceeded = params.get('upgrade') === 'success';
    if (upgradeSucceeded && !hasHandledUpgradeSuccessRef.current) {
      hasHandledUpgradeSuccessRef.current = true;
      window.history.replaceState({}, '', '/admin');
      setUpgradeSuccess(true);
      setUpgradeStatus('checking');
      void runUpgradeSuccessRefresh();
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

  const saveOrganisationName = async () => {
    const organisationId = organisation?.id;
    if (!organisationId) return;
    const cleanedName = draftOrganisationName.trim();
    if (!cleanedName) {
      setOrganisationNameMessage('Organisation name cannot be empty.');
      return;
    }

    setIsSavingOrganisationName(true);
    setOrganisationNameMessage(null);
    const { error } = await supabase
      .from('organisations')
      .update({ name: cleanedName })
      .eq('id', organisationId);

    if (error) {
      setOrganisationNameMessage(`Failed to save organisation name: ${error.message}`);
      setIsSavingOrganisationName(false);
      return;
    }

    await refreshUserRole();
    setIsEditingOrganisationName(false);
    setOrganisationNameMessage('Organisation name saved.');
    setIsSavingOrganisationName(false);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 min-w-0">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div className="hidden sm:block h-6 w-px bg-slate-300" />
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-slate-900">Admin</h1>
            <p className="hidden sm:block text-sm text-slate-600">Organisation-level administration for users, billing, and branding.</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-4">
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
        <div className="px-4 sm:px-8 py-3 sm:py-4 border-b border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-600">
            Admin is limited to organisation-level controls. Platform-level controls are managed in Platform Admin.
          </p>
        </div>

        {upgradeSuccess && (
          <div className="mx-4 sm:mx-8 mt-4 sm:mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">
              {upgradeStatus === 'confirmed' && 'Subscription upgraded successfully! Your new plan features are now available.'}
              {upgradeStatus === 'checking' && 'We are finalising your upgrade. Your plan features will unlock automatically in a few seconds.'}
              {upgradeStatus === 'delayed' && 'Your checkout succeeded, but plan syncing is still in progress. Features will unlock automatically shortly.'}
            </p>
          </div>
        )}

        {activeTab === 'users' && <UserManagement />}

        {activeTab === 'organisation' && (
          <div className="p-4 sm:p-8 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Organisation</h2>
              <p className="text-sm text-slate-600">Your organisation profile and tenancy details.</p>
            </div>

            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Organisation Name</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">
                  {isEditingOrganisationName ? (
                    <div className="space-y-2">
                      <input
                        value={draftOrganisationName}
                        onChange={(event) => setDraftOrganisationName(event.target.value)}
                        maxLength={120}
                        placeholder="My Organisation"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void saveOrganisationName()}
                          disabled={isSavingOrganisationName}
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {isSavingOrganisationName ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setDraftOrganisationName(organisation?.name ?? '');
                            setIsEditingOrganisationName(false);
                            setOrganisationNameMessage(null);
                          }}
                          disabled={isSavingOrganisationName}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p>{organisation?.name || 'Organisation not recorded'}</p>
                      <button
                        onClick={() => {
                          setDraftOrganisationName(organisation?.name ?? '');
                          setOrganisationNameMessage(null);
                          setIsEditingOrganisationName(true);
                        }}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit name
                      </button>
                    </div>
                  )}
                </dd>
                {organisationNameMessage && (
                  <p className="mt-2 text-xs text-slate-600">{organisationNameMessage}</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Organisation ID</dt>
                <dd className="text-sm font-mono text-slate-900 mt-1 break-all">{organisation?.id || 'Organisation ID not available'}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Plan</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">{getPlanDisplayName(getPlan(organisation))}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Signed-in Admin</dt>
                <dd className="text-sm font-medium text-slate-900 mt-1">{user?.email || 'User email not available'}</dd>
              </div>
            </dl>
          </div>
        )}

        {activeTab === 'usage-limits' && (
          <div className="p-4 sm:p-8">
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
