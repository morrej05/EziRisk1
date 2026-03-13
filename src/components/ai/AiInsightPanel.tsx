interface AiInsightPanelProps {
  isOpen: boolean;
  mode: 'selection' | 'view';
  records: Array<{ id: string }>;
  onClose: () => void;
}

export default function AiInsightPanel({ isOpen, mode, records, onClose }: AiInsightPanelProps) {
  if (!isOpen) {
    return null;
  }

  const subtitle = mode === 'selection' ? 'Analysing selected records' : 'Summarising visible records';

  return (
    <aside className="w-full xl:w-96 bg-white rounded-lg shadow-sm border border-slate-200 h-fit sticky top-6">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI Insight</h2>
          <p className="text-sm text-slate-600">{subtitle}</p>
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
            AI analysis of {records.length} records will appear here.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Themes</h3>
          <p className="text-sm text-slate-600">
            Themes and patterns across {records.length} records will be shown once AI integration is connected.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Priorities</h3>
          <p className="text-sm text-slate-600">
            Priority actions and risk signals will be generated here in a structured format.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Draft Commentary</h3>
          <p className="text-sm text-slate-600">
            Draft commentary text for reports will appear here when the AI service is enabled.
          </p>
        </section>

        {/* TODO: send records to AI analysis service and request structured summary output. */}
        {/* TODO: return structured summary/themes/priorities/commentary with confidence metadata. */}
        {/* TODO: add citations and source traceability for safety-critical AI output. */}
        {/* TODO: require human approval before inserting AI text into client reports. */}
      </div>
    </aside>
  );
}
