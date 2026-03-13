interface PortfolioInsightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  totals: {
    assessments: number;
    actions: number;
    sites: number;
    updatedLast30Days: number;
  };
  statusRowCount: number;
  moduleRowCount: number;
  topSiteCount: number;
}

export default function PortfolioInsightPanel({
  isOpen,
  onClose,
  totals,
  statusRowCount,
  moduleRowCount,
  topSiteCount,
}: PortfolioInsightPanelProps) {
  if (!isOpen) return null;

  return (
    <aside className="w-full xl:w-[28rem] bg-white rounded-lg shadow-sm border border-slate-200 h-fit">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Portfolio Insight</h2>
          <p className="text-sm text-slate-600">Scaffold using current portfolio aggregates only.</p>
        </div>
        <button
          onClick={onClose}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="p-5 space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Summary</h3>
          <p className="text-sm text-slate-600">
            Portfolio analysis of {totals.assessments} assessments and {totals.actions} actions will appear here.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Concentrations</h3>
          <p className="text-sm text-slate-600">
            Current scaffold can reference {statusRowCount} assessment statuses and {moduleRowCount} frequent action modules.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Priorities</h3>
          <p className="text-sm text-slate-600">
            Priority insight placeholders currently cover {topSiteCount} high-attention sites and {totals.updatedLast30Days} recently updated assessments.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Commentary</h3>
          <p className="text-sm text-slate-600">
            Concentration and trend insights will be available when AI portfolio analysis is connected.
          </p>
        </section>

        {/* TODO: Connect this panel to backend AI portfolio analysis service when contracts are finalised. */}
        {/* TODO: Add trend detection across reporting periods and baseline comparisons. */}
        {/* TODO: Add source traceability/citations for each generated insight. */}
        {/* TODO: Add workflow for human-reviewed external commentary before client-facing use. */}
      </div>
    </aside>
  );
}
