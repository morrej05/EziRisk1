import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { usePortfolioMetrics } from '../../hooks/usePortfolioMetrics';

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function PortfolioPage() {
  const {
    metrics,
    loading,
    assessmentsLoading,
    actionsLoading,
    assessmentsError,
    actionsError,
  } = usePortfolioMetrics();

  const [showAiPlaceholder, setShowAiPlaceholder] = useState(false);

  const statusDistributionRows = useMemo(
    () => Object.entries(metrics.assessmentStatusCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    [metrics.assessmentStatusCounts]
  );

  const actionPriorityRows = useMemo(
    () => Object.entries(metrics.priorityCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        const order = ['P1', 'P2', 'P3', 'P4'];
        const aIndex = order.indexOf(a.label);
        const bIndex = order.indexOf(b.label);

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return b.count - a.count;
      }),
    [metrics.priorityCounts]
  );

  const actionStatusRows = useMemo(
    () => Object.entries(metrics.statusCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    [metrics.statusCounts]
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-slate-900">Portfolio</h1>
        <p className="mt-3 text-slate-600">Loading portfolio intelligence…</p>
      </div>
    );
  }

  const hasNoData = metrics.totalAssessments === 0 && metrics.totalActions === 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Portfolio</h1>
          <p className="mt-2 text-slate-600">
            Read-only cross-site insight from existing assessments and action register data.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAiPlaceholder((current) => !current)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Analyse Portfolio
        </button>
      </div>

      {showAiPlaceholder && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <p className="text-sm text-indigo-900 font-medium">Portfolio AI analysis will appear here once the analytics service is connected.</p>
          <p className="text-sm text-indigo-700 mt-1">
            This Portfolio v1 page intentionally uses deterministic aggregations from existing data only.
          </p>
          {/* TODO: Connect portfolio AI analysis once backend service contracts are finalised. */}
          {/* TODO: Add trend detection for changes across reporting periods. */}
          {/* TODO: Add source traceability links per insight for auditability. */}
          {/* TODO: Support human-reviewed commentary output for external client use. */}
        </div>
      )}

      {(assessmentsError || actionsError) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          {assessmentsError && <p>Assessment data could not be fully loaded: {assessmentsError}</p>}
          {actionsError && <p>Action data could not be fully loaded: {actionsError}</p>}
        </div>
      )}

      {hasNoData ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No portfolio data yet</h2>
          <p className="mt-2 text-slate-600">Create your first assessment to begin seeing portfolio-level analytics.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link
              to="/assessments"
              className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Go to Assessments
            </Link>
            <Link
              to="/assessments/new"
              className="px-4 py-2 bg-slate-900 rounded-md text-sm font-medium text-white hover:bg-slate-800"
            >
              New Assessment
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Portfolio Summary</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <p className="text-sm text-slate-500">Total Sites</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.totalSites}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <p className="text-sm text-slate-500">Total Assessments</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.totalAssessments}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <p className="text-sm text-slate-500">Open P1 Actions</p>
                <p className="mt-2 text-3xl font-bold text-rose-700">{metrics.openHighPriorityActions}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <p className="text-sm text-slate-500">Updated Last 30 Days</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.updatedLast30Days}</p>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Assessment Status Distribution</h2>
            <p className="text-sm text-slate-600 mt-1">Breakdown uses assessment status values currently available in the documents model.</p>
            <div className="mt-4 space-y-3">
              {statusDistributionRows.length === 0 ? (
                <p className="text-sm text-slate-500">No assessments available for status distribution.</p>
              ) : (
                statusDistributionRows.map((row) => {
                  const percentage = metrics.totalAssessments > 0 ? Math.round((row.count / metrics.totalAssessments) * 100) : 0;
                  return (
                    <div key={row.label}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-slate-700">{row.label}</span>
                        <span className="text-slate-600">{row.count} ({percentage}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-slate-700" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Common Action Modules</h2>
            <p className="text-sm text-slate-600 mt-1">Top module keys from action register entries (frequency-based).</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Module Key</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {metrics.commonActionGroups.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-sm text-center text-slate-500">
                        {actionsLoading ? 'Loading actions…' : 'No action groups available.'}
                      </td>
                    </tr>
                  ) : (
                    metrics.commonActionGroups.map((row, index) => (
                      <tr key={row.label}>
                        <td className="px-4 py-3 text-sm text-slate-600">#{index + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.label}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Action Profile</h2>
            <p className="text-sm text-slate-600 mt-1">Priority and status profile from the organisation-level action register.</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">By Priority</h3>
                <div className="mt-3 space-y-2">
                  {actionPriorityRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No actions available.</p>
                  ) : (
                    actionPriorityRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                        <span className="text-sm font-medium text-slate-700">{row.label}</span>
                        <span className="text-sm font-semibold text-slate-900">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">By Status</h3>
                <div className="mt-3 space-y-2">
                  {actionStatusRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No actions available.</p>
                  ) : (
                    actionStatusRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                        <span className="text-sm font-medium text-slate-700">{formatStatusLabel(row.label)}</span>
                        <span className="text-sm font-semibold text-slate-900">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Sites Requiring Attention</h2>
            <p className="text-sm text-slate-600 mt-1">
              Ranked by open P1 actions, then overdue actions, then total open actions.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Site</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Client</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Open P1</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Overdue</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Open Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {metrics.topSites.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-sm text-center text-slate-500">
                        No sites with open actions found.
                      </td>
                    </tr>
                  ) : (
                    metrics.topSites.map((site) => (
                      <tr key={`${site.clientName}-${site.siteName}`}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{site.siteName}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{site.clientName}</td>
                        <td className="px-4 py-3 text-sm text-right text-rose-700 font-semibold">{site.p1OpenActions}</td>
                        <td className="px-4 py-3 text-sm text-right text-amber-700 font-semibold">{site.overdueActions}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700 font-semibold">{site.openActions}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {(assessmentsLoading || actionsLoading) && (
            <p className="text-sm text-slate-500">
              Some sections may update as remaining data loads.
            </p>
          )}
        </>
      )}
    </div>
  );
}
