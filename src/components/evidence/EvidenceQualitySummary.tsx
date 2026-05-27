import { useState } from 'react';
import { Camera, ChevronDown, ChevronRight, AlertCircle, Link2Off, AlignLeft } from 'lucide-react';
import type { DocumentEvidenceSummary } from '../../hooks/useDocumentEvidenceSummary';

interface Props {
  summary: DocumentEvidenceSummary;
  totalModuleCount: number;
  className?: string;
}

/**
 * Advisory-only evidence quality summary panel.
 * Collapsed by default. Shows total files, module coverage,
 * unlinked count, and uncaptioned count.
 * Does not block document issue — informational only.
 */
export default function EvidenceQualitySummary({
  summary,
  totalModuleCount,
  className = '',
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (summary.isLoading || summary.totalCount === 0) return null;

  const hasQualitySignals =
    summary.unlinkedCount > 0 || summary.uncaptionedCount > 0;

  return (
    <div
      className={`bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-neutral-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-neutral-900">
            Evidence Summary
          </span>
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
            {summary.totalCount} {summary.totalCount === 1 ? 'file' : 'files'}
          </span>
          {hasQualitySignals && (
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-neutral-100">
          <div className="grid grid-cols-2 gap-2 pt-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
              <span className="text-xl font-bold text-neutral-900">
                {summary.totalCount}
              </span>
              <span className="text-xs text-neutral-500">Total files</span>
            </div>

            <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
              <span className="text-xl font-bold text-neutral-900">
                {summary.modulesWithEvidenceCount}
                <span className="text-sm font-normal text-neutral-500">
                  /{totalModuleCount}
                </span>
              </span>
              <span className="text-xs text-neutral-500">Modules covered</span>
            </div>

            <div
              className={`flex flex-col gap-1 p-3 rounded-lg border ${
                summary.unlinkedCount > 0
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-neutral-50 border-neutral-100'
              }`}
            >
              <span
                className={`text-xl font-bold ${
                  summary.unlinkedCount > 0
                    ? 'text-amber-700'
                    : 'text-neutral-900'
                }`}
              >
                {summary.unlinkedCount}
              </span>
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                <Link2Off className="w-3 h-3 flex-shrink-0" />
                Unlinked
              </span>
            </div>

            <div
              className={`flex flex-col gap-1 p-3 rounded-lg border ${
                summary.uncaptionedCount > 0
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-neutral-50 border-neutral-100'
              }`}
            >
              <span
                className={`text-xl font-bold ${
                  summary.uncaptionedCount > 0
                    ? 'text-amber-700'
                    : 'text-neutral-900'
                }`}
              >
                {summary.uncaptionedCount}
              </span>
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                <AlignLeft className="w-3 h-3 flex-shrink-0" />
                No caption
              </span>
            </div>
          </div>

          {hasQualitySignals && (
            <p className="mt-3 text-xs text-neutral-400">
              Advisory only — these indicators do not prevent document issue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
