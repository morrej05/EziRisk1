import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import {
  type PortfolioAiInsights,
  type PortfolioAiPayload,
  generatePortfolioInsights,
} from '../../lib/ai/generatePortfolioInsights';

interface PortfolioInsightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  payload: PortfolioAiPayload;
  canGenerate: boolean;
  initialInsights?: PortfolioAiInsights | null;
  onInsightsGenerated?: (insights: PortfolioAiInsights) => void;
  onGenerationError?: (message: string) => void;
}

type PanelState = 'idle' | 'loading' | 'success' | 'error';

export default function PortfolioInsightPanel({
  isOpen,
  onClose,
  payload,
  canGenerate,
  initialInsights,
  onInsightsGenerated,
  onGenerationError,
}: PortfolioInsightPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [insights, setInsights] = useState<PortfolioAiInsights | null>(initialInsights || null);
  const [copied, setCopied] = useState(false);

  const payloadSignature = useMemo(() => JSON.stringify(payload), [payload]);

  const runGeneration = async () => {
    if (!canGenerate) return;

    setPanelState('loading');
    setErrorMessage(null);

    try {
      const result = await generatePortfolioInsights(payload);
      setInsights(result);
      onInsightsGenerated?.(result);
      setPanelState('success');
    } catch (error) {
      setPanelState('error');
      const message = error instanceof Error ? error.message : 'Unable to generate portfolio insights right now.';
      setErrorMessage(message);
      onGenerationError?.(message);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    if (!canGenerate) {
      setPanelState('idle');
      setErrorMessage(null);
      setInsights(initialInsights || null);
      return;
    }

    if (initialInsights) {
      setInsights(initialInsights);
      setPanelState('success');
      return;
    }

    void runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canGenerate, payloadSignature, initialInsights]);

  if (!isOpen) return null;

  const handleCopyCommentary = async () => {
    if (!insights?.draftCommentary) return;

    try {
      await navigator.clipboard.writeText(insights.draftCommentary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="w-full xl:w-[28rem] bg-white rounded-lg shadow-sm border border-slate-200 h-fit">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Portfolio Insight</h2>
          <p className="text-sm text-slate-600">AI interpretation of current portfolio aggregates.</p>
        </div>
        <button
          onClick={onClose}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          AI-generated insight should be reviewed before external use.
        </p>

        {!canGenerate && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Insufficient portfolio data for AI insight. Add assessments and actions, then try again.
            </p>
          </div>
        )}

        {canGenerate && panelState === 'loading' && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">Generating concise portfolio insights from aggregate data…</p>
          </div>
        )}

        {canGenerate && panelState === 'error' && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 space-y-3">
            <p className="text-sm text-rose-800">
              We could not generate portfolio insight at this time. Please try again.
            </p>
            {errorMessage && <p className="text-xs text-rose-700">Details: {errorMessage}</p>}
            <button
              type="button"
              onClick={() => void runGeneration()}
              className="inline-flex items-center gap-2 text-sm font-medium text-rose-800 hover:text-rose-900"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {canGenerate && panelState === 'success' && insights && (
          <>
            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Summary</h3>
              <p className="text-sm text-slate-700">{insights.summary}</p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Concentrations</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                {insights.concentrations.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Priorities</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                {insights.priorities.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-slate-900">Draft Commentary</h3>
                <button
                  type="button"
                  onClick={() => void handleCopyCommentary()}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copied' : 'Copy commentary'}
                </button>
              </div>
              <p className="text-sm text-slate-700">{insights.draftCommentary}</p>
            </section>

            <button
              type="button"
              onClick={() => void runGeneration()}
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </button>
          </>
        )}

        {/* TODO: Surface aggregate-to-output traceability per section for reviewer confidence. */}
        {/* TODO: Add approval gates before enabling export of AI commentary into formal reports. */}
      </div>
    </aside>
  );
}
