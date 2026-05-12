import { useMemo, useState } from 'react';
import { AlertTriangle, Shield, CheckCircle, Plus } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import OutcomePanel from '../OutcomePanel';
import ModuleActions from '../ModuleActions';
import AddActionModal from '../../actions/AddActionModal';
import DetailedFindingActionLink from '../../actions/DetailedFindingActionLink';
import InfoGapQuickActions from '../InfoGapQuickActions';
import { detectInfoGaps } from '../../../utils/infoGapQuickActions';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { getActionsRefreshKey } from '../../../utils/actionsRefreshKey';

interface Document {
  id: string;
  title: string;
}

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, unknown>;
}

interface A4ManagementControlsFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface QuickActionTemplate {
  action: string;
  likelihood: number;
  impact: number;
}

type AssessmentStatus = 'adequate' | 'inadequate' | 'unknown' | 'not_applicable';
type RiskSignificance = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

interface ManagementAssessmentDetail {
  status: AssessmentStatus;
  observations: string;
  existing_controls: string;
  deficiencies: string;
  assessor_commentary: string;
  risk_significance: RiskSignificance;
  evidence_references: string;
  action_trigger: boolean;
  linked_action_reference: string;
}

interface ManagementAssessmentAreaConfig {
  key: string;
  title: string;
  guidance: string;
}


interface ManagementFormDataState {
  responsibilities_defined: string;
  fire_safety_policy_exists: string;
  training_induction_provided: string;
  training_refresher_frequency: string;
  fire_warden_marshal_provision: string;
  contractor_induction: string;
  contractor_supervision: string;
  ptw_hot_work: string;
  ptw_electrical_isolation_loto: string;
  ptw_confined_space: string;
  ptw_other_permits: string;
  inspection_extinguishers_annual_service: string;
  inspection_fire_doors_frequency: string;
  inspection_records_available: string;
  housekeeping_waste_control: string;
  housekeeping_storage_control: string;
  housekeeping_combustible_accumulation_risk: string;
  change_management_process_exists: string;
  change_management_review_triggers_defined: string;
  management_notes: string;
  ptw_hot_work_fire_watch_required: boolean | null;
  ptw_hot_work_post_watch_mins: number | null;
  ptw_hot_work_comments: string;
  fire_safety_management_assessments: Record<string, ManagementAssessmentDetail>;
}

const managementAssessmentAreas: ManagementAssessmentAreaConfig[] = [
  { key: 'fire_safety_policy_arrangements', title: 'Fire safety policy and arrangements', guidance: 'Written policy, arrangements, accountabilities, communication and proportionality to premises risk.' },
  { key: 'responsible_person_duty_holder', title: 'Responsible person / duty holder arrangements', guidance: 'Identification of the responsible person/duty holder, delegated competent persons and authority to implement controls.' },
  { key: 'staff_training_awareness', title: 'Staff training and fire awareness', guidance: 'Induction, refresher, role-specific training, temporary staff and training effectiveness.' },
  { key: 'fire_drills_evacuation_testing', title: 'Fire drills and evacuation testing', guidance: 'Drill frequency, scenario coverage, lessons learned, evacuation timing and records.' },
  { key: 'emergency_procedures', title: 'Emergency procedures', guidance: 'Emergency plan content, staff roles, alarm response, assembly, liaison and out-of-hours arrangements.' },
  { key: 'maintenance_inspection_regimes', title: 'Maintenance and inspection regimes', guidance: 'Planned inspection/testing of fire precautions, defect reporting, escalation and competent servicing.' },
  { key: 'contractor_control_ptw', title: 'Contractor control / permit-to-work systems', guidance: 'Contractor induction, supervision, risk assessment, permits and interface with site fire controls.' },
  { key: 'hot_work_management', title: 'Hot work management', guidance: 'Permit authorisation, isolation, combustible clearance, fire watch, post-work checks and contractor controls.' },
  { key: 'housekeeping_waste_management', title: 'Housekeeping and waste management', guidance: 'Combustible storage, waste removal, bins/skips, escape route checks and local housekeeping accountability.' },
  { key: 'testing_record_keeping', title: 'Testing and record keeping', guidance: 'Availability, currency and review of alarm, emergency lighting, firefighting equipment and drill records.' },
  { key: 'peeps_vulnerable_persons', title: 'PEEPs / vulnerable persons management', guidance: 'Identification, review and implementation of PEEPs or other assisted evacuation arrangements.' },
  { key: 'communication_coordination', title: 'Communication and coordination', guidance: 'Multi-occupied premises coordination, tenant communication, shift handover and cooperation with other employers.' },
  { key: 'management_review_continuous_improvement', title: 'Management review / continuous improvement', guidance: 'Review triggers, audits, incident learning, action tracking and management oversight.' },
  { key: 'occupancy_control_supervision', title: 'Occupancy control and supervision', guidance: 'Control of occupant numbers, public events, staff supervision, opening/closing checks and high-risk periods.' },
  { key: 'other_management_concerns', title: 'Other fire safety management concerns', guidance: 'Any additional fire safety management matter requiring assessor judgement.' },
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

const toCamelAssessment = (assessment: ManagementAssessmentDetail) => ({
  status: assessment.status,
  observations: assessment.observations,
  existingControls: assessment.existing_controls,
  deficiencies: assessment.deficiencies,
  assessorCommentary: assessment.assessor_commentary,
  riskSignificance: assessment.risk_significance,
  evidenceReferences: assessment.evidence_references,
  actionTrigger: assessment.action_trigger,
  linkedActionReference: assessment.linked_action_reference,
});

const buildInitialManagementAssessments = (data: Record<string, unknown>): Record<string, ManagementAssessmentDetail> => {
  const rawSource = data.fire_safety_management_assessments || data.fireSafetyManagementAssessments;
  const source = isRecord(rawSource) ? rawSource : {};

  return managementAssessmentAreas.reduce<Record<string, ManagementAssessmentDetail>>((acc, area) => {
    const existing = isRecord(source[area.key]) ? source[area.key] as Record<string, unknown> : {};
    acc[area.key] = {
      status: normaliseStatus(existing.status),
      observations: asString(existing.observations),
      existing_controls: asString(existing.existing_controls || existing.existingControls),
      deficiencies: asString(existing.deficiencies),
      assessor_commentary: asString(existing.assessor_commentary || existing.assessorCommentary),
      risk_significance: normaliseRiskSignificance(existing.risk_significance || existing.riskSignificance),
      evidence_references: asString(existing.evidence_references || existing.evidenceReferences),
      action_trigger: Boolean(existing.action_trigger || existing.actionTrigger),
      linked_action_reference: asString(existing.linked_action_reference || existing.linkedActionReference),
    };
    return acc;
  }, {});
};

const hasManagementAssessmentContent = (assessment: ManagementAssessmentDetail): boolean =>
  assessment.status !== 'unknown' ||
  assessment.observations.trim() !== '' ||
  assessment.existing_controls.trim() !== '' ||
  assessment.deficiencies.trim() !== '' ||
  assessment.assessor_commentary.trim() !== '' ||
  assessment.risk_significance !== 'unknown' ||
  assessment.evidence_references.trim() !== '' ||
  assessment.action_trigger ||
  assessment.linked_action_reference.trim() !== '';

const buildSaveData = (existingData: Record<string, unknown>, formData: ManagementFormDataState): Record<string, unknown> => ({
  ...existingData,
  ...formData,
  // Maintain older aliases consumed by reports and recommendations.
  fire_safety_policy: formData.fire_safety_policy_exists,
  training_induction: formData.training_induction_provided,
  training_refresher: formData.training_refresher_frequency,
  testing_records: formData.inspection_records_available,
  housekeeping_rating: existingData.housekeeping_rating || formData.housekeeping_combustible_accumulation_risk,
  change_management_exists: formData.change_management_process_exists,
  fireSafetyManagementAssessments: Object.fromEntries(
    Object.entries(formData.fire_safety_management_assessments).map(([key, assessment]) => [key, toCamelAssessment(assessment as ManagementAssessmentDetail)])
  ),
});

export default function A4ManagementControlsForm({
  moduleInstance,
  document,
  onSaved,
}: A4ManagementControlsFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [quickActionTemplate, setQuickActionTemplate] = useState<QuickActionTemplate | null>(null);
  const actionsRefreshKey = getActionsRefreshKey(document.id, moduleInstance.id);

  const [formData, setFormData] = useState<ManagementFormDataState>({
    responsibilities_defined: asString(moduleInstance.data.responsibilities_defined) || 'unknown',
    fire_safety_policy_exists: asString(moduleInstance.data.fire_safety_policy_exists) || 'unknown',
    training_induction_provided: asString(moduleInstance.data.training_induction_provided) || 'unknown',
    training_refresher_frequency: asString(moduleInstance.data.training_refresher_frequency) || 'none',
    fire_warden_marshal_provision: asString(moduleInstance.data.fire_warden_marshal_provision) || 'unknown',
    contractor_induction: asString(moduleInstance.data.contractor_induction) || 'unknown',
    contractor_supervision: asString(moduleInstance.data.contractor_supervision) || 'unknown',
    ptw_hot_work: asString(moduleInstance.data.ptw_hot_work) || 'unknown',
    ptw_electrical_isolation_loto: asString(moduleInstance.data.ptw_electrical_isolation_loto) || 'unknown',
    ptw_confined_space: asString(moduleInstance.data.ptw_confined_space) || 'unknown',
    ptw_other_permits: asString(moduleInstance.data.ptw_other_permits) || '',
    inspection_extinguishers_annual_service: asString(moduleInstance.data.inspection_extinguishers_annual_service) || 'unknown',
    inspection_fire_doors_frequency: asString(moduleInstance.data.inspection_fire_doors_frequency) || 'unknown',
    inspection_records_available: asString(moduleInstance.data.inspection_records_available) || 'unknown',
    housekeeping_waste_control: asString(moduleInstance.data.housekeeping_waste_control) || 'unknown',
    housekeeping_storage_control: asString(moduleInstance.data.housekeeping_storage_control) || 'unknown',
    housekeeping_combustible_accumulation_risk: asString(moduleInstance.data.housekeeping_combustible_accumulation_risk) || 'unknown',
    change_management_process_exists: asString(moduleInstance.data.change_management_process_exists) || 'unknown',
    change_management_review_triggers_defined: asString(moduleInstance.data.change_management_review_triggers_defined) || 'unknown',
    management_notes: asString(moduleInstance.data.management_notes) || '',
    ptw_hot_work_fire_watch_required: typeof moduleInstance.data.ptw_hot_work_fire_watch_required === 'boolean' ? moduleInstance.data.ptw_hot_work_fire_watch_required : null,
    ptw_hot_work_post_watch_mins: typeof moduleInstance.data.ptw_hot_work_post_watch_mins === 'number' ? moduleInstance.data.ptw_hot_work_post_watch_mins : null,
    ptw_hot_work_comments: asString(moduleInstance.data.ptw_hot_work_comments) || '',
    fire_safety_management_assessments: buildInitialManagementAssessments(moduleInstance.data),
  });

  const [outcome, setOutcome] = useState(moduleInstance.outcome || '');
  const [assessorNotes, setAssessorNotes] = useState(moduleInstance.assessor_notes || '');

  const updateManagementAssessment = (areaKey: string, patch: Partial<ManagementAssessmentDetail>) => {
    setFormData((current) => ({
      ...current,
      fire_safety_management_assessments: {
        ...current.fire_safety_management_assessments,
        [areaKey]: {
          ...current.fire_safety_management_assessments[areaKey],
          ...patch,
        },
      },
    }));
  };

  const detailedManagementAssessments = Object.values(formData.fire_safety_management_assessments).filter(hasManagementAssessmentContent);

  const qualityWarnings = useMemo(() => {
    const assessments = formData.fire_safety_management_assessments;
    const commentaryMissing = (key: string) => !(assessments[key]?.assessor_commentary || '').trim();
    const controlsMissing = (key: string) => !(assessments[key]?.existing_controls || '').trim();
    const evidenceMissing = (key: string) => !(assessments[key]?.evidence_references || '').trim();
    const actionMissing = (key: string) => !(assessments[key]?.linked_action_reference || '').trim() && !assessments[key]?.action_trigger;
    const narrativeMissing = (key: string) => commentaryMissing(key) && !(assessments[key]?.observations || '').trim() && !(assessments[key]?.deficiencies || '').trim();
    const warnings: string[] = [];

    if ((formData.training_induction_provided === 'no' || assessments.staff_training_awareness?.status === 'inadequate') && commentaryMissing('staff_training_awareness')) {
      warnings.push('Training deficiencies are recorded without assessor commentary.');
    }
    if (assessments.fire_drills_evacuation_testing?.status === 'inadequate' && commentaryMissing('fire_drills_evacuation_testing')) {
      warnings.push('Missing or inadequate fire drills are recorded without rationale.');
    }
    if ((formData.contractor_supervision === 'no' || assessments.contractor_control_ptw?.status === 'inadequate') && controlsMissing('contractor_control_ptw')) {
      warnings.push('Contractor control risks are recorded without existing controls described.');
    }
    if ((formData.ptw_hot_work === 'no' || assessments.hot_work_management?.status === 'inadequate') && controlsMissing('hot_work_management')) {
      warnings.push('Hot work management risks are recorded without controls described.');
    }
    if ((formData.housekeeping_combustible_accumulation_risk === 'yes' || assessments.housekeeping_waste_management?.status === 'inadequate') && evidenceMissing('housekeeping_waste_management') && actionMissing('housekeeping_waste_management')) {
      warnings.push('Poor housekeeping is recorded without evidence/photo references or an action link.');
    }
    if ((formData.inspection_records_available === 'no' || assessments.maintenance_inspection_regimes?.status === 'inadequate' || assessments.testing_record_keeping?.status === 'inadequate') && commentaryMissing('maintenance_inspection_regimes') && commentaryMissing('testing_record_keeping')) {
      warnings.push('Missing maintenance/testing arrangements are recorded without commentary.');
    }
    if (assessments.peeps_vulnerable_persons?.status === 'inadequate' && narrativeMissing('peeps_vulnerable_persons')) {
      warnings.push('Vulnerable persons / PEEP management concerns are recorded without narrative.');
    }
    if ((formData.fire_safety_policy_exists === 'no' || formData.responsibilities_defined === 'no' || assessments.fire_safety_policy_arrangements?.status === 'inadequate') && actionMissing('fire_safety_policy_arrangements')) {
      warnings.push('Absent management arrangements are recorded without a recommendation/action reference.');
    }
    if (detailedManagementAssessments.some((assessment) => assessment.status === 'unknown') && !formData.management_notes.trim()) {
      warnings.push('Unknown management controls are recorded without a limitation statement in management notes.');
    }

    return warnings;
  }, [formData, detailedManagementAssessments]);

  const getSuggestedOutcome = (): { outcome: string; reason: string } | null => {
    const unknowns = Object.entries(formData).filter(
      ([key, value]) => value === 'unknown' && !key.includes('notes') && !key.includes('other') && key !== 'fire_safety_management_assessments'
    ).length;

    if (unknowns >= 5) {
      return {
        outcome: 'info_gap',
        reason: `${unknowns} items marked as unknown - significant information gaps identified`,
      };
    }

    const criticalIssues = [];

    if (formData.fire_safety_policy_exists === 'no') {
      criticalIssues.push('No fire safety policy');
    }
    if (formData.training_induction_provided === 'no') {
      criticalIssues.push('No staff induction');
    }
    if (formData.ptw_hot_work === 'no' && formData.contractor_supervision === 'no') {
      criticalIssues.push('No hot work permit system with contractor works');
    }
    if (detailedManagementAssessments.some((assessment) => assessment.risk_significance === 'high' || assessment.risk_significance === 'critical')) {
      criticalIssues.push('High-significance detailed management finding');
    }

    if (criticalIssues.length >= 2) {
      return {
        outcome: 'material_def',
        reason: `Multiple material deficiencies: ${criticalIssues.join(', ')}`,
      };
    }

    if (unknowns >= 3 || criticalIssues.length === 1) {
      return {
        outcome: 'minor_def',
        reason: unknowns >= 3
          ? 'Some information gaps remain'
          : criticalIssues[0],
      };
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

  const handleQuickAction = (template: QuickActionTemplate) => {
    setQuickActionTemplate(template);
    setShowActionModal(true);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-neutral-700" />
          <h2 className="text-2xl font-bold text-neutral-900">
            A4 - Management Systems & Controls
          </h2>
        </div>
        <p className="text-neutral-600">
          Assess the adequacy of management arrangements for fire safety. Detailed consultancy-grade areas are optional and collapsed by default.
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
            Based on your responses: <strong>{suggestedOutcome.outcome.replace('_', ' ')}</strong>
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
          <p className="mt-2 text-xs text-orange-700">These prompts do not block saving or issue.</p>
        </div>
      )}

      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Responsibilities & Policy
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire safety responsibilities clearly defined?
              </label>
              <select
                value={formData.responsibilities_defined}
                onChange={(e) =>
                  setFormData({ ...formData, responsibilities_defined: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - fully documented</option>
                <option value="partial">Partial - some gaps</option>
                <option value="no">No - not defined</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                If unknown → set outcome to info_gap and raise an action
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Written fire safety policy exists?
              </label>
              <select
                value={formData.fire_safety_policy_exists}
                onChange={(e) =>
                  setFormData({ ...formData, fire_safety_policy_exists: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {formData.fire_safety_policy_exists === 'no' && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Develop and implement a written fire safety policy statement, communicate to all staff, and display in prominent locations',
                    likelihood: 4,
                    impact: 3,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Implement fire safety policy
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Training & Competence
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire safety induction provided to staff?
              </label>
              <select
                value={formData.training_induction_provided}
                onChange={(e) =>
                  setFormData({ ...formData, training_induction_provided: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - comprehensive</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire safety refresher training frequency
              </label>
              <select
                value={formData.training_refresher_frequency}
                onChange={(e) =>
                  setFormData({ ...formData, training_refresher_frequency: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="none">None / Ad-hoc</option>
                <option value="annual">Annual</option>
                <option value="6-monthly">6-monthly</option>
                <option value="other">Other (specify in notes)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire wardens/marshals provision
              </label>
              <select
                value={formData.fire_warden_marshal_provision}
                onChange={(e) =>
                  setFormData({ ...formData, fire_warden_marshal_provision: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate - trained and appointed</option>
                <option value="inadequate">Inadequate - insufficient coverage</option>
              </select>
            </div>

            {(formData.training_induction_provided === 'no' ||
              formData.training_refresher_frequency === 'none' ||
              formData.fire_warden_marshal_provision === 'inadequate') && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Develop and implement comprehensive fire safety training programme including staff induction, refresher training schedule, and fire warden appointments with training matrix',
                    likelihood: 4,
                    impact: 4,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Formalise training programme
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Contractor Control
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Contractor fire safety induction?
              </label>
              <select
                value={formData.contractor_induction}
                onChange={(e) =>
                  setFormData({ ...formData, contractor_induction: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - formal process</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Contractor supervision adequate?
              </label>
              <select
                value={formData.contractor_supervision}
                onChange={(e) =>
                  setFormData({ ...formData, contractor_supervision: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Permit to Work Systems
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Hot work permit system in place?
              </label>
              <select
                value={formData.ptw_hot_work}
                onChange={(e) =>
                  setFormData({ ...formData, ptw_hot_work: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - formal system</option>
                <option value="no">No</option>
              </select>
            </div>

            {formData.ptw_hot_work === 'no' && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Implement hot work permit to work system including risk assessment, fire watch requirements, and post-work inspection procedures',
                    likelihood: 5,
                    impact: 4,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Implement hot work permit system
              </button>
            )}

            {formData.ptw_hot_work === 'yes' && (
              <div className="mt-4 pt-4 border-t border-neutral-200 space-y-4">
                <p className="text-sm font-medium text-neutral-700">Hot work permit detail</p>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Fire watch during hot work required?
                  </label>
                  <select
                    value={formData.ptw_hot_work_fire_watch_required === null ? '' : formData.ptw_hot_work_fire_watch_required ? 'yes' : 'no'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        ptw_hot_work_fire_watch_required: e.target.value === '' ? null : e.target.value === 'yes',
                      })
                    }
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  >
                    <option value="">Not stated</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Post-work fire watch duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={formData.ptw_hot_work_post_watch_mins || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        ptw_hot_work_post_watch_mins: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="e.g., 60"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Hot work permit comments
                  </label>
                  <textarea
                    value={formData.ptw_hot_work_comments}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        ptw_hot_work_comments: e.target.value,
                      })
                    }
                    placeholder="Details about permit system, procedures, supervision..."
                    rows={2}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Electrical isolation/LOTO procedures?
              </label>
              <select
                value={formData.ptw_electrical_isolation_loto}
                onChange={(e) =>
                  setFormData({ ...formData, ptw_electrical_isolation_loto: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Confined space entry procedures?
              </label>
              <select
                value={formData.ptw_confined_space}
                onChange={(e) =>
                  setFormData({ ...formData, ptw_confined_space: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="na">N/A - no confined spaces</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Other permit systems (optional)
              </label>
              <input
                type="text"
                value={formData.ptw_other_permits}
                onChange={(e) =>
                  setFormData({ ...formData, ptw_other_permits: e.target.value })
                }
                placeholder="e.g., roof work, excavation"
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Inspection & Testing Regime
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire extinguishers annual service?
              </label>
              <select
                value={formData.inspection_extinguishers_annual_service}
                onChange={(e) =>
                  setFormData({ ...formData, inspection_extinguishers_annual_service: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - up to date</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Fire door inspection frequency
              </label>
              <select
                value={formData.inspection_fire_doors_frequency}
                onChange={(e) =>
                  setFormData({ ...formData, inspection_fire_doors_frequency: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="none">None - no formal inspections</option>
                <option value="6-monthly">6-monthly</option>
                <option value="annual">Annual</option>
                <option value="other">Other (specify in notes)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Testing/inspection records available?
              </label>
              <select
                value={formData.inspection_records_available}
                onChange={(e) =>
                  setFormData({ ...formData, inspection_records_available: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - comprehensive</option>
                <option value="partial">Partial records only</option>
                <option value="no">No records</option>
              </select>
            </div>

            {(formData.inspection_fire_doors_frequency === 'none' ||
              formData.inspection_records_available === 'no') && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Maintain fire safety logbook and inspection records by implementing a structured record system for inspections, tests, servicing, and remedial actions. Technical adequacy and deficiencies of individual systems are assessed in the relevant technical sections.',
                    likelihood: 4,
                    impact: 3,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Maintain fire safety records
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Housekeeping & General Fire Safety
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Waste control and disposal
              </label>
              <select
                value={formData.housekeeping_waste_control}
                onChange={(e) =>
                  setFormData({ ...formData, housekeeping_waste_control: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate</option>
                <option value="inadequate">Inadequate</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Storage arrangements
              </label>
              <select
                value={formData.housekeeping_storage_control}
                onChange={(e) =>
                  setFormData({ ...formData, housekeeping_storage_control: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="adequate">Adequate - controlled</option>
                <option value="inadequate">Inadequate - obstructions present</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Combustible material accumulation risk
              </label>
              <select
                value={formData.housekeeping_combustible_accumulation_risk}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    housekeeping_combustible_accumulation_risk: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            {(formData.housekeeping_waste_control === 'inadequate' ||
              formData.housekeeping_storage_control === 'inadequate' ||
              formData.housekeeping_combustible_accumulation_risk === 'high') && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Improve housekeeping standards including waste management procedures, storage controls, and removal of combustible material accumulations. Establish routine housekeeping inspections.',
                    likelihood: 4,
                    impact: 3,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Improve housekeeping controls
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Change Management
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Change management process exists?
              </label>
              <select
                value={formData.change_management_process_exists}
                onChange={(e) =>
                  setFormData({ ...formData, change_management_process_exists: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - formal process</option>
                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Review triggers defined? (occupancy change, alterations, etc.)
              </label>
              <select
                value={formData.change_management_review_triggers_defined}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    change_management_review_triggers_defined: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - documented</option>
                <option value="no">No</option>
              </select>
            </div>

            {(formData.change_management_process_exists === 'no' ||
              formData.change_management_review_triggers_defined === 'no') && (
              <button
                onClick={() =>
                  handleQuickAction({
                    action: 'Introduce change management process to review fire risk assessment when significant changes occur (occupancy, layout, materials, processes). Document review triggers and responsibilities.',
                    likelihood: 3,
                    impact: 3,
                  })
                }
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Quick Add: Introduce change control review process
              </button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-2">Detailed Fire Safety Management Assessment Areas</h3>
          <p className="text-sm text-neutral-600 mb-4">
            Optional professional-judgement prompts. Keep sections collapsed unless extra narrative, evidence, or action linkage is useful.
          </p>
          <div className="space-y-3">
            {managementAssessmentAreas.map((area) => {
              const assessment = formData.fire_safety_management_assessments[area.key];
              const hasContent = hasManagementAssessmentContent(assessment);
              return (
                <details key={area.key} className="border border-neutral-200 rounded-lg overflow-hidden bg-neutral-50">
                  <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-900">
                    <span>{area.title}</span>
                    {hasContent && <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">Populated</span>}
                  </summary>
                  <div className="border-t border-neutral-200 bg-white p-4 space-y-4">
                    <p className="text-xs text-neutral-500">{area.guidance}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">Adequacy</label>
                        <select value={assessment.status} onChange={(e) => updateManagementAssessment(area.key, { status: e.target.value as AssessmentStatus })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                          <option value="unknown">Unknown</option>
                          <option value="adequate">Adequate</option>
                          <option value="inadequate">Inadequate</option>
                          <option value="not_applicable">Not applicable</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">Risk significance</label>
                        <select value={assessment.risk_significance} onChange={(e) => updateManagementAssessment(area.key, { risk_significance: e.target.value as RiskSignificance })} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent">
                          <option value="unknown">Unknown / not assessed</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <textarea value={assessment.observations} onChange={(e) => updateManagementAssessment(area.key, { observations: e.target.value })} placeholder="Observations" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.existing_controls} onChange={(e) => updateManagementAssessment(area.key, { existing_controls: e.target.value })} placeholder="Existing controls" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.deficiencies} onChange={(e) => updateManagementAssessment(area.key, { deficiencies: e.target.value })} placeholder="Deficiencies identified" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                      <textarea value={assessment.assessor_commentary} onChange={(e) => updateManagementAssessment(area.key, { assessor_commentary: e.target.value })} placeholder="Assessor commentary / rationale" rows={3} className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <input value={assessment.evidence_references} onChange={(e) => updateManagementAssessment(area.key, { evidence_references: e.target.value })} placeholder="Evidence/photo references (e.g. E-004, photo 21)" className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
                      <input value={assessment.linked_action_reference} onChange={(e) => updateManagementAssessment(area.key, { linked_action_reference: e.target.value })} placeholder="Legacy linked action reference (fallback only)" className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" checked={assessment.action_trigger} onChange={(e) => updateManagementAssessment(area.key, { action_trigger: e.target.checked })} className="rounded border-neutral-300" />
                      Action trigger / consider adding this to the action register
                    </label>
                    <DetailedFindingActionLink
                      documentId={document.id}
                      moduleInstanceId={moduleInstance.id}
                      moduleKey={moduleInstance.module_key}
                      sourceAssessmentType="fire_safety_management_assessments"
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
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Additional Management Notes
          </h3>
          <textarea
            value={formData.management_notes}
            onChange={(e) =>
              setFormData({ ...formData, management_notes: e.target.value })
            }
            placeholder="Add any additional observations about management systems, controls, or specific issues identified..."
            rows={4}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
          />
        </div>
      </div>

      <OutcomePanel
        outcome={outcome}
        assessorNotes={assessorNotes}
        onOutcomeChange={setOutcome}
        onNotesChange={setAssessorNotes}
        onSave={handleSave}
        isSaving={isSaving}
        moduleKey={moduleInstance.module_key}
      />

      {(() => {
        const infoGapDetection = detectInfoGaps(moduleInstance.module_key, formData, outcome);
        return infoGapDetection.hasInfoGap ? (
          <div className="mt-6">
            <InfoGapQuickActions
              detection={infoGapDetection}
              moduleKey={moduleInstance.module_key}
              onCreateAction={(actionText, defaultL, defaultI) => {
                setQuickActionTemplate({
                  action: actionText,
                  likelihood: defaultL,
                  impact: defaultI,
                });
                setShowActionModal(true);
              }}
              showCreateButtons={true}
            />
          </div>
        ) : null;
      })()}

      {document?.id && moduleInstance?.id && (


        <ModuleActions
        key={actionsRefreshKey}
        documentId={document.id}
        moduleInstanceId={moduleInstance.id}
      />


      )}

      {showActionModal && (
        <AddActionModal
          documentId={document.id}
          moduleInstanceId={moduleInstance.id}
          sourceModuleKey={moduleInstance.module_key}
          onClose={() => {
            setShowActionModal(false);
            setQuickActionTemplate(null);
          }}
          onActionCreated={() => {
            setShowActionModal(false);
            setQuickActionTemplate(null);
          }}
          defaultAction={quickActionTemplate?.action}
          defaultLikelihood={quickActionTemplate?.likelihood}
          defaultImpact={quickActionTemplate?.impact}
        />
      )}
    </div>
  );
}
