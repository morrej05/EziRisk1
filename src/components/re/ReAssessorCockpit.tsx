import { useMemo } from 'react';
import { CheckCircle, AlertTriangle, PlayCircle, Edit3, FileText, List } from 'lucide-react';
import { getModuleDisplayLabel } from '../../lib/modules/moduleCatalog';

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  data?: Record<string, unknown>;
}

interface ReAssessorCockpitProps {
  modules: ModuleInstance[];
  completedModules: number;
  totalModules: number;
  firstIncomplete: ModuleInstance | undefined;
  actionCounts: { P1: number; P2: number; P3: number; P4: number };
  totalActions: number;
  blockingCount: number;
  reviewCount: number;
  onContinue: () => void;
  onOpenWorkspace: () => void;
  documentId: string;
  navigateTo: (path: string) => void;
  recommendationsPath: string;
}

function deriveIntelligenceSummaries(modules: ModuleInstance[]): string[] {
  const insights: string[] = [];

  const re02 = modules.find((m) => m.module_key === 'RE_02_CONSTRUCTION');
  if (re02?.data) {
    const buildings = ((re02.data as Record<string, unknown>)?.construction as Record<string, unknown>)?.buildings as unknown[];
    if (Array.isArray(buildings) && buildings.length > 0) {
      const hasCombustible = buildings.some(
        (b: unknown) => (b as Record<string, unknown>)?.combustible_cladding && ((b as Record<string, unknown>).combustible_cladding as Record<string, unknown>)?.present === true,
      );
      if (hasCombustible) {
        insights.push('Combustible cladding identified — review construction risk rating.');
      }
      const hasTimber = buildings.some((b: unknown) => {
        const frameType = (b as Record<string, unknown>)?.frame_type;
        return typeof frameType === 'string' && /timber|wood/i.test(frameType);
      });
      if (hasTimber && !hasCombustible) {
        insights.push('Timber frame construction present — check compartmentation scores.');
      }
    }
  }

  return insights;
}

export default function ReAssessorCockpit({
  modules,
  completedModules,
  totalModules,
  firstIncomplete,
  actionCounts,
  totalActions,
  blockingCount,
  reviewCount,
  onContinue,
  onOpenWorkspace,
  recommendationsPath,
  documentId,
  navigateTo,
}: ReAssessorCockpitProps) {
  const completionPercentage = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
  const allComplete = !firstIncomplete;
  const highPriorityCount = actionCounts.P1 + actionCounts.P2;

  const intelligenceSummaries = useMemo(() => deriveIntelligenceSummaries(modules), [modules]);

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {/* Survey Status Header */}
      <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Survey Status</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {completedModules}/{totalModules} modules complete
              {totalActions > 0 ? ` · ${totalActions} recommendation${totalActions !== 1 ? 's' : ''}` : ''}
              {blockingCount > 0 ? ` · ${blockingCount} blocking issue${blockingCount !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onOpenWorkspace}
              className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-300 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5 mr-1.5" />
              Workspace
            </button>
            <button
              onClick={onContinue}
              disabled={allComplete}
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
              {allComplete ? 'All Complete' : 'Continue'}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <div className="w-full bg-neutral-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${allComplete ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Body: three-column on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-neutral-100">

        {/* Next Action */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Next action</p>
          {allComplete ? (
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-neutral-900">All modules complete</p>
                <p className="text-xs text-neutral-500 mt-0.5">Review recommendations and preview the report</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <PlayCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {getModuleDisplayLabel(firstIncomplete!.module_key)}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">Next incomplete module</p>
              </div>
            </div>
          )}

          {blockingCount > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 border border-red-100 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 font-medium">
                {blockingCount} issue-blocking item{blockingCount !== 1 ? 's' : ''} — resolve before issuing
              </p>
            </div>
          )}
        </div>

        {/* Recommendation Summary */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Recommendations</p>
            <button
              onClick={() => navigateTo(recommendationsPath)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <List className="w-3 h-3" />
              Register
            </button>
          </div>

          {totalActions === 0 ? (
            <p className="text-sm text-neutral-500">No recommendations recorded</p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              {actionCounts.P1 > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                    {actionCounts.P1}
                  </span>
                  <span className="text-xs text-neutral-600">High</span>
                </div>
              )}
              {actionCounts.P2 > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                    {actionCounts.P2}
                  </span>
                  <span className="text-xs text-neutral-600">Medium</span>
                </div>
              )}
              {actionCounts.P3 > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                    {actionCounts.P3}
                  </span>
                  <span className="text-xs text-neutral-600">Low</span>
                </div>
              )}
              {actionCounts.P4 > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 text-xs font-bold">
                    {actionCounts.P4}
                  </span>
                  <span className="text-xs text-neutral-600">Advisory</span>
                </div>
              )}
            </div>
          )}

          {highPriorityCount > 0 && (
            <p className="text-xs text-amber-700 mt-2 font-medium">
              {highPriorityCount} high/medium finding{highPriorityCount !== 1 ? 's' : ''} require attention
            </p>
          )}
        </div>

        {/* Site Intelligence */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Site intelligence</p>

          {intelligenceSummaries.length === 0 && reviewCount === 0 ? (
            <div className="flex items-start gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-neutral-600">No construction or hazard flags identified</p>
            </div>
          ) : (
            <div className="space-y-2">
              {intelligenceSummaries.map((insight, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-neutral-700">{insight}</p>
                </div>
              ))}
              {reviewCount > 0 && intelligenceSummaries.length === 0 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-neutral-700">
                    {reviewCount} item{reviewCount !== 1 ? 's' : ''} to review before issue
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => navigateTo(`/documents/${documentId}/preview`)}
            className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Preview report
          </button>
        </div>
      </div>
    </div>
  );
}
