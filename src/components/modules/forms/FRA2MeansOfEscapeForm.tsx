import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, DoorOpen } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import OutcomePanel from '../OutcomePanel';
import ModuleActions from '../ModuleActions';
import DetailedFindingActionLink from '../../actions/DetailedFindingActionLink';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { getUnifiedOutcomeLabel } from '../../../lib/modules/moduleCatalog';
import { getActionsRefreshKey } from '../../../utils/actionsRefreshKey';

type AssessmentStatus = 'adequate' | 'inadequate' | 'unknown' | 'not_applicable';
type RiskSignificance = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

interface Document {
  id: string;
  title: string;
  jurisdiction?: string;
}

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, unknown>;
}

interface FRA2MeansOfEscapeFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface EscapeAssessmentDetail {
  status: AssessmentStatus;
  observations: string;
  deficiencies: string;
  existing_controls: string;
  assessor_commentary: string;
  risk_significance: RiskSignificance;
  evidence_references: string;
  action_trigger: boolean;
  linked_action_reference: string;
}

type FormDataState = {
  escape_strategy_current: string;
  escape_routes_description: string;
  travel_distances_compliant: string;
  final_exits_adequate: string;
  escape_route_obstructions: string;
  stair_protection_status: string;
  inner_rooms_present: string;
  basement_present: string;
  exit_signage_adequacy: string;
  disabled_egress_arrangements: string;
  notes: string;
  means_of_escape_assessments: Record<string, EscapeAssessmentDetail>;
};

interface AssessmentAreaConfig {
  key: string;
  title: string;
  guidance: string;
}

const assessmentAreas: AssessmentAreaConfig[] = [
  { key: 'escape_route_adequacy', title: 'Escape route adequacy', guidance: 'Route number, width, distribution, protection and suitability for the occupancy.' },
  { key: 'travel_distances', title: 'Travel distances', guidance: 'Measured or estimated single-direction and alternative-direction travel distance rationale.' },
  { key: 'dead_ends_inner_rooms', title: 'Dead ends / inner rooms', guidance: 'Dead-end corridors, inner rooms, vision panels, warning arrangements and alternative escape.' },
  { key: 'final_exits', title: 'Final exits', guidance: 'Exit capacity, direction of opening, availability, discharge safety and external conditions.' },
  { key: 'staircases_vertical_escape', title: 'Staircases and vertical escape', guidance: 'Protected stairs, lobbies, smoke control, refuges and vertical evacuation assumptions.' },
  { key: 'doors_fastenings_security', title: 'Doors / fastenings / security', guidance: 'Ease of opening, panic hardware, access-control fail-safe behaviour and security conflicts.' },
  { key: 'exit_signage', title: 'Exit signage', guidance: 'Location, visibility, consistency, illumination and directional decision points.' },
  { key: 'emergency_lighting_interface', title: 'Emergency lighting interface', guidance: 'Interface with escape routes, stairs, changes of level, external routes and final exits.' },
  { key: 'occupant_capacity_vulnerable_occupants', title: 'Occupant capacity / vulnerable occupants', guidance: 'Occupant load, mobility constraints, PEEPs, assisted evacuation and staffing dependency.' },
  { key: 'housekeeping_obstruction', title: 'Housekeeping / obstruction', guidance: 'Storage, waste, temporary works, furniture and routine checks for route availability.' },
  { key: 'management_escape_routes', title: 'Management of escape routes', guidance: 'Inspection routines, defect reporting, opening checks, contractor control and accountability.' },
  { key: 'assembly_external_routes', title: 'Assembly / external escape routes', guidance: 'Assembly-point suitability, external lighting, weather exposure and routes away from the building.' },
];

const normaliseStatus = (value: unknown): AssessmentStatus => {
  if (value === 'adequate' || value === 'inadequate' || value === 'unknown' || value === 'not_applicable') return value;
  if (value === 'na' || value === 'n/a') return 'not_applicable';
  return 'unknown';
};

const normaliseRiskSignificance = (value: unknown): RiskSignificance => {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical' || value === 'unknown') return value;
  return 'unknown';
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const toCamelAssessment = (assessment: EscapeAssessmentDetail) => ({
  status: assessment.status,
  observations: assessment.observations,
  deficiencies: assessment.deficiencies,
  existingControls: assessment.existing_controls,
  assessorCommentary: assessment.assessor_commentary,
  riskSignificance: assessment.risk_significance,
  evidenceReferences: assessment.evidence_references,
  actionTrigger: assessment.action_trigger,
  linkedActionReference: assessment.linked_action_reference,
});

const buildSaveData = (existingData: Record<string, unknown>, formData: FormDataState): Record<string, unknown> => ({
  ...existingData,
  ...formData,
  // Maintain legacy aliases that older PDF/report consumers may still read.
  escape_strategy: formData.escape_strategy_current,
  routes_description: formData.escape_routes_description,
  signage_adequacy: formData.exit_signage_adequacy,
  disabled_egress_adequacy: formData.disabled_egress_arrangements,
  meansOfEscapeAssessments: Object.fromEntries(
    Object.entries(formData.means_of_escape_assessments).map(([key, assessment]) => [key, toCamelAssessment(assessment)])
  ),
});

const buildInitialAssessments = (data: Record<string, unknown>): Record<string, EscapeAssessmentDetail> => {
  const rawSource = data.means_of_escape_assessments || data.meansOfEscapeAssessments;
  const source = isRecord(rawSource) ? rawSource : {};

  return assessmentAreas.reduce<Record<string, EscapeAssessmentDetail>>((acc, area) => {
    const rawExisting = source[area.key];
    const existing = isRecord(rawExisting) ? rawExisting : {};
    acc[area.key] = {
      status: normaliseStatus(existing.status),
      observations: asString(existing.observations),
      deficiencies: asString(existing.deficiencies),
      existing_controls: asString(existing.existing_controls || existing.existingControls),
      assessor_commentary: asString(existing.assessor_commentary || existing.assessorCommentary),
      risk_significance: normaliseRiskSignificance(existing.risk_significance || existing.riskSignificance),
      evidence_references: asString(existing.evidence_references || existing.evidenceReferences),
      action_trigger: Boolean(existing.action_trigger || existing.actionTrigger),
      linked_action_reference: asString(existing.linked_action_reference || existing.linkedActionReference),
    };
    return acc;
  }, {});
};

const hasAssessmentContent = (assessment: EscapeAssessmentDetail): boolean =>
  assessment.status !== 'unknown' ||
  assessment.observations.trim() !== '' ||
  assessment.deficiencies.trim() !== '' ||
  assessment.existing_controls.trim() !== '' ||
  assessment.assessor_commentary.trim() !== '' ||
  assessment.risk_significance !== 'unknown' ||
  assessment.evidence_references.trim() !== '' ||
  assessment.action_trigger ||
  assessment.linked_action_reference.trim() !== '';

export default function FRA2MeansOfEscapeForm({
  moduleInstance,
  document,
  onSaved,
}: FRA2MeansOfEscapeFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const actionsRefreshKey = getActionsRefreshKey(document.id, moduleInstance.id);

  const [formData, setFormData] = useState({
    escape_strategy_current: asString(moduleInstance.data.escape_strategy_current || moduleInstance.data.escape_strategy) || 'unknown',
    escape_routes_description: asString(moduleInstance.data.escape_routes_description || moduleInstance.data.routes_description),
    travel_distances_compliant: asString(moduleInstance.data.travel_distances_compliant) || 'unknown',
    final_exits_adequate: asString(moduleInstance.data.final_exits_adequate) || 'unknown',
    escape_route_obstructions: asString(moduleInstance.data.escape_route_obstructions) || 'unknown',
    stair_protection_status: asString(moduleInstance.data.stair_protection_status) || 'unknown',
    inner_rooms_present: asString(moduleInstance.data.inner_rooms_present) || 'unknown',
    basement_present: asString(moduleInstance.data.basement_present) || 'unknown',
    exit_signage_adequacy: asString(moduleInstance.data.exit_signage_adequacy || moduleInstance.data.signage_adequacy) || 'unknown',
    disabled_egress_arrangements: asString(moduleInstance.data.disabled_egress_arrangements || moduleInstance.data.disabled_egress_adequacy) || 'unknown',
    notes: asString(moduleInstance.data.notes),
    means_of_escape_assessments: buildInitialAssessments(moduleInstance.data),
  });

  const [outcome, setOutcome] = useState(moduleInstance.outcome || '');
  const [assessorNotes, setAssessorNotes] = useState(moduleInstance.assessor_notes || '');

  const updateAssessment = (areaKey: string, patch: Partial<EscapeAssessmentDetail>) => {
    setFormData((current) => ({
      ...current,
      means_of_escape_assessments: {
        ...current.means_of_escape_assessments,
        [areaKey]: {
          ...current.means_of_escape_assessments[areaKey],
          ...patch,
        },
      },
    }));
  };

  const detailedAssessments = Object.values(formData.means_of_escape_assessments).filter(hasAssessmentContent);

  const qualityWarnings = useMemo(() => {
    const assessments = formData.means_of_escape_assessments;
    const commentaryMissing = (key: string) => !(assessments[key]?.assessor_commentary || '').trim();
    const evidenceMissing = (key: string) => !(assessments[key]?.evidence_references || '').trim();
    const actionMissing = (key: string) =>
      !(assessments[key]?.linked_action_reference || '').trim() &&
      !assessments[key]?.action_trigger;
    const actionOrExplanationMissing = (key: string) =>
      actionMissing(key) &&
      !(assessments[key]?.assessor_commentary || '').trim() &&
      !(assessments[key]?.deficiencies || '').trim();
    const warnings: string[] = [];

    if (assessments.escape_route_adequacy?.status === 'inadequate' && commentaryMissing('escape_route_adequacy')) {
      warnings.push('Inadequate escape routes are selected without assessor commentary.');
    }
    if (assessments.escape_route_adequacy?.status === 'inadequate' && evidenceMissing('escape_route_adequacy') && actionMissing('escape_route_adequacy')) {
      warnings.push('Escape route inadequacy is recorded without evidence references or an action/recommendation link.');
    }
    if ((assessments.travel_distances?.status === 'inadequate' || formData.travel_distances_compliant === 'no') && commentaryMissing('travel_distances')) {
      warnings.push('Excessive travel distances are selected without rationale.');
    }
    if ((assessments.travel_distances?.status === 'unknown' || formData.travel_distances_compliant === 'unknown') && detailedAssessments.length > 0 && commentaryMissing('travel_distances')) {
      warnings.push('Unknown travel distances are recorded without rationale.');
    }
    if ((assessments.dead_ends_inner_rooms?.status === 'inadequate' || formData.inner_rooms_present === 'yes') && commentaryMissing('dead_ends_inner_rooms')) {
      warnings.push('Dead ends or inner rooms are flagged without commentary.');
    }
    if ((formData.escape_route_obstructions === 'yes' || assessments.housekeeping_obstruction?.status === 'inadequate') && actionOrExplanationMissing('housekeeping_obstruction')) {
      warnings.push('Blocked escape routes are recorded without linked action or explanation.');
    }
    if ((assessments.final_exits?.status === 'inadequate' || assessments.doors_fastenings_security?.status === 'inadequate' || formData.final_exits_adequate === 'no') &&
      actionOrExplanationMissing('final_exits') && actionOrExplanationMissing('doors_fastenings_security')) {
      warnings.push('Blocked, secured or inadequate exits are recorded without action or explanation.');
    }
    if ((assessments.occupant_capacity_vulnerable_occupants?.status === 'inadequate' || formData.disabled_egress_arrangements === 'inadequate') && commentaryMissing('occupant_capacity_vulnerable_occupants')) {
      warnings.push('Vulnerable occupant or PEEP dependency is selected without management commentary.');
    }
    if ((assessments.staircases_vertical_escape?.status === 'inadequate' || formData.stair_protection_status === 'inadequate') && commentaryMissing('staircases_vertical_escape')) {
      warnings.push('Staircase or vertical escape protection concerns are recorded without narrative.');
    }

    return warnings;
  }, [formData, detailedAssessments.length]);

  const getSuggestedOutcome = (): { outcome: string; reason: string } | null => {
    const unknowns = Object.entries(formData).filter(
      ([key, value]) => value === 'unknown' && !key.includes('notes') && !key.includes('description')
    ).length;

    if (unknowns >= 4) {
      return { outcome: 'info_gap', reason: `${unknowns} broad items marked as unknown - significant information gaps` };
    }

    const criticalIssues = [];
    if (formData.stair_protection_status === 'inadequate') criticalIssues.push('Inadequate stair protection');
    if (formData.final_exits_adequate === 'no') criticalIssues.push('Inadequate final exits');
    if (formData.travel_distances_compliant === 'no') criticalIssues.push('Non-compliant travel distances');
    if (detailedAssessments.some((assessment) => assessment.risk_significance === 'critical' || assessment.risk_significance === 'high')) {
      criticalIssues.push('High-significance detailed escape assessment');
    }

    if (criticalIssues.length > 0) {
      return { outcome: 'material_def', reason: `Material deficiencies identified: ${criticalIssues.join(', ')}` };
    }

    const minorIssues = [
      formData.escape_route_obstructions === 'yes' && 'Escape route obstructions',
      formData.exit_signage_adequacy === 'inadequate' && 'Inadequate signage',
      formData.disabled_egress_arrangements === 'inadequate' && 'Inadequate disabled egress',
      detailedAssessments.some((assessment) => assessment.status === 'inadequate') && 'Detailed escape assessment deficiency',
    ].filter(Boolean);

    if (minorIssues.length > 0 || unknowns >= 2) {
      return { outcome: 'minor_def', reason: minorIssues.length > 0 ? minorIssues.join(', ') : 'Some information gaps remain' };
    }

    return null;
  };

  const suggestedOutcome = getSuggestedOutcome();

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const payload = sanitizeModuleInstancePayload({
        data: buildSaveData(moduleInstance.data, formData),
        outcome,
        assessor_notes: assessorNotes,
        updated_at: new Date().toISOString(),
      }, moduleInstance.module_key);

      console.log('[FRA2 Save] Payload being sent to Supabase:', {
        moduleKey: moduleInstance.module_key,
        outcome: payload.outcome,
        originalOutcome: outcome,
      });

      const { error } = await supabase
        .from('module_instances')
        .update(payload)
        .eq('id', moduleInstance.id);

      if (error) throw error;

      setLastSaved(new Date().toLocaleTimeString());
      onSaved();
    } catch (error) {
      console.error('Error saving module:', error);
      alert('Failed to save module. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <DoorOpen className="w-6 h-6 text-neutral-700" />
          <h2 className="text-2xl font-bold text-neutral-900">FRA-2 - Means of Escape</h2>
        </div>
        <p className="text-neutral-600">
          Assess adequacy of escape routes, travel distances, and egress arrangements. Detailed consultancy-grade areas are optional and collapsed by default.
        </p>
        {lastSaved && (
          <div className="flex items-center gap-2 mt-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" />
            Last saved at {lastSaved}
          </div>
        )}
      </div>

      {suggestedOutcome && !outcome && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="text-sm font-bold text-amber-900 mb-1">Suggested Outcome</h3>
          <p className="text-sm text-amber-800">
            Based on your responses: <strong>{getUnifiedOutcomeLabel(suggestedOutcome.outcome)}</strong>
          </p>
          <p className="text-xs text-amber-700 mt-1">{suggestedOutcome.reason}</p>
        </div>
      )}

      {qualityWarnings.length > 0 && (
        <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2 text-orange-900">
            <AlertTriangle className="w-4 h-4" />
            <h3 className="text-sm font-bold">Advisory quality prompts</h3>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-orange-800">
            {qualityWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
          <p className="mt-2 text-xs text-orange-700">These prompts do not block saving.</p>
        </div>
      )}

      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">Broad Means of Escape Fields</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Current escape strategy</label>
              <select value={formData.escape_strategy_current} onChange={(e) => setFormData({ ...formData, escape_strategy_current: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="simultaneous">Simultaneous evacuation</option>
                <option value="phased">Phased evacuation</option>
                <option value="stay_put">Stay put (defend in place)</option>
                <option value="progressive_horizontal">Progressive horizontal evacuation</option>
                <option value="other">Other (specify in notes)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Travel distances compliant?</label>
              <select value={formData.travel_distances_compliant} onChange={(e) => setFormData({ ...formData, travel_distances_compliant: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown - not verified</option>
                <option value="yes">Yes - compliant</option>
                <option value="no">No - excessive travel distances</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Final exits adequate?</label>
              <select value={formData.final_exits_adequate} onChange={(e) => setFormData({ ...formData, final_exits_adequate: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - adequate</option>
                <option value="no">No - inadequate capacity or availability</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Escape route obstructions present?</label>
              <select value={formData.escape_route_obstructions} onChange={(e) => setFormData({ ...formData, escape_route_obstructions: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - obstructions present</option>
                <option value="no">No - clear routes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Stair protection status</label>
              <select value={formData.stair_protection_status} onChange={(e) => setFormData({ ...formData, stair_protection_status: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate - protected stairs/lobbies</option>
                <option value="inadequate">Inadequate - unprotected or compromised</option>
                <option value="na">N/A - single storey</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Inner rooms present?</label>
              <select value={formData.inner_rooms_present} onChange={(e) => setFormData({ ...formData, inner_rooms_present: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - inner rooms present</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Basement present?</label>
              <select value={formData.basement_present} onChange={(e) => setFormData({ ...formData, basement_present: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Exit signage adequacy</label>
              <select value={formData.exit_signage_adequacy} onChange={(e) => setFormData({ ...formData, exit_signage_adequacy: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate</option>
                <option value="inadequate">Inadequate</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Assisted evacuation physical provisions</label>
              <select value={formData.disabled_egress_arrangements} onChange={(e) => setFormData({ ...formData, disabled_egress_arrangements: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate</option>
                <option value="inadequate">Inadequate</option>
                <option value="na">N/A - ground floor only / no vulnerable occupants</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-2">Escape routes description</label>
              <textarea value={formData.escape_routes_description} onChange={(e) => setFormData({ ...formData, escape_routes_description: e.target.value })} placeholder="Describe the escape route configuration..." rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
            </div>
          </div>

        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-2">Means of escape recommendation ownership areas</h3>
          <p className="text-sm text-neutral-600 mb-4">
            Use these areas for evidence and recommendations relating to travel distances, final exits, stair protection, emergency lighting interfaces and other escape route findings.
          </p>
          <div className="space-y-3">
            {assessmentAreas.map((area) => {
              const assessment = formData.means_of_escape_assessments[area.key];
              return (
                <details key={area.key} className="rounded-lg border border-neutral-200 bg-neutral-50">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-900 flex justify-between">
                    <span>{area.title}</span>
                    {hasAssessmentContent(assessment) && <span className="text-xs font-medium text-blue-700">populated</span>}
                  </summary>
                  <div className="border-t border-neutral-200 bg-white p-4 space-y-4">
                    <p className="text-xs text-neutral-500">{area.guidance}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">Assessment status</label>
                        <select value={assessment.status} onChange={(e) => updateAssessment(area.key, { status: e.target.value as AssessmentStatus })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                          <option value="unknown">Unknown</option>
                          <option value="adequate">Adequate</option>
                          <option value="inadequate">Inadequate</option>
                          <option value="not_applicable">Not applicable</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">Risk significance</label>
                        <select value={assessment.risk_significance} onChange={(e) => updateAssessment(area.key, { risk_significance: e.target.value as RiskSignificance })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                          <option value="unknown">Unknown / not assessed</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <textarea value={assessment.observations} onChange={(e) => updateAssessment(area.key, { observations: e.target.value })} placeholder="Observations" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.deficiencies} onChange={(e) => updateAssessment(area.key, { deficiencies: e.target.value })} placeholder="Deficiencies" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.existing_controls} onChange={(e) => updateAssessment(area.key, { existing_controls: e.target.value })} placeholder="Existing controls" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.assessor_commentary} onChange={(e) => updateAssessment(area.key, { assessor_commentary: e.target.value })} placeholder="Assessor commentary / rationale" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <input value={assessment.evidence_references} onChange={(e) => updateAssessment(area.key, { evidence_references: e.target.value })} placeholder="Evidence/photo references (e.g. E-003, photo 12)" className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
                      <input value={assessment.linked_action_reference} onChange={(e) => updateAssessment(area.key, { linked_action_reference: e.target.value })} placeholder="Legacy linked action reference (fallback only)" className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" checked={assessment.action_trigger} onChange={(e) => updateAssessment(area.key, { action_trigger: e.target.checked })} className="rounded border-neutral-300" />
                      Action trigger / consider adding this to the action register
                    </label>
                    <DetailedFindingActionLink
                      documentId={document.id}
                      moduleInstanceId={moduleInstance.id}
                      moduleKey={moduleInstance.module_key}
                      sourceAssessmentType="means_of_escape_assessments"
                      sourceAssessmentKey={area.key}
                      sourceAssessmentLabel={area.title}
                      assessment={assessment}
                      legacyLinkedActionReference={assessment.linked_action_reference}
                    />
                  </div>
                </details>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">Additional Means of Escape Notes</h3>
          <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Add any additional observations about means of escape, specific routes, travel distance calculations, or other relevant details..." rows={4} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
        </div>
      </div>

      <OutcomePanel moduleKey={moduleInstance.module_key} outcome={outcome} assessorNotes={assessorNotes} onOutcomeChange={setOutcome} onNotesChange={setAssessorNotes} onSave={handleSave} isSaving={isSaving} />

      {document?.id && moduleInstance?.id && (
        <ModuleActions key={actionsRefreshKey} documentId={document.id} moduleInstanceId={moduleInstance.id} />
      )}

    </div>
  );
}
