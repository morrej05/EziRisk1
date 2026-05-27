import { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  RefreshCw,
  Save,
  Shield,
  ChevronDown,
  ChevronRight,
  Lock,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { isDocumentLocked } from '../../../utils/documentLock';
import { getActionsRefreshKey } from '../../../utils/actionsRefreshKey';
import {
  computeFsdSummary,
  type FsdOutcome,
  type FsdComputedSummary,
} from '../../../lib/fsd/fsdAssuranceEngine';
import type { AssuranceFlag } from '../../../lib/fsd/fsdConsistencyEngine';
import ModuleActions from '../ModuleActions';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ModuleInstance {
  id: string;
  module_key?: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface Document {
  id: string;
  title: string;
  issue_status?: 'draft' | 'issued' | 'superseded';
}

interface FSD10FireStrategySummaryFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface AllModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes?: string;
  data: Record<string, any>;
}

// ─── Outcome vocabulary ───────────────────────────────────────────────────────

type OverrideOutcome = Exclude<FsdOutcome, 'na'>;

const OVERRIDE_OUTCOME_OPTIONS: { value: OverrideOutcome; label: string }[] = [
  { value: 'compliant', label: 'Compliant — strategy meets the stated design basis' },
  { value: 'minor_def', label: 'Minor Deficiency — limited issues requiring attention' },
  { value: 'material_def', label: 'Significant Deficiency — material issues requiring resolution' },
  { value: 'info_gap', label: 'Information Gap — strategy cannot be fully assessed' },
];

// ─── Styling helpers ──────────────────────────────────────────────────────────

function getOutcomeStyles(outcome: string): string {
  switch (outcome) {
    case 'material_def':
      return 'text-red-800 bg-red-50 border-red-300';
    case 'minor_def':
      return 'text-amber-800 bg-amber-50 border-amber-300';
    case 'info_gap':
      return 'text-blue-800 bg-blue-50 border-blue-300';
    case 'compliant':
      return 'text-green-800 bg-green-50 border-green-300';
    default:
      return 'text-neutral-700 bg-neutral-50 border-neutral-200';
  }
}

function getOutcomeIcon(outcome: string) {
  switch (outcome) {
    case 'material_def':
      return <AlertCircle className="w-5 h-5 text-red-700" />;
    case 'minor_def':
      return <AlertTriangle className="w-5 h-5 text-amber-700" />;
    case 'info_gap':
      return <Info className="w-5 h-5 text-blue-700" />;
    case 'compliant':
      return <CheckCircle className="w-5 h-5 text-green-700" />;
    default:
      return <Info className="w-5 h-5 text-neutral-500" />;
  }
}

function getOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'material_def':
      return 'Significant Deficiency';
    case 'minor_def':
      return 'Minor Deficiency';
    case 'info_gap':
      return 'Information Gap';
    case 'compliant':
      return 'Compliant';
    default:
      return outcome || 'Not assessed';
  }
}

function getFlagSeverityStyles(severity: AssuranceFlag['severity']): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'major':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'info':
      return 'bg-blue-100 text-blue-800 border-blue-300';
  }
}

function getFlagSeverityIcon(severity: AssuranceFlag['severity']) {
  switch (severity) {
    case 'critical':
      return <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />;
    case 'major':
      return <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />;
    case 'info':
      return <Info className="w-4 h-4 text-blue-600 shrink-0" />;
  }
}

// ─── Outcome count matrix ─────────────────────────────────────────────────────

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  A1_DOC_CONTROL: 'Document Control',
  A2_BUILDING_PROFILE: 'Building Profile',
  A3_PERSONS_AT_RISK: 'Persons at Risk',
  FSD_1_REG_BASIS: 'Regulatory Basis',
  FSD_2_EVAC_STRATEGY: 'Evacuation Strategy',
  FSD_3_ESCAPE_DESIGN: 'Means of Escape Design',
  FSD_4_PASSIVE_PROTECTION: 'Passive Fire Protection',
  FSD_5_ACTIVE_SYSTEMS: 'Active Fire Systems',
  FSD_6_FRS_ACCESS: 'Fire Service Access',
  FSD_7_DRAWINGS: 'Drawings Index',
  FSD_8_SMOKE_CONTROL: 'Smoke Control',
  FSD_9_CONSTRUCTION_PHASE: 'Construction Phase',
};

// ─── Collapsible section wrapper ──────────────────────────────────────────────

function CollapsibleCard({
  title,
  description,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-neutral-50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3">
          <div>
            <span className="text-base font-semibold text-neutral-900">{title}</span>
            {description && (
              <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
            )}
          </div>
          {badge}
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
        )}
      </button>
      {open && <div className="px-6 pb-6 pt-0">{children}</div>}
    </div>
  );
}

// ─── Conclusion textarea field ────────────────────────────────────────────────

function ConclusionField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows = 4,
  disabled = false,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-neutral-800 mb-1">{label}</label>
      <p className="text-xs text-neutral-500 mb-2">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm disabled:bg-neutral-50 disabled:text-neutral-500"
      />
    </div>
  );
}

// ─── Main Form ────────────────────────────────────────────────────────────────

export default function FSD10FireStrategySummaryForm({
  moduleInstance,
  document,
  onSaved,
}: FSD10FireStrategySummaryFormProps) {
  const isLocked = isDocumentLocked(document.issue_status);
  const actionsRefreshKey = getActionsRefreshKey(document.id, moduleInstance.id);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allModuleInstances, setAllModuleInstances] = useState<AllModuleInstance[]>([]);

  // ── Override fields (mirrors FRA-90 / DSEAR-12 pattern) ──────────────────
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(
    moduleInstance.data.override?.enabled ?? false
  );
  const [overrideOutcome, setOverrideOutcome] = useState<OverrideOutcome | ''>(
    moduleInstance.data.override?.outcome ?? ''
  );
  const [overrideReason, setOverrideReason] = useState<string>(
    moduleInstance.data.override?.reason ?? ''
  );

  // ── Professional conclusion fields ───────────────────────────────────────
  const [overallStrategyPosition, setOverallStrategyPosition] = useState<string>(
    moduleInstance.data.conclusion?.overallStrategyPosition ?? ''
  );
  const [principalRisksAndConstraints, setPrincipalRisksAndConstraints] = useState<string>(
    moduleInstance.data.conclusion?.principalRisksAndConstraints ?? ''
  );
  const [strategyAdequacy, setStrategyAdequacy] = useState<string>(
    moduleInstance.data.conclusion?.strategyAdequacy ?? ''
  );
  const [outstandingLimitations, setOutstandingLimitations] = useState<string>(
    moduleInstance.data.conclusion?.outstandingLimitations ?? ''
  );
  const [assumptionsAndDependencies, setAssumptionsAndDependencies] = useState<string>(
    moduleInstance.data.conclusion?.assumptionsAndDependencies ?? ''
  );
  const [unresolvedInformationGaps, setUnresolvedInformationGaps] = useState<string>(
    moduleInstance.data.conclusion?.unresolvedInformationGaps ?? ''
  );
  const [recommendedFollowUp, setRecommendedFollowUp] = useState<string>(
    moduleInstance.data.conclusion?.recommendedFollowUp ?? ''
  );
  const [professionalCommentary, setProfessionalCommentary] = useState<string>(
    moduleInstance.data.conclusion?.professionalCommentary ?? ''
  );

  // ── Load sibling module instances ─────────────────────────────────────────
  useEffect(() => {
    loadModules();
  }, [document.id]);

  const loadModules = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('module_instances')
        .select('id, module_key, outcome, assessor_notes, data')
        .eq('document_id', document.id);

      if (error) throw error;
      setAllModuleInstances(data ?? []);
    } catch {
      // Non-fatal: computed summary degrades gracefully on empty input
    } finally {
      setIsLoading(false);
    }
  };

  // ── Run assurance engine ──────────────────────────────────────────────────
  const computedSummary: FsdComputedSummary = useMemo(() => {
    return computeFsdSummary({ modules: allModuleInstances });
  }, [allModuleInstances]);

  const displayOutcome: string =
    overrideEnabled && overrideOutcome ? overrideOutcome : computedSummary.computedOutcome;

  // ── Flag counts ───────────────────────────────────────────────────────────
  const criticalFlagCount = computedSummary.assuranceFlags.filter(
    (f) => f.severity === 'critical'
  ).length;
  const majorFlagCount = computedSummary.assuranceFlags.filter(
    (f) => f.severity === 'major'
  ).length;
  const infoFlagCount = computedSummary.assuranceFlags.filter(
    (f) => f.severity === 'info'
  ).length;

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (isLocked) return;

    if (overrideEnabled && !overrideReason.trim()) {
      alert(
        'Override justification is required when overriding the computed strategy outcome.'
      );
      return;
    }
    if (overrideEnabled && !overrideOutcome) {
      alert('Please select an override outcome.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const mergedData = {
        ...(moduleInstance.data ?? {}),
        computed: {
          computedOutcome: computedSummary.computedOutcome,
          deviationCount: computedSummary.deviations.length,
          infoGapCount: computedSummary.infoGaps.length,
          criticalFlagCount,
          majorFlagCount,
          infoFlagCount,
          flagCount: computedSummary.assuranceFlags.length,
        },
        override: {
          enabled: overrideEnabled,
          outcome: overrideEnabled ? overrideOutcome : null,
          reason: overrideEnabled ? overrideReason.trim() : null,
        },
        conclusion: {
          overallStrategyPosition,
          principalRisksAndConstraints,
          strategyAdequacy,
          outstandingLimitations,
          assumptionsAndDependencies,
          unresolvedInformationGaps,
          recommendedFollowUp,
          professionalCommentary,
        },
      };

      const payload = sanitizeModuleInstancePayload(
        {
          data: mergedData,
          outcome: displayOutcome || null,
          updated_at: new Date().toISOString(),
        },
        moduleInstance.module_key
      );

      const { error } = await supabase
        .from('module_instances')
        .update(payload)
        .eq('id', moduleInstance.id);

      if (error) throw error;

      setLastSaved(new Date().toLocaleTimeString());
      onSaved();
    } catch (err) {
      setSaveError('Failed to save. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-neutral-400 animate-spin" />
          <span className="ml-3 text-neutral-600">Computing fire strategy summary…</span>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Lock banner */}
      {isLocked && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg flex items-start gap-3">
          <Lock className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-blue-900">Issued — Read Only</p>
            <p className="text-sm text-blue-800 mt-1">
              This document has been issued and cannot be edited.
            </p>
          </div>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-900">{saveError}</p>
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Shield className="w-6 h-6 text-neutral-700" />
          <h2 className="text-2xl font-bold text-neutral-900">
            FSD-10 — Fire Strategy Summary &amp; Professional Conclusion
          </h2>
        </div>
        <p className="text-neutral-600 text-sm">
          Synthesises the cross-module strategy assurance and captures the assessor's
          professional conclusion on the overall fire strategy position.
        </p>
        {lastSaved && (
          <div className="flex items-center gap-2 mt-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" />
            Last saved at {lastSaved}
          </div>
        )}
      </div>

      {/* ── 1. Computed Strategy Assurance ──────────────────────────────── */}
      <CollapsibleCard
        title="Computed Strategy Assurance"
        description="Auto-derived from FSD modules 1–9 via the consistency and assurance engine"
      >
        {/* Scope sentence */}
        <div className="mb-4 p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
          <p className="text-sm text-neutral-700 italic">{computedSummary.scopeSentence}</p>
        </div>

        {/* Overall computed outcome */}
        <div
          className={`flex items-start gap-3 p-4 rounded-lg border mb-4 ${getOutcomeStyles(
            computedSummary.computedOutcome
          )}`}
        >
          {getOutcomeIcon(computedSummary.computedOutcome)}
          <div>
            <p className="font-bold text-sm">
              Overall computed strategy position:{' '}
              {getOutcomeLabel(computedSummary.computedOutcome)}
            </p>
            <p className="text-xs mt-0.5">
              {computedSummary.computedOutcome === 'material_def' &&
                'Material strategy deficiencies identified — resolution required before issue.'}
              {computedSummary.computedOutcome === 'minor_def' &&
                'Minor strategy issues or clarifications identified.'}
              {computedSummary.computedOutcome === 'info_gap' &&
                'Information gaps limit full assurance of compliance.'}
              {computedSummary.computedOutcome === 'compliant' &&
                'Strategy is consistent with the stated design basis, subject to the scope and limitations.'}
            </p>
          </div>
        </div>

        {/* Outcome count matrix */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-red-700">
              {computedSummary.outcomeCounts.material_def}
            </div>
            <div className="text-xs text-red-600 mt-0.5">Significant Deficiency</div>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-700">
              {computedSummary.outcomeCounts.info_gap}
            </div>
            <div className="text-xs text-blue-600 mt-0.5">Information Gap</div>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-amber-700">
              {computedSummary.outcomeCounts.minor_def}
            </div>
            <div className="text-xs text-amber-600 mt-0.5">Minor Deficiency</div>
          </div>
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-700">
              {computedSummary.outcomeCounts.compliant}
            </div>
            <div className="text-xs text-green-600 mt-0.5">Compliant</div>
          </div>
        </div>

        {/* Assurance flags */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-neutral-700">
              Consistency &amp; assurance checks
            </p>
            <div className="flex items-center gap-2">
              {criticalFlagCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded border bg-red-100 text-red-800 border-red-300">
                  {criticalFlagCount} Critical
                </span>
              )}
              {majorFlagCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded border bg-orange-100 text-orange-800 border-orange-300">
                  {majorFlagCount} Major
                </span>
              )}
              {infoFlagCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded border bg-blue-100 text-blue-800 border-blue-300">
                  {infoFlagCount} Info
                </span>
              )}
            </div>
          </div>
          {computedSummary.assuranceFlags.length === 0 ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm text-green-800 font-medium">
                No consistency or assurance flags raised by the engine.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {computedSummary.assuranceFlags.map((flag) => (
                <div
                  key={flag.id}
                  className="p-3 rounded-lg border bg-neutral-50"
                >
                  <div className="flex items-start gap-2 mb-1">
                    {getFlagSeverityIcon(flag.severity)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold rounded border uppercase shrink-0 ${getFlagSeverityStyles(
                            flag.severity
                          )}`}
                        >
                          {flag.severity}
                        </span>
                        <span className="text-xs font-mono text-neutral-400">{flag.id}</span>
                        <span className="text-sm font-semibold text-neutral-900">
                          {flag.title}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600 mt-1">{flag.detail}</p>
                      {flag.relatedModules.length > 0 && (
                        <p className="text-xs text-neutral-400 mt-1">
                          Related:{' '}
                          {flag.relatedModules
                            .map(
                              (k) => MODULE_DISPLAY_NAMES[k] || k
                            )
                            .join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deviations */}
        {computedSummary.deviations.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-neutral-700 mb-2">
              Registered deviations ({computedSummary.deviations.length})
            </p>
            <div className="space-y-2">
              {computedSummary.deviations.map((dev, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-amber-200 bg-amber-50"
                >
                  {dev.topic && (
                    <p className="text-xs font-semibold text-amber-900 mb-0.5">
                      {dev.topic}
                    </p>
                  )}
                  {dev.deviation && (
                    <p className="text-xs text-amber-800">{dev.deviation}</p>
                  )}
                  {dev.justification && (
                    <p className="text-xs text-amber-700 mt-1 italic">
                      Justification: {dev.justification}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Information gaps */}
        {computedSummary.infoGaps.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-neutral-700 mb-2">
              Modules with information gaps ({computedSummary.infoGaps.length})
            </p>
            <div className="space-y-1">
              {computedSummary.infoGaps.map((gap) => (
                <div
                  key={gap.moduleKey}
                  className="flex items-start gap-2 p-2 rounded border border-blue-200 bg-blue-50"
                >
                  <Info className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-blue-900">{gap.title}</p>
                    {gap.note && (
                      <p className="text-xs text-blue-700 mt-0.5">{gap.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleCard>

      {/* ── 2. Professional Override ──────────────────────────────────────── */}
      <CollapsibleCard
        title="Override Computed Outcome (Optional)"
        description="Use professional judgment to set a different outcome — requires documented justification"
        defaultOpen={overrideEnabled}
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={overrideEnabled}
              disabled={isLocked}
              onChange={(e) => {
                setOverrideEnabled(e.target.checked);
                if (!e.target.checked) {
                  setOverrideOutcome('');
                  setOverrideReason('');
                }
              }}
              className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-neutral-900"
            />
            <span className="text-sm font-medium text-neutral-700">
              Override computed outcome with professional judgment
            </span>
          </label>

          {overrideEnabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Override outcome <span className="text-red-600">*</span>
                </label>
                <select
                  value={overrideOutcome}
                  disabled={isLocked}
                  onChange={(e) =>
                    setOverrideOutcome(e.target.value as OverrideOutcome | '')
                  }
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:bg-neutral-50"
                >
                  <option value="">Select outcome…</option>
                  {OVERRIDE_OUTCOME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Override justification (required){' '}
                  <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={overrideReason}
                  disabled={isLocked}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Provide a clear, professionally defensible justification. Examples: compensating design measures not captured by automated checks; peer-reviewed engineering analysis supports a different conclusion; specific project context reduces risk below the level indicated by the automated result…"
                  rows={4}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none disabled:bg-neutral-50"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  This justification will appear in the issued report alongside the override
                  notation, and will be attributed to the named assessor.
                </p>
              </div>

              {overrideReason.trim() && overrideOutcome && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-800">
                    <strong>Note:</strong> The issued report will display{' '}
                    <strong>{getOutcomeLabel(overrideOutcome)}</strong> as the authoritative
                    strategy outcome, and will include a notation that the computed result
                    was overridden with the justification above.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Active override summary */}
          {overrideEnabled && overrideOutcome && (
            <div
              className={`flex items-center gap-3 p-3 rounded-lg border ${getOutcomeStyles(
                displayOutcome
              )}`}
            >
              {getOutcomeIcon(displayOutcome)}
              <div>
                <p className="font-semibold text-sm">
                  Authoritative outcome: {getOutcomeLabel(displayOutcome)}
                </p>
                <p className="text-xs mt-0.5">
                  Computed was {getOutcomeLabel(computedSummary.computedOutcome)} — overridden
                  by assessor
                </p>
              </div>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {/* ── 3. Professional Conclusion ────────────────────────────────────── */}
      <CollapsibleCard
        title="Professional Conclusion"
        description="Structured assessor narrative for the issued report — complete all fields relevant to this assessment"
      >
        <div className="space-y-6">

          <ConclusionField
            label="Overall fire strategy position"
            hint="Summarise the overall fire strategy position for this building and design. Reference the regulatory basis, evacuation strategy type, and the adequacy of passive and active measures."
            placeholder="The fire strategy for this building is presented on the basis of… The principal life safety objectives are… Having regard to the measures identified during the assessment, the fire strategy is considered to be…"
            value={overallStrategyPosition}
            onChange={setOverallStrategyPosition}
            rows={5}
            disabled={isLocked}
          />

          <ConclusionField
            label="Principal risks and constraints"
            hint="Identify the most significant fire safety risks or design constraints identified during this assessment. Reference specific strategy elements where applicable."
            placeholder="The principal risks and constraints identified during this assessment are: 1. … 2. … 3. … These are reflected in the action register at the corresponding priority levels."
            value={principalRisksAndConstraints}
            onChange={setPrincipalRisksAndConstraints}
            rows={5}
            disabled={isLocked}
          />

          <ConclusionField
            label="Adequacy of fire strategy measures"
            hint="Provide a professional opinion on the overall adequacy of the fire strategy measures, including passive protection, active systems, evacuation arrangements and fire service access."
            placeholder="The fire strategy measures identified within this assessment are considered to be… The passive fire protection is… The active systems design is… The evacuation strategy is considered appropriate for the building use and occupancy profile because…"
            value={strategyAdequacy}
            onChange={setStrategyAdequacy}
            rows={5}
            disabled={isLocked}
          />

          <ConclusionField
            label="Outstanding design limitations"
            hint="Document the specific outstanding limitations of this strategy — items requiring further design development, areas of uncertainty, or aspects outside the scope of this assessment."
            placeholder="The following outstanding limitations apply to this strategy: … These limitations do not invalidate the strategy conclusions but should be addressed during the detailed design / construction stage…"
            value={outstandingLimitations}
            onChange={setOutstandingLimitations}
            rows={4}
            disabled={isLocked}
          />

          <ConclusionField
            label="Assumptions and design dependencies"
            hint="Record the key design assumptions underpinning this strategy. These should include structural fire resistance assumptions, compartmentation performance, alarm and detection assumptions, and evacuation management dependencies."
            placeholder="This strategy is based on the following key design assumptions: 1. … 2. … 3. … The strategy is dependent on the following being implemented and maintained: …"
            value={assumptionsAndDependencies}
            onChange={setAssumptionsAndDependencies}
            rows={4}
            disabled={isLocked}
          />

          <ConclusionField
            label="Unresolved information gaps"
            hint="Summarise any information gaps that could not be resolved during the assessment, and their likely effect on the strategy position. This supplements the automated gap detection above."
            placeholder="The following information gaps remain unresolved at the time of this assessment: … These gaps affect the assurance position in the following respects: … Resolution is recommended prior to…"
            value={unresolvedInformationGaps}
            onChange={setUnresolvedInformationGaps}
            rows={4}
            disabled={isLocked}
          />

          <ConclusionField
            label="Recommended follow-up actions"
            hint="Provide a high-level narrative summary of recommended follow-up actions. The detailed action register is separate — this field provides the strategic framing and sets priorities in context."
            placeholder="The recommendations arising from this strategy assessment are directed principally at… Priority actions address… Upon implementation of the priority recommendations, the strategy position would be expected to improve to…"
            value={recommendedFollowUp}
            onChange={setRecommendedFollowUp}
            rows={4}
            disabled={isLocked}
          />

          <ConclusionField
            label="Professional commentary"
            hint="Any additional professional commentary not captured above — project context, peer-review notes, coordination requirements with other consultants, or design-stage caveats."
            placeholder="Additional professional commentary: … This strategy has been prepared in accordance with… Coordination is required with… This conclusion is based on the information available at the time of assessment."
            value={professionalCommentary}
            onChange={setProfessionalCommentary}
            rows={4}
            disabled={isLocked}
          />
        </div>
      </CollapsibleCard>

      {/* ── Authoritative outcome summary bar ─────────────────────────────── */}
      <div
        className={`flex items-center gap-3 p-4 rounded-lg border font-medium text-sm ${getOutcomeStyles(
          displayOutcome
        )}`}
      >
        {getOutcomeIcon(displayOutcome)}
        <div>
          <span className="font-bold">Authoritative strategy outcome for this report: </span>
          {getOutcomeLabel(displayOutcome)}
          {overrideEnabled && overrideOutcome && (
            <span className="ml-2 text-xs font-normal opacity-75">
              (assessor override — computed was{' '}
              {getOutcomeLabel(computedSummary.computedOutcome)})
            </span>
          )}
        </div>
      </div>

      {/* ── Save button ──────────────────────────────────────────────────── */}
      {!isLocked && (
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors ${
              isSaving
                ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            <Save className="w-5 h-5" />
            {isSaving ? 'Saving…' : 'Save Fire Strategy Summary & Professional Conclusion'}
          </button>
        </div>
      )}

      {/* Module actions */}
      {document?.id && moduleInstance?.id && (
        <ModuleActions
          key={actionsRefreshKey}
          documentId={document.id}
          moduleInstanceId={moduleInstance.id}
        />
      )}
    </div>
  );
}
