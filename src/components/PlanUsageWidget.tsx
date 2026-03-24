import { Users, FileText, Database } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getPlanConfig } from '../utils/entitlements';
import { getUserLimitForOrganisation } from '../utils/planLimits';
import { getReportCreationEntitlement, type ReportCreationEntitlement } from '../utils/reportCreationEntitlements';
import { getUserSeatEntitlement, type UserSeatEntitlement } from '../utils/userSeatEntitlements';
import { useTenant } from '../hooks/useTenant';

export default function PlanUsageWidget() {
  const { organisation } = useAuth();
  const { tenant } = useTenant();
  const [userCount, setUserCount] = useState(0);
  const [reportEntitlement, setReportEntitlement] = useState<ReportCreationEntitlement | null>(null);
  const [seatEntitlement, setSeatEntitlement] = useState<UserSeatEntitlement | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUsage = async () => {
      if (!organisation?.id) return;

      try {
        const [{ count, error }, reportData, seatData] = await Promise.all([
          supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('organisation_id', organisation.id),
          getReportCreationEntitlement(organisation.id),
          getUserSeatEntitlement(organisation.id),
        ]);

        if (error) {
          console.error('[PlanUsageWidget] Error fetching user count:', error);
        } else {
          setUserCount(count || 0);
        }

        setReportEntitlement(reportData);
        setSeatEntitlement(seatData);
      } catch (err) {
        console.error('[PlanUsageWidget] Exception:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsage();
  }, [organisation?.id]);

  if (isLoading || !organisation) {
    return null;
  }

  const planConfig = getPlanConfig(organisation);
  const reportLimit = reportEntitlement?.monthly_report_limit ?? planConfig.reportLimit;
  const reportsUsed = reportEntitlement?.monthly_report_count ?? 0;
  const reportPercent = reportLimit > 0 ? (reportsUsed / reportLimit) * 100 : 0;
  const seatLimit = seatEntitlement?.user_limit ?? getUserLimitForOrganisation(organisation);
  const seatsUsed = seatEntitlement?.active_member_count ?? userCount;
  const usersPercent = seatLimit > 0 ? (seatsUsed / seatLimit) * 100 : 0;
  const storagePercent = tenant?.plan ? (tenant.storage_used_mb / tenant.plan.max_storage_mb) * 100 : 0;

  const getProgressColor = (percent: number) => {
    if (percent >= 100) return 'bg-red-500';
    if (percent >= 80) return 'bg-amber-500';
    return 'bg-blue-500';
  };

  const getStorageColor = () => {
    if (storagePercent >= 100) return 'bg-red-500';
    if (storagePercent >= 80) return 'bg-amber-500';
    return 'bg-blue-500';
  };

  const formatStorageSize = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-1">Usage & Limits</h3>
      <p className="text-sm text-slate-600 mb-4">
        Operational usage for your current monthly allowance and active seats.
      </p>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">Reports used this month</span>
            </div>
            <span className="text-sm font-semibold text-slate-900">
              {reportsUsed} / {reportLimit}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${getProgressColor(reportPercent)}`}
              style={{ width: `${Math.min(reportPercent, 100)}%` }}
            />
          </div>
          {reportPercent >= 80 && (
            <p className="text-xs text-amber-700 mt-1">
              {reportPercent >= 100 ? 'Monthly report limit reached' : 'Approaching monthly report limit'}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">Seats in use</span>
            </div>
            <span className="text-sm font-semibold text-slate-900">
              {seatsUsed} / {seatLimit}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${getProgressColor(usersPercent)}`}
              style={{ width: `${Math.min(usersPercent, 100)}%` }}
            />
          </div>
          {usersPercent >= 80 && (
            <p className="text-xs text-amber-700 mt-1">
              {usersPercent >= 100 ? 'User limit reached' : 'Approaching user limit'}
            </p>
          )}
        </div>

        {tenant?.plan && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-medium text-slate-700">Storage</span>
              </div>
              <span className="text-sm font-semibold text-slate-900">
                {formatStorageSize(tenant.storage_used_mb)} / {formatStorageSize(tenant.plan.max_storage_mb)}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${getStorageColor()}`}
                style={{ width: `${Math.min(storagePercent, 100)}%` }}
              />
            </div>
            {storagePercent >= 80 && (
              <p className="text-xs text-amber-700 mt-1">
                {storagePercent >= 100 ? 'Storage limit reached' : 'Approaching storage limit'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
