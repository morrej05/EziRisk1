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
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import {
  computeExplosionSummary,
  type ExplosionCriticality,
  type ExplosionSummary,
} from '../../../lib/dsear/criticalityEngine';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ModuleInstance {
  id: string;
  module_key?: string;
  data: Record<string, any>;
}

interface Document {
  id: string;
  title: string;
}

interface DSEAR12ExplosionRiskSummaryFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface AllModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  data: Record<string, any>;
}

// ─── Outcome helpers ──────────────────────────────────────────────────────────

const CRITICALITY_OUTCOMES: { value: ExplosionCriticality; label: string }[] = [
  { value: 'Critical', label: 'Critical — immediate compliance action required' },
  { value: 'High', label: 'High — significant deficiencies requiring prompt remediation' },
  { value: 'Moderate', label: 'Moderate — improvements required to strengthen controls' },
  { value: 'Low', label: 'Low — explosion risk controls broadly adequate' },
];

function getCriticalityStyles(level: ExplosionCriticality | string): string {
  switch (level) {
    case 'Critical':
      return 'text-red-800 bg-red-50 border-red-300';
    case 'High':
      return 'text-orange-800 bg-orange-50 border-orange-300';
    case 'Moderate':
      return 'text-amber-800 bg-amber-50 border-amber-300';
    case 'Low':
      return 'text-green-800 bg-green-50 border-green-300';
    default:
      return 'text-neutral-700 bg-neutral-50 border-neutral-200';
  }
}

function getCriticalityIcon(level: ExplosionCriticality | string) {
  switch (level) {
    case 'Critical':
      return <AlertCircle className="w-5 h-5 text-red-700" />;
    case 'High':
      return <AlertTriangle className="w-5 h-5 text-orange-700" />;
    case 'Moderate':
      return <Info className="w-5 h-5 text-amber-700" />;
    case 'Low':
      return <CheckCircle className="w-5 h-5 text-green-700" />;
    default:
      return <Info className="w-5 h-5 text-neutral-500" />;
  }
}

function getFlagLevelStyles(level: 'critical' | 'high' | 'moderate'): string {
  switch (level) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'high':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'moderate':
      return 'bg-amber-100 text-amber-800 border-amber-300';
  }
}

// ─── Collapsible section wrapper ──────────────────────────────────────────────

function CollapsibleCard({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
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
        <div>
          <span className="text-base font-semibold text-neutral-900">{title}</span>
          {description && (
            <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
          )}
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

// ─── Main Form ────────────────────────────────────────────────────────────────

export default function DSEAR12ExplosionRiskSummaryForm({
  moduleInstance,
  document,
  onSaved,
}: DSEAR12ExplosionRiskSummaryFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [allModuleInstances, setAllModuleInstances] = useState<AllModuleInstance[]>([]);

  // ── Override fields (mirrors FRA-90 pattern) ─────────────────────────────
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(
    moduleInstance.data.override?.enabled ?? false
  );
  const [overrideOutcome, setOverrideOutcome] = useState<ExplosionCriticality | ''>(
    moduleInstance.data.override?.outcome ?? ''
  );
  const [overrideReason, setOverrideReason] = useState<string>(
    moduleInstance.data.override?.reason ?? ''
  );

  // ── Professional conclusion fields ───────────────────────────────────────
  const [overallExplosionRiskPosition, setOverallExplosionRiskPosition] = useState<string>(
    moduleInstance.data.conclusion?.overallExplosionRiskPosition ?? ''
  );
  const [principalConcerns, setPrincipalConcerns] = useState<string>(
    moduleInstance.data.conclusion?.principalConcerns ?? ''
  );
  const [controlAdequacy, setControlAdequacy] = useState<string>(
    moduleInstance.data.conclusion?.controlAdequacy ?? ''
  );
  const [residualRiskCommentary, setResidualRiskCommentary] = useState<string>(
    moduleInstance.data.conclusion?.residualRiskCommentary ?? ''
  );
  const [operationalObservations, setOperationalObservations] = useState<string>(
    moduleInstance.data.conclusion?.operationalObservations ?? ''
  );
  const [recommendationsSummary, setRecommendationsSummary] = useState<string>(
    moduleInstance.data.conclusion?.recommendationsSummary ?? ''
  );
  const [limitationsAndAssumptions, setLimitationsAndAssumptions] = useState<string>(
    moduleInstance.data.conclusion?.limitationsAndAssumptions ?? ''
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
        .select('id, module_key, outcome, data')
        .eq('document_id', document.id);

      if (error) throw error;
      setAllModuleInstances(data ?? []);
    } catch (err) {
      // Non-fatal: computed summary degrades gracefully on empty input
    } finally {
      setIsLoading(false);
    }
  };

  // ── Run criticality engine ────────────────────────────────────────────────
  const computedSummary: ExplosionSummary = useMemo(() => {
    return computeExplosionSummary({ modules: allModuleInstances });
  }, [allModuleInstances]);

  const displayCriticality: ExplosionCriticality =
    overrideEnabled && overrideOutcome ? overrideOutcome : computedSummary.overall;

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (overrideEnabled && !overrideReason.trim()) {
      alert(
        'Override reason is required when overriding the computed explosion criticality.'
      );
      return;
    }
    if (overrideEnabled && !overrideOutcome) {
      alert('Please select an override criticality level.');
      return;
    }

    setIsSaving(true);
    try {
      const mergedData = {
        ...(moduleInstance.data ?? {}),
        computed: {
          overall: computedSummary.overall,
          criticalCount: computedSummary.criticalCount,
          highCount: computedSummary.highCount,
          moderateCount: computedSummary.moderateCount,
          flagCount: computedSummary.flags.length,
        },
        override: {
          enabled: overrideEnabled,
          outcome: overrideEnabled ? overrideOutcome : null,
          reason: overrideEnabled ? overrideReason.trim() : null,
        },
        conclusion: {
          overallExplosionRiskPosition,
          principalConcerns,
          controlAdequacy,
          residualRiskCommentary,
          operationalObservations,
          recommendationsSummary,
          limitationsAndAssumptions,
        },
      };

      const payload = sanitizeModuleInstancePayload(
        {
          data: mergedData,
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
      alert('Failed to save. Please try again.');
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
          <span className="ml-3 text-neutral-600">Computing explosion risk summary…</span>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Shield className="w-6 h-6 text-neutral-700" />
          <h2 className="text-2xl font-bold text-neutral-900">
            DSEAR-12 — Explosion Risk Summary &amp; Professional Conclusion
          </h2>
        </div>
        <p className="text-neutral-600 text-sm">
          Synthesises the cross-module criticality assessment and captures the
          assessor's professional conclusion on the explosion risk position.
        </p>
        {lastSaved && (
          <div className="flex items-center gap-2 mt-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" />
            Last saved at {lastSaved}
          </div>
        )}
      </div>

      {/* ── 1. Computed Criticality Summary ─────────────────────────────── */}
      <CollapsibleCard
        title="Computed Explosion Criticality"
        description="Auto-derived from DSEAR modules 1–11 via the criticality engine"
      >
        {/* Overall band */}
        <div
          className={`flex items-start gap-3 p-4 rounded-lg border mb-4 ${getCriticalityStyles(
            computedSummary.overall
          )}`}
        >
          {getCriticalityIcon(computedSummary.overall)}
          <div>
            <p className="font-bold text-sm">
              Overall computed criticality: {computedSummary.overall}
            </p>
            <p className="text-xs mt-0.5">
              {computedSummary.overall === 'Critical' &&
                'Compliance-critical deficiencies identified — urgent corrective action required.'}
              {computedSummary.overall === 'High' &&
                'Significant explosion safety issues — prompt remediation required.'}
              {computedSummary.overall === 'Moderate' &&
                'Areas for improvement identified — explosion risk controls should be strengthened.'}
              {computedSummary.overall === 'Low' &&
                'Explosion risk controls appear broadly appropriate within the scope assessed.'}
            </p>
          </div>
        </div>

        {/* Counts */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-red-700">{computedSummary.criticalCount}</div>
            <div className="text-xs text-red-600">Critical flags</div>
          </div>
          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-orange-700">{computedSummary.highCount}</div>
            <div className="text-xs text-orange-600">High flags</div>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
            <div className="text-2xl font-bold text-amber-700">{computedSummary.moderateCount}</div>
            <div className="text-xs text-amber-600">Moderate flags</div>
          </div>
        </div>

        {/* Flags detail */}
        {computedSummary.flags.length === 0 ? (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <span className="text-sm text-green-800 font-medium">
              No compliance flags identified by the criticality engine.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-neutral-700">
              Identified compliance flags ({computedSummary.flags.length})
            </p>
            {computedSummary.flags.map((flag) => (
              <div
                key={flag.id}
                className="p-3 rounded-lg border bg-neutral-50"
              >
                <div className="flex items-start gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded border uppercase shrink-0 ${getFlagLevelStyles(
                      flag.level
                    )}`}
                  >
                    {flag.level}
                  </span>
                  <span className="text-sm font-semibold text-neutral-900">{flag.title}</span>
                </div>
                <p className="text-xs text-neutral-600 ml-1 mt-1">{flag.detail}</p>
                {flag.relatedModules.length > 0 && (
                  <p className="text-xs text-neutral-400 mt-1">
                    Related modules: {flag.relatedModules.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* ── 2. Override ──────────────────────────────────────────────────── */}
      <CollapsibleCard
        title="Override Computed Criticality (Optional)"
        description="Use professional judgment to set a different criticality level — requires documented justification"
        defaultOpen={overrideEnabled}
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={overrideEnabled}
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
              Override computed criticality with professional judgment
            </span>
          </label>

          {overrideEnabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Override criticality level <span className="text-red-600">*</span>
                </label>
                <select
                  value={overrideOutcome}
                  onChange={(e) => setOverrideOutcome(e.target.value as ExplosionCriticality | '')}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                >
                  <option value="">Select criticality level…</option>
                  {CRITICALITY_OUTCOMES.map((opt) => (
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
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Provide a clear, professionally defensible justification. Examples: compensating controls in place not captured by automatic assessment; recent remedial works completed prior to assessment date; site-specific operational context reducing residual risk…"
                  rows={4}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  This justification will appear in the issued report alongside the
                  override notation.
                </p>
              </div>

              {overrideReason.trim() && overrideOutcome && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-800">
                    <strong>Note:</strong> The issued report will display{' '}
                    <strong>{overrideOutcome}</strong> as the authoritative
                    criticality level and will include a notation that the computed
                    result was overridden with the justification above.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Active override summary */}
          {overrideEnabled && overrideOutcome && (
            <div
              className={`flex items-center gap-3 p-3 rounded-lg border ${getCriticalityStyles(
                displayCriticality
              )}`}
            >
              {getCriticalityIcon(displayCriticality)}
              <div>
                <p className="font-semibold text-sm">
                  Authoritative criticality: {displayCriticality}
                </p>
                <p className="text-xs mt-0.5">
                  Computed was {computedSummary.overall} — overridden by assessor
                </p>
              </div>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {/* ── 3. Professional Conclusion ───────────────────────────────────── */}
      <CollapsibleCard
        title="Professional Conclusion"
        description="Structured assessor narrative for the issued report — complete all fields relevant to this assessment"
      >
        <div className="space-y-5">

          {/* Overall risk position */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Overall explosion risk position
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Summarise the overall explosion risk position of the site, taking into
              account the substances present, hazardous area classification and the
              adequacy of protective measures.
            </p>
            <textarea
              value={overallExplosionRiskPosition}
              onChange={(e) => setOverallExplosionRiskPosition(e.target.value)}
              placeholder="The assessed premises presents an overall explosion risk position of… The principal hazards arise from… Having regard to the controls identified during the assessment, the residual risk is considered to be…"
              rows={5}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Principal concerns */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Principal concerns
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Identify the most significant explosion-related concerns identified
              during this assessment. Reference specific findings where applicable.
            </p>
            <textarea
              value={principalConcerns}
              onChange={(e) => setPrincipalConcerns(e.target.value)}
              placeholder="The principal concerns identified during this assessment are: 1. … 2. … 3. … These concerns are reflected in the action register at the corresponding priority levels."
              rows={5}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Control adequacy */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Control adequacy assessment
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Provide a professional opinion on the overall adequacy of explosion
              prevention and protection controls, including ATEX equipment selection,
              ignition source control, and emergency response arrangements.
            </p>
            <textarea
              value={controlAdequacy}
              onChange={(e) => setControlAdequacy(e.target.value)}
              placeholder="The explosion prevention and protection controls in place at the time of assessment are considered to be… ATEX equipment selection is… Ignition source controls are… Emergency response arrangements are…"
              rows={5}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Residual risk */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Residual risk commentary
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Assess the residual explosion risk remaining after existing controls are
              taken into account. This should reflect the criticality level above.
            </p>
            <textarea
              value={residualRiskCommentary}
              onChange={(e) => setResidualRiskCommentary(e.target.value)}
              placeholder="Taking into account the controls identified, the residual explosion risk is assessed as… This assessment is subject to the limitations and assumptions set out below. Implementation of the recommended actions would reduce the residual risk to…"
              rows={4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Operational observations */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Operational observations
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Record any operational or management context that is material to the
              explosion risk position — site management practices, maintenance
              standards, training, operational discipline, etc.
            </p>
            <textarea
              value={operationalObservations}
              onChange={(e) => setOperationalObservations(e.target.value)}
              placeholder="The site is operated by… Maintenance and inspection of ATEX equipment is managed through… Permit-to-work arrangements are… Operator competency in DSEAR requirements appears…"
              rows={4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Recommendations summary */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Recommendations summary
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Provide a high-level narrative summary of the recommendations arising
              from this assessment. The detailed action register is separate — this
              field provides the executive-level framing.
            </p>
            <textarea
              value={recommendationsSummary}
              onChange={(e) => setRecommendationsSummary(e.target.value)}
              placeholder="The recommendations arising from this assessment are directed principally at… Priority actions address… Upon implementation of the priority recommendations, the explosion risk position would be expected to improve to…"
              rows={4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>

          {/* Limitations */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-1">
              Limitations and assumptions
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Document the specific limitations and assumptions applicable to this
              module's conclusions. These supplement any limitations recorded at
              document level.
            </p>
            <textarea
              value={limitationsAndAssumptions}
              onChange={(e) => setLimitationsAndAssumptions(e.target.value)}
              placeholder="This conclusion is based on information available at the time of assessment and is subject to the following limitations: … The following assumptions have been made: … Areas not inspected or outside scope: …"
              rows={4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none text-sm"
            />
          </div>
        </div>
      </CollapsibleCard>

      {/* ── Authoritative outcome summary bar ───────────────────────────── */}
      <div
        className={`flex items-center gap-3 p-4 rounded-lg border font-medium text-sm ${getCriticalityStyles(
          displayCriticality
        )}`}
      >
        {getCriticalityIcon(displayCriticality)}
        <div>
          <span className="font-bold">Authoritative criticality for this report: </span>
          {displayCriticality}
          {overrideEnabled && overrideOutcome && (
            <span className="ml-2 text-xs font-normal opacity-75">
              (assessor override — computed was {computedSummary.overall})
            </span>
          )}
        </div>
      </div>

      {/* ── Save button ──────────────────────────────────────────────────── */}
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
          {isSaving ? 'Saving…' : 'Save Explosion Risk Summary & Professional Conclusion'}
        </button>
      </div>
    </div>
  );
}
