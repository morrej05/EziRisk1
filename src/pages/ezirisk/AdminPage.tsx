import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { SUPPORT_CONFIG, getSupportMailto } from '../../config/support';
import OrganisationBranding from '../../components/OrganisationBranding';
import PlanUsageWidget from '../../components/PlanUsageWidget';
import UserManagement from '../../components/UserManagement';
import { useAuth } from '../../contexts/AuthContext';

type AdminTab = 'users' | 'organisation' | 'usage-limits' | 'billing' | 'branding';

export default function AdminPage() {
  const navigate = useNavigate();
  const { organisation, user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

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
                <dd className="text-sm font-medium text-slate-900 mt-1">{organisation?.plan_type || organisation?.plan_id || 'trial'}</dd>
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
            <PlanUsageWidget />
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="p-8">
            <div className="max-w-2xl rounded-lg border border-slate-200 bg-slate-50 p-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Billing</h2>
              <p className="text-sm text-slate-600 mb-4">
                Manage your organisation subscription, view plan options, and self-serve upgrades.
              </p>
              <button
                onClick={() => navigate('/upgrade')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                Manage subscription
              </button>
            </div>
          </div>
        )}

        {activeTab === 'branding' && <OrganisationBranding />}
      </div>
    </div>
  );
}
