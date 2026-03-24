import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogOut, ArrowLeft, Building2, Users, Activity, Bug } from 'lucide-react';
import { supabase } from '../lib/supabase';
import UserRoleManagement from '../components/UserRoleManagement';
import TriggerDebugger from '../components/TriggerDebugger';

type PlatformView = 'organisations' | 'users' | 'usage-metrics' | 'support-tools';

interface OrganisationSummary {
  id: string;
  name: string;
  plan_id: string | null;
  subscription_status: string | null;
  created_at: string | null;
}

export default function SuperAdminDashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<PlatformView>('organisations');
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>([]);
  const [activeUserCount, setActiveUserCount] = useState(0);
  const [platformAdminCount, setPlatformAdminCount] = useState(0);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    navigate('/signin');
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard');
  };

  useEffect(() => {
    const loadPlatformData = async () => {
      setLoadingMetrics(true);
      try {
        const [orgResponse, activeMembershipResponse, platformAdminResponse] = await Promise.all([
          supabase
            .from('organisations')
            .select('id, name, plan_id, subscription_status, created_at')
            .order('created_at', { ascending: false }),
          supabase
            .from('organisation_members')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'active'),
          supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('is_platform_admin', true),
        ]);

        if (orgResponse.error) throw orgResponse.error;
        if (activeMembershipResponse.error) throw activeMembershipResponse.error;
        if (platformAdminResponse.error) throw platformAdminResponse.error;

        setOrganisations((orgResponse.data as OrganisationSummary[] | null) ?? []);
        setActiveUserCount(activeMembershipResponse.count ?? 0);
        setPlatformAdminCount(platformAdminResponse.count ?? 0);
      } catch (error) {
        console.error('Failed to load platform data:', error);
        setOrganisations([]);
        setActiveUserCount(0);
        setPlatformAdminCount(0);
      } finally {
        setLoadingMetrics(false);
      }
    };

    void loadPlatformData();
  }, []);

  const usageStats = useMemo(() => {
    const trialOrUnknownOrgs = organisations.filter((org) => !org.plan_id || org.plan_id === 'free').length;
    return {
      organisationCount: organisations.length,
      trialOrUnknownOrgs,
      activeUserCount,
      platformAdminCount,
    };
  }, [activeUserCount, organisations, platformAdminCount]);

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBackToDashboard}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Platform Admin</h1>
                <p className="text-sm text-slate-600 mt-0.5">Internal platform operations and support controls</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">{user?.email}</p>
                <p className="text-xs text-slate-600">Platform Administrator</p>
              </div>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="w-full max-w-6xl mx-auto px-4 py-6 min-w-0">
        <div className="bg-white border rounded-xl p-6 min-w-0">
          <div className="space-y-6">
            <nav className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Platform</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveView('organisations')}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    activeView === 'organisations'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  Organisations
                </button>

                <button
                  onClick={() => setActiveView('users')}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    activeView === 'users'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Users
                </button>

                <button
                  onClick={() => setActiveView('usage-metrics')}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    activeView === 'usage-metrics'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  Usage / Metrics
                </button>

                <button
                  onClick={() => setActiveView('support-tools')}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    activeView === 'support-tools'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Bug className="w-4 h-4" />
                  Support Tools
                </button>
              </div>
            </nav>

            <main className="min-w-0">
              {activeView === 'organisations' && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 overflow-x-auto">
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">Organisations</h2>
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                        <th className="px-4 py-2 text-left font-medium text-slate-600">Plan</th>
                        <th className="px-4 py-2 text-left font-medium text-slate-600">Subscription</th>
                        <th className="px-4 py-2 text-left font-medium text-slate-600">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {organisations.map((org) => (
                        <tr key={org.id}>
                          <td className="px-4 py-3 text-slate-900">{org.name || org.id}</td>
                          <td className="px-4 py-3 text-slate-700">{org.plan_id || 'free'}</td>
                          <td className="px-4 py-3 text-slate-700">{org.subscription_status || 'unknown'}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {org.created_at ? new Date(org.created_at).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loadingMetrics && organisations.length === 0 && (
                    <p className="text-sm text-slate-500 mt-4">No organisations found.</p>
                  )}
                </div>
              )}

              {activeView === 'users' && <UserRoleManagement />}

              {activeView === 'usage-metrics' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Organisations</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{usageStats.organisationCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Active users</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{usageStats.activeUserCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Free / unknown plans</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{usageStats.trialOrUnknownOrgs}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Platform admins</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{usageStats.platformAdminCount}</p>
                  </div>
                </div>
              )}

              {activeView === 'support-tools' && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">Support Tools</h2>
                  <TriggerDebugger />
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
