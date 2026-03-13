import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import PortfolioInsightPanel from '../../components/ai/PortfolioInsightPanel';
import { usePortfolioMetrics } from '../../hooks/usePortfolioMetrics';
import { formatPortfolioGroupLabel, formatPortfolioStatusLabel } from '../../utils/portfolio/formatPortfolioLabels';

interface CardMetric {
  label: string;
  value: number;
  to?: string;
  state?: Record<string, unknown>;
}

function InteractiveRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        clickable
          ? 'border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors'
          : 'border-slate-200'
      }`}
    >
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export default function PortfolioPage() {
  const navigate = useNavigate();
  const {
    metrics,
    loading,
    assessmentsLoading,
    actionsLoading,
    assessmentsError,
    actionsError,
  } = usePortfolioMetrics();

  const [showInsightPanel, setShowInsightPanel] = useState(false);

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

  const summaryCards: CardMetric[] = [
    { label: 'Total Sites', value: metrics.totalSites, to: '/assessments' },
    { label: 'Total Assessments', value: metrics.totalAssessments, to: '/assessments' },
    { label: 'Open P1 Actions', value: metrics.openHighPriorityActions, to: '/dashboard/action-register?priority=P1' },
    { label: 'Updated Last 30 Days', value: metrics.updatedLast30Days, to: '/assessments?updatedWithinDays=30' },
  ];

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
          onClick={() => setShowInsightPanel((current) => !current)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Analyse Portfolio
        </button>
      </div>

      {showInsightPanel && (
        <PortfolioInsightPanel
          isOpen={showInsightPanel}
          onClose={() => setShowInsightPanel(false)}
          totals={{
            assessments: metrics.totalAssessments,
            actions: metrics.totalActions,
            sites: metrics.totalSites,
            updatedLast30Days: metrics.updatedLast30Days,
          }}
          statusRowCount={statusDistributionRows.length}
          moduleRowCount={metrics.commonActionGroups.length}
          topSiteCount={metrics.topSites.length}
        />
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
              {summaryCards.map((card) => {
                const isClickable = Boolean(card.to);
                return (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => card.to && navigate(card.to, card.state ? { state: card.state } : undefined)}
                    className={`bg-white rounded-lg border p-5 text-left ${
                      isClickable
                        ? 'border-slate-300 hover:border-slate-400 hover:shadow-sm cursor-pointer transition'
                        : 'border-slate-200'
                    }`}
                  >
                    <p className="text-sm text-slate-500">{card.label}</p>
                    <p className={`mt-2 text-3xl font-bold ${card.label === 'Open P1 Actions' ? 'text-rose-700' : 'text-slate-900'}`}>
                      {card.value}
                    </p>
                  </button>
                );
              })}
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
                    <div
                      key={row.label}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/assessments?status=${encodeURIComponent(row.label)}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(`/assessments?status=${encodeURIComponent(row.label)}`);
                        }
                      }}
                      className="rounded-md border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-slate-700">{formatPortfolioStatusLabel(row.label)}</span>
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
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Module</th>
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
                      <tr
                        key={row.label}
                        onClick={() => navigate(`/dashboard/action-register?module=${encodeURIComponent(row.label)}`)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-slate-600">#{index + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{formatPortfolioGroupLabel(row.label)}</td>
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
                      <InteractiveRow
                        key={row.label}
                        label={row.label}
                        value={String(row.count)}
                        onClick={() => navigate(`/dashboard/action-register?priority=${encodeURIComponent(row.label)}`)}
                      />
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
                      <InteractiveRow
                        key={row.label}
                        label={formatPortfolioStatusLabel(row.label)}
                        value={String(row.count)}
                        onClick={() => navigate(`/dashboard/action-register?status=${encodeURIComponent(row.label)}`)}
                      />
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
                      <tr
                        key={`${site.clientName}-${site.siteName}`}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => {
                          // Best-effort drill-through: document filter is exact, site/client included as context hint.
                          navigate(`/dashboard/action-register?document=${encodeURIComponent(site.documentId)}&site=${encodeURIComponent(site.siteName)}&client=${encodeURIComponent(site.clientName)}`);
                        }}
                      >
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
