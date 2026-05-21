import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, Info, ShieldCheck, Lock, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { isDocumentLocked } from '../../../utils/documentLock';
import AutoExpandTextarea from '../../AutoExpandTextarea';
import OutcomePanel from '../OutcomePanel';
import ModuleActions from '../ModuleActions';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import {
  DSEAR_IGNITION_SECTION_KEY,
  DSEAR_IGNITION_SECTION_LABEL,
  DSEAR_IGNITION_SOURCE_DEFINITIONS,
  type DsearIgnitionControlAdequacy,
  type DsearIgnitionPresence,
  type DsearIgnitionSourceAssessment,
  type DsearIgnitionSourceDefinition,
  normaliseDsearIgnitionAssessments,
} from '../../../lib/dsear/ignitionSourceCards';

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, unknown>;
}

interface Document {
  id: string;
  title: string;
  issue_status?: 'draft' | 'issued' | 'superseded';
}

interface Props {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

const PRESENCE_OPTIONS: Array<{ value: DsearIgnitionPresence; label: string }> = [
  { value: '', label: 'Select...' },
  { value: 'present', label: 'Present' },
  { value: 'not_present', label: 'Not present' },
  { value: 'unknown', label: 'Unknown' },
];

const CONTROL_OPTIONS: Array<{ value: DsearIgnitionControlAdequacy; label: string }> = [
  { value: '', label: 'Select...' },
  { value: 'adequate', label: 'Adequately controlled' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'significant_issue', label: 'Significant issue / recommendation required' },
  { value: 'critical', label: 'Critical / urgent' },
  { value: 'unknown', label: 'Unknown' },
];

const presenceLabel = (value?: DsearIgnitionPresence): string => (
  PRESENCE_OPTIONS.find((option) => option.value === value)?.label || 'Not assessed'
);

const controlLabel = (value?: DsearIgnitionControlAdequacy): string => (
  CONTROL_OPTIONS.find((option) => option.value === value)?.label || 'Control adequacy not assessed'
);

function getCardState(assessment: DsearIgnitionSourceAssessment) {
  if (assessment.control_adequacy === 'critical') {
    return {
      badge: 'Critical / urgent',
      classes: 'border-red-300 bg-red-50/70',
      header: 'text-red-950',
      pill: 'border-red-300 bg-red-100 text-red-800',
    };
  }

  if (assessment.control_adequacy === 'significant_issue') {
    return {
      badge: 'Recommendation required',
      classes: 'border-orange-300 bg-orange-50/70',
      header: 'text-orange-950',
      pill: 'border-orange-300 bg-orange-100 text-orange-800',
    };
  }

  if (assessment.control_adequacy === 'needs_review' || assessment.control_adequacy === 'unknown' || assessment.presence === 'unknown') {
    return {
      badge: 'Needs review',
      classes: 'border-amber-300 bg-amber-50/70',
      header: 'text-amber-950',
      pill: 'border-amber-300 bg-amber-100 text-amber-800',
    };
  }

  if (assessment.control_adequacy === 'adequate' && assessment.presence === 'present') {
    return {
      badge: 'Adequately controlled',
      classes: 'border-green-300 bg-green-50/70',
      header: 'text-green-950',
      pill: 'border-green-300 bg-green-100 text-green-800',
    };
  }

  return {
    badge: 'Not assessed',
    classes: 'border-neutral-200 bg-white',
    header: 'text-neutral-900',
    pill: 'border-neutral-200 bg-neutral-50 text-neutral-700',
  };
}

function hasAssessmentContent(assessment: DsearIgnitionSourceAssessment): boolean {
  return Boolean(
    assessment.presence ||
    assessment.control_adequacy ||
    assessment.observation?.trim() ||
    assessment.finding?.trim() ||
    assessment.legacy_evidence_reference?.trim()
  );
}

function isIncompleteRequired(source: DsearIgnitionSourceDefinition, assessment: DsearIgnitionSourceAssessment): boolean {
  return source.isCore && (!assessment.presence || (assessment.presence === 'present' && !assessment.control_adequacy));
}


function dataString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function mapLegacySelectedSources(assessments: Record<string, DsearIgnitionSourceAssessment>): string[] {
  return DSEAR_IGNITION_SOURCE_DEFINITIONS.flatMap((source) => {
    if (assessments[source.sourceKey]?.presence !== 'present') return [];
    return source.legacyKeys || [];
  });
}

function getAtexRequired(assessment: Record<string, DsearIgnitionSourceAssessment>, current: string): string {
  const electrical = assessment.electrical_equipment;
  if (electrical?.presence === 'present') return current || 'yes';
  if (electrical?.presence === 'not_present') return current || 'no';
  return current || '';
}

function getAtexPresent(assessment: Record<string, DsearIgnitionSourceAssessment>, current: string): string {
  const adequacy = assessment.electrical_equipment?.control_adequacy;
  if (adequacy === 'adequate') return 'yes';
  if (adequacy === 'needs_review') return current || 'partial';
  if (adequacy === 'significant_issue' || adequacy === 'critical') return current || 'no';
  if (adequacy === 'unknown') return 'unknown';
  return current || '';
}

function getHotWorkControls(assessment: Record<string, DsearIgnitionSourceAssessment>, current: string): string {
  const adequacy = assessment.hot_work?.control_adequacy;
  if (adequacy === 'adequate') return 'yes';
  if (adequacy === 'significant_issue' || adequacy === 'critical') return 'no';
  if (adequacy === 'unknown') return 'unknown';
  return current || '';
}

export default function DSEAR4IgnitionSourcesForm({
  moduleInstance,
  document,
  onSaved,
}: Props) {
  const isLocked = isDocumentLocked(document.issue_status);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showOtherSources, setShowOtherSources] = useState(false);

  const [sourceAssessments, setSourceAssessments] = useState<Record<string, DsearIgnitionSourceAssessment>>(
    () => normaliseDsearIgnitionAssessments(moduleInstance.data || {})
  );

  const [outcome, setOutcome] = useState(moduleInstance.outcome || '');
  const [assessorNotes, setAssessorNotes] = useState(moduleInstance.assessor_notes || '');

  const visibleSources = useMemo(() => {
    return DSEAR_IGNITION_SOURCE_DEFINITIONS.filter((source) => {
      const assessment = sourceAssessments[source.sourceKey] || {};
      return assessment.presence === 'present' || hasAssessmentContent(assessment) || isIncompleteRequired(source, assessment);
    });
  }, [sourceAssessments]);

  const otherSources = useMemo(() => (
    DSEAR_IGNITION_SOURCE_DEFINITIONS.filter((source) => !visibleSources.some((visible) => visible.sourceKey === source.sourceKey))
  ), [visibleSources]);

  const updateSourceAssessment = (sourceKey: string, patch: Partial<DsearIgnitionSourceAssessment>) => {
    setSourceAssessments((current) => ({
      ...current,
      [sourceKey]: {
        ...current[sourceKey],
        ...patch,
      },
    }));
  };

  const getSuggestedOutcome = () => {
    const values = Object.values(sourceAssessments);
    if (values.some((assessment) => assessment.control_adequacy === 'critical' || assessment.control_adequacy === 'significant_issue')) {
      return 'material_def';
    }

    if (values.some((assessment) => assessment.presence === 'unknown' || assessment.control_adequacy === 'unknown')) {
      return 'info_gap';
    }

    return 'compliant';
  };

  const handleSave = async () => {
    if (isLocked) return;
    setIsSaving(true);
    try {
      const payload = sanitizeModuleInstancePayload({
        data: {
          ...moduleInstance.data,
          dsear_ignition_source_assessments: sourceAssessments,
          ignition_sources_assessed: mapLegacySelectedSources(sourceAssessments),
          ATEX_equipment_required: getAtexRequired(sourceAssessments, dataString(moduleInstance.data, 'ATEX_equipment_required')),
          ATEX_equipment_present: getAtexPresent(sourceAssessments, dataString(moduleInstance.data, 'ATEX_equipment_present')),
          static_control_measures: sourceAssessments.static_electricity?.observation || dataString(moduleInstance.data, 'static_control_measures'),
          hot_work_controls: getHotWorkControls(sourceAssessments, dataString(moduleInstance.data, 'hot_work_controls')),
          inspection_testing_regime: sourceAssessments.electrical_equipment?.observation || dataString(moduleInstance.data, 'inspection_testing_regime'),
        },
        outcome,
        assessor_notes: assessorNotes,
        updated_at: new Date().toISOString(),
      });

      const { error } = await supabase
        .from('module_instances')
        .update(payload)
        .eq('id', moduleInstance.id);

      if (error) throw error;

      const now = new Date().toLocaleTimeString();
      setLastSaved(now);
      setSaveError(null);
      onSaved();
    } catch (error) {
      console.error('Error saving module:', error);
      setSaveError('Failed to save. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderIgnitionCard = (source: DsearIgnitionSourceDefinition) => {
    const assessment = sourceAssessments[source.sourceKey] || {};
    const state = getCardState(assessment);
    const needsRecommendation = assessment.control_adequacy === 'significant_issue' || assessment.control_adequacy === 'critical';

    return (
      <section key={source.sourceKey} className={`rounded-2xl border p-5 shadow-sm ${state.classes}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`text-lg font-bold ${state.header}`}>{source.sourceLabel}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${state.pill}`}>{state.badge}</span>
            </div>
            <p className="mt-1 text-sm text-neutral-600">{source.riskImplication}</p>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
            {source.category}
          </span>
        </div>

        {source.fraOverlap && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-900">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>This ignition source may also be relevant to the FRA hazards section. Add a separate recommendation only where the issue is DSEAR-specific.</p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-2">Present / not present / unknown</label>
            <select
              value={assessment.presence || ''}
              onChange={(event) => updateSourceAssessment(source.sourceKey, { presence: event.target.value as DsearIgnitionPresence })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              {PRESENCE_OPTIONS.map((option) => <option key={option.value || 'blank'} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-2">Control adequacy</label>
            <select
              value={assessment.control_adequacy || ''}
              onChange={(event) => updateSourceAssessment(source.sourceKey, { control_adequacy: event.target.value as DsearIgnitionControlAdequacy })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              {CONTROL_OPTIONS.map((option) => <option key={option.value || 'blank'} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-2">Observation</label>
            <AutoExpandTextarea
              value={assessment.observation || ''}
              onChange={(event) => updateSourceAssessment(source.sourceKey, { observation: event.target.value })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="Controls observed, uncertainty, inspection basis or assessor note..."
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-2">Finding</label>
            <AutoExpandTextarea
              value={assessment.finding || ''}
              onChange={(event) => updateSourceAssessment(source.sourceKey, { finding: event.target.value })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="Record deficiency or leave blank where controls are adequate."
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-200 bg-white/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-800">Evidence</p>
              <p className="mt-1 text-sm text-neutral-500">Use the Add evidence workflow below; linked recommendation cards show evidence counts.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium text-neutral-600">
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">{presenceLabel(assessment.presence)}</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">{controlLabel(assessment.control_adequacy)}</span>
            </div>
          </div>

          {assessment.legacy_evidence_reference?.trim() && (
            <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-amber-800">Advanced / legacy evidence reference</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{assessment.legacy_evidence_reference}</p>
            </details>
          )}
        </div>

        {needsRecommendation && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>Control adequacy indicates an ignition source issue. Add a DSEAR-specific recommendation or link an existing one if already covered elsewhere.</p>
          </div>
        )}

        <ModuleActions
          documentId={document.id}
          moduleInstanceId={moduleInstance.id}
          buttonLabel="Add recommendation"
          sectionKey={DSEAR_IGNITION_SECTION_KEY}
          sectionLabel={DSEAR_IGNITION_SECTION_LABEL}
          sourceKey={source.sourceKey}
          sourceLabel={source.sourceLabel}
          defaultCategory={source.category}
          compact
        />
      </section>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {isLocked && (
        <div className="mb-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg flex items-start gap-3">
          <Lock className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900">Issued — Read Only</p>
            <p className="text-sm text-blue-800 mt-1">This document has been issued and cannot be edited.</p>
          </div>
        </div>
      )}
      {saveError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start justify-between gap-3">
          <p className="text-sm text-red-900">{saveError}</p>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">DSEAR-4 - Ignition Source Control</h2>
        <p className="text-neutral-600">Assess ignition source presence, control adequacy, evidence and section-owned recommendations using the same card workflow as FRA hazards.</p>
        {lastSaved && (
          <div className="flex items-center gap-2 mt-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" />
            Last saved at {lastSaved}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-700" />
          <div>
            <h3 className="font-semibold text-blue-950">Ignition-source review</h3>
            <p className="mt-1 text-sm text-blue-900">Default view shows present/selected sources and incomplete core ignition checks. Expand other ignition sources only when relevant.</p>
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-5">
        {visibleSources.map(renderIgnitionCard)}

        {otherSources.length > 0 && (
          <details open={showOtherSources} onToggle={(event) => setShowOtherSources(event.currentTarget.open)} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-neutral-900">Other ignition sources</h3>
                <p className="text-sm text-neutral-600">Expand if additional DSEAR ignition-source areas are relevant to this assessment.</p>
              </div>
              <ChevronDown className={`h-5 w-5 text-neutral-500 transition-transform ${showOtherSources ? 'rotate-180' : ''}`} />
            </summary>
            <div className="mt-4 space-y-5">
              {otherSources.map(renderIgnitionCard)}
            </div>
          </details>
        )}
      </div>

      <OutcomePanel
        outcome={outcome}
        assessorNotes={assessorNotes}
        onOutcomeChange={setOutcome}
        onNotesChange={setAssessorNotes}
        onSave={handleSave}
        isSaving={isSaving}
        suggestedOutcome={getSuggestedOutcome()}
      />
    </div>
  );
}
