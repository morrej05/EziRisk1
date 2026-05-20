import { useState, useEffect } from 'react';
import { Flame, CheckCircle, Plus, Zap, ChevronDown, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { getUnifiedOutcomeLabel } from '../../../lib/modules/moduleCatalog';
import OutcomePanel from '../OutcomePanel';
import ModuleActions from '../ModuleActions';
import AddActionModal from '../../actions/AddActionModal';
import ModuleAreaRecommendationControls from '../ModuleAreaRecommendationControls';
import InfoGapQuickActions from '../InfoGapQuickActions';
import { detectInfoGaps } from '../../../utils/infoGapQuickActions';
import {
  getActiveIgnitionSourceCards,
  getEffectiveIgnitionPresence,
  getHazardMappingsForSource,
  hasCommercialKitchenContext,
} from '../../../lib/fra/ignitionSourceActivation';

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

interface FRA1FireHazardsFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface QuickActionTemplate {
  action: string;
  likelihood: number;
  impact: number;
  source?: 'manual' | 'info_gap' | 'recommendation' | 'system';
  sectionKey?: string;
  sectionLabel?: string;
  sourceKey?: string;
  sourceLabel?: string;
  defaultCategory?: string;
}

type IgnitionAssessment = {
  presence?: 'present' | 'not_present' | 'unknown' | '';
  condition_adequacy?: string;
  existing_controls?: string;
  deficiencies?: string;
  evidence_references?: string;
  assessor_commentary?: string;
  risk_significance?: 'low' | 'medium' | 'high' | 'unknown' | '';
  recommended_action_trigger?: 'none' | 'consider' | 'action_required' | 'urgent' | '';
  linked_action_reference?: string;
};

type IgnitionAssessmentMap = Record<string, IgnitionAssessment>;

type IgnitionSourceDefinition = {
  key: string;
  label: string;
  legacyIgnition?: string;
  legacyHighRisk?: string;
  prompt: string;
  actionText: string;
};

type ElectricalSafetyData = {
  eicr_last_date: string | null;
  eicr_interval_years: string;
  eicr_satisfactory: string;
  eicr_evidence_seen: string;
  eicr_outstanding_c1_c2: string;
  eicr_notes: string;
  pat_in_place: string;
};

type LightningData = {
  lightning_protection_present: string | null;
  lightning_risk_assessment_completed: string | null;
  assessment_date: string | null;
  notes: string;
};

type DuctCleaningData = {
  ducts_present: string | null;
  dust_grease_risk: string | null;
  cleaning_frequency: string | null;
  last_cleaned: string | null;
  notes: string;
};

type DsearScreenData = {
  flammables_present: string | null;
  explosive_atmospheres_possible: string | null;
  dsear_assessment_status: string | null;
  assessor: string | null;
  notes: string;
};

type FireHazardsFormData = {
  ignition_sources: string[];
  ignition_other: string;
  fuel_sources: string[];
  fuel_other: string;
  oxygen_enrichment: string;
  oxygen_sources_notes: string;
  high_risk_activities: string[];
  high_risk_other: string;
  arson_risk: string;
  housekeeping_fire_load: string;
  notes: string;
  electrical_safety: ElectricalSafetyData;
  lightning: LightningData;
  duct_cleaning: DuctCleaningData;
  dsear_screen: DsearScreenData;
  ignition_source_assessments: IgnitionAssessmentMap;
};

const IGNITION_SOURCE_AREAS: IgnitionSourceDefinition[] = [
  {
    key: 'electrical',
    label: 'Electrical ignition sources',
    legacyIgnition: 'electrical_equipment',
    prompt: 'Portable appliances, extension leads, temporary equipment and user-operated electrical equipment condition/controls. Fixed installation issues are assessed in the Fixed Wiring / EICR section.',
    actionText: 'Review and strengthen portable electrical equipment controls, including user checks, competent inspection where appropriate, safe use of extension leads and management of temporary equipment.',
  },
  {
    key: 'fixed_wiring_eicr',
    label: 'Fixed wiring / EICR',
    legacyIgnition: 'fixed_wiring_concerns',
    prompt: 'Fixed wiring concerns, EICR evidence, unsatisfactory reports, outstanding C1/C2 observations and remedial work status. Portable equipment is assessed under Electrical ignition sources.',
    actionText: 'Review fixed wiring and EICR controls, obtain current evidence where missing and ensure any unsatisfactory or C1/C2 observations are remediated by a competent electrical contractor.',
  },
  {
    key: 'portable_heaters',
    label: 'Portable heaters / temporary heating',
    legacyIgnition: 'portable_heaters',
    prompt: 'Temporary or supplementary heating, siting, guarding, fuel type and separation from combustibles.',
    actionText: 'Control portable or temporary heating by removing unsuitable heaters, maintaining safe separation from combustibles, prohibiting high-risk heater types where appropriate and briefing staff on permitted use.',
  },
  {
    key: 'smoking',
    label: 'Smoking and smoking controls',
    legacyIgnition: 'smoking',
    prompt: 'Smoking policy, designated areas, disposal arrangements, enforcement and proximity to combustible storage.',
    actionText: 'Strengthen smoking controls: designate smoking areas away from combustibles, provide suitable disposal bins, enforce no-smoking rules in high-risk areas and include controls in staff/contractor briefings.',
  },
  {
    key: 'cooking',
    label: 'Cooking / Kitchen Processes',
    legacyIgnition: 'cooking',
    legacyHighRisk: 'commercial_kitchens',
    prompt: 'Domestic or commercial cooking processes, equipment controls, supervision and safe shutdown arrangements.',
    actionText: 'Review cooking and kitchen fire controls, including supervision, safe isolation, extract/duct cleaning frequency, suppression arrangements, combustible separation and suitable firefighting provisions for the cooking process.',
  },
  {
    key: 'hot_works',
    label: 'Hot works',
    legacyHighRisk: 'hot_work',
    prompt: 'Hot work ignition exposure at the point of work: combustible clearance, local supervision, fire watch and post-work checks. Permit procedure is reviewed in Management Systems.',
    actionText: 'Review hot work fire exposure controls at the point of work, including confirmation of hot work presence, segregation from combustibles, ignition control, supervision/fire watch and post-work monitoring.',
  },
  {
    key: 'laundry',
    label: 'Laundry fire risk',
    legacyHighRisk: 'laundry_operations',
    prompt: 'Laundry operations, lint accumulation, dryer maintenance, isolation, ventilation and combustible storage near appliances.',
    actionText: 'Review laundry fire risk controls, including lint removal, dryer and duct maintenance, supervision, appliance isolation, ventilation and separation of laundry combustibles from heat sources.',
  },
  {
    key: 'plant_machinery',
    label: 'Plant, machinery and mechanical heat sources',
    legacyIgnition: 'plant_rooms',
    prompt: 'Plant rooms, motors, bearings, friction heat, boilers, process equipment and maintenance standards.',
    actionText: 'Improve controls for plant, machinery and mechanical heat sources through maintenance, guarding, housekeeping, inspection of overheating indicators and segregation from combustible storage.',
  },
  {
    key: 'lighting_high_temp',
    label: 'Lighting and high-temperature equipment',
    prompt: 'Luminaires, halogen/high-intensity lighting, heat lamps, process heaters and clearance from combustible materials.',
    actionText: 'Review lighting and high-temperature equipment controls, replacing unsuitable fittings, maintaining clearance from combustibles and verifying maintenance of high-temperature equipment.',
  },
  {
    key: 'arson',
    label: 'Arson / deliberate ignition',
    legacyIgnition: 'arson_ignition_points',
    prompt: 'External combustibles, waste security, unauthorised access, history of incidents, perimeter lighting and CCTV.',
    actionText: 'Improve arson prevention measures by securing waste and external combustibles, strengthening access control, lighting, CCTV or patrols and managing vulnerable perimeter areas.',
  },
  {
    key: 'battery_charging_lithium_ion',
    label: 'Battery charging / lithium-ion',
    legacyHighRisk: 'lithium_ion_charging',
    prompt: 'Battery charging locations, lithium-ion devices, charger suitability, supervision, separation from combustibles and escape routes, ventilation and detection.',
    actionText: 'Implement battery charging and lithium-ion controls with dedicated charging locations away from escape routes, separation from combustibles, suitable chargers, supervision/charging rules, ventilation and detection where appropriate.',
  },
  {
    key: 'lightning',
    label: 'Lightning exposure / protection',
    prompt: 'Lightning exposure, protection system, inspection/testing evidence and risk assessment status.',
    actionText: 'Verify lightning exposure and protection arrangements, including risk assessment status, inspection/test records and remediation of any identified defects.',
  },
  {
    key: 'hazardous_substances_dsear',
    label: 'Hazardous substances / DSEAR relevance',
    prompt: 'Flammable liquids/gases/dusts, explosive atmosphere potential, ignition control interfaces and DSEAR assessment relevance.',
    actionText: 'Review hazardous substances and DSEAR relevance, confirming dangerous substances present, whether explosive atmospheres could occur, and whether a suitable specialist assessment or controls are required.',
  },
  {
    key: 'high_risk_other',
    label: 'Other high-risk activity',
    legacyHighRisk: 'other',
    prompt: 'Free-text high-risk activity identified by the assessor. Record the activity, controls, evidence and whether a recommendation is required.',
    actionText: 'Assess and control the identified high-risk activity with proportionate fire safety controls, responsible ownership, evidence of implementation and a documented recommendation where deficiencies are present.',
  },
  {
    key: 'other',
    label: 'Other ignition sources',
    legacyIgnition: 'other',
    prompt: 'Any ignition sources not captured above, including site-specific process or operational factors.',
    actionText: 'Assess and control other identified ignition sources using proportionate controls, responsible ownership and a documented action plan where deficiencies are present.',
  },
];

const IGNITION_OPTIONS = [
  'smoking',
  'electrical_equipment',
  'fixed_wiring_concerns',
  'cooking',
  'portable_heaters',
  'plant_rooms',
  'arson_ignition_points',
  'other',
];


const createEmptySourceAssessments = (): IgnitionAssessmentMap =>
  IGNITION_SOURCE_AREAS.reduce((acc, source) => {
    acc[source.key] = {
      presence: '',
      condition_adequacy: '',
      existing_controls: '',
      deficiencies: '',
      evidence_references: '',
      assessor_commentary: '',
      risk_significance: '',
      recommended_action_trigger: '',
      linked_action_reference: '',
    };
    return acc;
  }, {} as IgnitionAssessmentMap);

const normaliseSourceAssessments = (data: Record<string, unknown>): IgnitionAssessmentMap => {
  const existing = (data.ignition_source_assessments || data.ignitionSourceAssessments || {}) as Record<string, IgnitionAssessment>;
  const defaults = createEmptySourceAssessments();

  return IGNITION_SOURCE_AREAS.reduce((acc, source) => {
    const value = existing?.[source.key] || {};
    acc[source.key] = {
      ...defaults[source.key],
      ...value,
    };
    return acc;
  }, {} as IgnitionAssessmentMap);
};

const sourceHasNarrativeDetail = (assessment?: IgnitionAssessment): boolean => {
  if (!assessment) return false;
  return ['condition_adequacy', 'existing_controls', 'deficiencies', 'assessor_commentary'].some((field) =>
    String(assessment[field as keyof IgnitionAssessment] ?? '').trim()
  );
};

const EICR_SECTION_KEY = 'fixed_wiring_eicr';
const EICR_SECTION_LABEL = 'Electrical Installation Safety (Fixed Wiring / EICR)';
const EICR_SOURCE_LABEL = 'Fixed Wiring / EICR';
const DSEAR_SCREENING_SECTION_KEY = 'dsear_screening';
const DSEAR_SCREENING_SECTION_LABEL = 'DSEAR Screening';

const FUEL_OPTIONS = [
  'waste_storage',
  'packaging_materials',
  'upholstered_furniture',
  'storage_racking',
  'flammable_liquids',
  'lpg_cylinders',
  'plant_rooms',
  'other',
];

const HIGH_RISK_ACTIVITIES = [
  'lithium_ion_charging',
  'laundry_operations',
  'contractor_works',
  'maintenance_activities',
  'hot_work',
  'other',
];

export default function FRA1FireHazardsForm({
  moduleInstance,
  document,
  onSaved,
}: FRA1FireHazardsFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [quickActionTemplate, setQuickActionTemplate] = useState<QuickActionTemplate | null>(null);
  const moduleData = moduleInstance.data || {};
  const getString = (key: string, fallback = ''): string =>
    typeof moduleData[key] === 'string' ? String(moduleData[key]) : fallback;
  const getStringArray = (key: string): string[] =>
    Array.isArray(moduleData[key]) ? (moduleData[key] as string[]) : [];
  const getObject = <T extends object>(key: string, fallback: T): T =>
    moduleData[key] && typeof moduleData[key] === 'object' && !Array.isArray(moduleData[key])
      ? { ...fallback, ...(moduleData[key] as Partial<T>) }
      : fallback;

  const [formData, setFormData] = useState<FireHazardsFormData>({
    ignition_sources: getStringArray('ignition_sources'),
    ignition_other: getString('ignition_other'),
    fuel_sources: getStringArray('fuel_sources'),
    fuel_other: getString('fuel_other'),
    oxygen_enrichment: getString('oxygen_enrichment', 'none'),
    oxygen_sources_notes: getString('oxygen_sources_notes'),
    high_risk_activities: getStringArray('high_risk_activities'),
    high_risk_other: getString('high_risk_other'),
    arson_risk: getString('arson_risk', 'unknown'),
    housekeeping_fire_load: getString('housekeeping_fire_load', 'unknown'),
    notes: getString('notes'),
    electrical_safety: getObject('electrical_safety', {
      eicr_last_date: null,
      eicr_interval_years: '',
      eicr_satisfactory: 'unknown',
      eicr_evidence_seen: 'no',
      eicr_outstanding_c1_c2: 'unknown',
      eicr_notes: '',
      pat_in_place: 'unknown',
    }),
    lightning: getObject('lightning', {
      lightning_protection_present: null,
      lightning_risk_assessment_completed: null,
      assessment_date: null,
      notes: '',
    }),
    duct_cleaning: getObject('duct_cleaning', {
      ducts_present: null,
      dust_grease_risk: null,
      cleaning_frequency: null,
      last_cleaned: null,
      notes: '',
    }),
    dsear_screen: getObject('dsear_screen', {
      flammables_present: null,
      explosive_atmospheres_possible: null,
      dsear_assessment_status: null,
      assessor: null,
      notes: '',
    }),
    ignition_source_assessments: normaliseSourceAssessments(moduleData),
  });

  const [outcome, setOutcome] = useState(moduleInstance.outcome || '');
  const [assessorNotes, setAssessorNotes] = useState(moduleInstance.assessor_notes || '');
  const [scoringData, setScoringData] = useState(moduleData.scoring || {});
  const [activeSection, setActiveSection] = useState('fra1-ignition');

  const NAV_SECTIONS = [
    { id: 'fra1-ignition', label: 'Ignition' },
    { id: 'fra1-fuel', label: 'Fuel' },
    { id: 'fra1-oxygen', label: 'Oxygen' },
    { id: 'fra1-activities', label: 'Activities' },
    { id: 'fra1-arson', label: 'Arson' },
    { id: 'fra1-source-cards', label: 'Source cards' },
    { id: 'fixed-wiring-eicr-section', label: 'EICR' },
    { id: 'fra1-lightning', label: 'Lightning' },
    { id: 'fra1-duct', label: 'Duct & extract' },
    { id: 'fra1-dsear', label: 'DSEAR' },
  ];

  useEffect(() => {
    const visible = new Set<string>();
    const ids = NAV_SECTIONS.map(s => s.id);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        });
        const first = ids.find(id => visible.has(id));
        if (first) setActiveSection(first);
      },
      { rootMargin: '-44px 0px -50% 0px', threshold: 0 },
    );

    ids.forEach(id => {
      const el = window.document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToSection = (id: string) => {
    const el = window.document.getElementById(id);
    if (!el) return;
    setActiveSection(id);
    const NAV_HEIGHT = 48;
    const container = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (container) {
      const elTop = el.getBoundingClientRect().top;
      const containerTop = container.getBoundingClientRect().top;
      container.scrollBy({ top: elTop - containerTop - NAV_HEIGHT, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleMultiSelect = (field: 'ignition_sources' | 'fuel_sources' | 'high_risk_activities', value: string) => {
    const current = formData[field] as string[];
    const updated = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    setFormData({ ...formData, [field]: updated });
  };

  const updateSourceAssessment = (sourceKey: string, updates: Partial<IgnitionAssessment>) => {
    const currentAssessment = formData.ignition_source_assessments[sourceKey] || {};
    setFormData({
      ...formData,
      ignition_source_assessments: {
        ...formData.ignition_source_assessments,
        [sourceKey]: {
          ...currentAssessment,
          ...updates,
        },
      },
    });
  };

  const broadSelections = {
    ignition_sources: formData.ignition_sources,
    high_risk_activities: formData.high_risk_activities,
    fuel_sources: formData.fuel_sources,
    arson_risk: formData.arson_risk,
    dsear_screen: formData.dsear_screen,
  };

  const sourceCardState = getActiveIgnitionSourceCards({
    broadSelections,
    sourceAssessments: formData.ignition_source_assessments,
    sourceKeys: IGNITION_SOURCE_AREAS.map((source) => source.key),
  });

  const getSourcePresence = (source: IgnitionSourceDefinition, assessment: IgnitionAssessment): string =>
    getEffectiveIgnitionPresence({ sourceKey: source.key, assessment, broadSelections });

  const getActivationLabels = (sourceKey: string): string[] =>
    getHazardMappingsForSource(sourceKey, broadSelections).map((mapping) => mapping.label);


  const getQualityGateWarnings = (): string[] => {
    const warnings: string[] = [];
    const hasBroadIgnition = formData.ignition_sources.length > 0;
    const hasDetailedAssessment = (Object.values(formData.ignition_source_assessments) as IgnitionAssessment[]).some(sourceHasNarrativeDetail);

    if (hasBroadIgnition && !String(formData.notes ?? '').trim() && !hasDetailedAssessment) {
      warnings.push('Ignition sources have been selected broadly, but no assessor commentary or source-specific assessment detail has been recorded.');
    }

    const dsearAssessment = formData.ignition_source_assessments.hazardous_substances_dsear;
    const dsearSelected =
      formData.fuel_sources.includes('flammable_liquids') ||
      formData.fuel_sources.includes('lpg_cylinders') ||
      formData.dsear_screen.flammables_present === 'yes' ||
      formData.dsear_screen.explosive_atmospheres_possible === 'yes' ||
      dsearAssessment?.presence === 'present';

    if (dsearSelected && !String(formData.dsear_screen.notes ?? '').trim() && !String(dsearAssessment?.assessor_commentary ?? '').trim()) {
      warnings.push('Hazardous substances / DSEAR relevance is indicated, but no DSEAR commentary has been provided.');
    }

    const smoking = formData.ignition_source_assessments.smoking;
    const smokingPresent = formData.ignition_sources.includes('smoking') || smoking?.presence === 'present';
    if (smokingPresent && !String(smoking?.existing_controls ?? '').trim()) {
      warnings.push('Smoking is marked present, but smoking controls/disposal/enforcement arrangements are not described.');
    }

    return warnings;
  };

  const hasDetailedIgnitionSource = (Object.values(formData.ignition_source_assessments) as IgnitionAssessment[]).some(sourceHasNarrativeDetail);
  const qualityGateWarnings = getQualityGateWarnings();

  const getSuggestedOutcome = (): { outcome: string; reason: string } | null => {
    const unknowns = [
      formData.arson_risk === 'unknown' && 'arson_risk',
      formData.housekeeping_fire_load === 'unknown' && 'housekeeping_fire_load',
      formData.oxygen_enrichment === 'unknown' && 'oxygen_enrichment',
    ].filter(Boolean).length;

    if (formData.oxygen_enrichment === 'known' &&
        (formData.ignition_sources.length > 2 || formData.fuel_sources.length > 2)) {
      return {
        outcome: 'material_def',
        reason: 'Known oxygen enrichment combined with significant ignition and fuel sources presents elevated fire risk',
      };
    }

    if (formData.arson_risk === 'high') {
      return {
        outcome: 'material_def',
        reason: 'High arson risk requires immediate security and preventative measures',
      };
    }

    if (unknowns >= 4) {
      return {
        outcome: 'info_gap',
        reason: `${unknowns} key factors marked as unknown - significant information gaps`,
      };
    }

    const issues = [
      formData.ignition_sources.includes('smoking') && 'Smoking controls needed',
      formData.housekeeping_fire_load === 'high' && 'High fire load',
      formData.arson_risk === 'medium' && 'Moderate arson risk',
    ].filter(Boolean);

    if (issues.length > 0 || unknowns >= 2) {
      return {
        outcome: 'minor_def',
        reason: issues.length > 0 ? issues.join(', ') : 'Some information gaps remain',
      };
    }

    return null;
  };

  const suggestedOutcome = getSuggestedOutcome();

  // Detect info gaps
  const infoGapDetection = detectInfoGaps(moduleInstance.module_key, formData, outcome);

  const handleCreateQuickAction = (actionText: string, defaultLikelihood: number, defaultImpact: number) => {
    setQuickActionTemplate({
      action: actionText,
      likelihood: defaultLikelihood,
      impact: defaultImpact,
      source: 'info_gap',
    });
    setShowActionModal(true);
  };

  const handleSave = async () => {
    window.dispatchEvent(new CustomEvent('module:save-start'));
    setIsSaving(true);

    try {
      const completedAt = outcome ? new Date().toISOString() : null;

      const payload = sanitizeModuleInstancePayload({
        outcome,
        assessor_notes: assessorNotes,
        data: { ...formData, scoring: scoringData },
        completed_at: completedAt,
      }, moduleInstance.module_key);

      console.log('[FRA1 Save] Payload being sent to Supabase:', {
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

  const handleQuickAction = async (template: QuickActionTemplate) => {
    await handleSave();
    setQuickActionTemplate({ ...template, source: template.source || 'recommendation' });
    setShowActionModal(true);
  };

  const formatLabel = (value: string) => {
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const renderSourceCard = (source: IgnitionSourceDefinition, isActive: boolean) => {
    const assessment = formData.ignition_source_assessments[source.key] || {};
    const effectivePresence = getSourcePresence(source, assessment);
    const activationLabels = getActivationLabels(source.key);
    const commercialKitchenContext = source.key === 'cooking' && hasCommercialKitchenContext(source.key, broadSelections);
    const cookingCategory = commercialKitchenContext ? 'Commercial kitchen fire risk' : 'Cooking equipment';
    const defaultCategory = source.key === 'cooking' ? cookingCategory : 'Fire hazards';
    const presenceIsDerived = effectivePresence === 'present' && !assessment.presence && activationLabels.length > 0;
    const needsAction = ['high'].includes(String(assessment.risk_significance || '')) ||
      ['action_required', 'urgent'].includes(String(assessment.recommended_action_trigger || '')) ||
      Boolean(String(assessment.deficiencies || '').trim());
    const legacyEvidenceNotes = String(assessment.evidence_references || '').trim();
    const highPriorityNoEvidence = ['high'].includes(String(assessment.risk_significance || '')) && !legacyEvidenceNotes;
    const defaultOpen = isActive;

    return (
      <details key={source.key} open={defaultOpen} className={`group rounded-lg border ${isActive ? 'border-blue-200 bg-blue-50/40' : 'border-neutral-200 bg-neutral-50'}`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-neutral-900">{source.label}</h4>
              {effectivePresence && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-neutral-600 border border-neutral-200">
                  {presenceIsDerived ? 'Present' : formatLabel(effectivePresence)}
                </span>
              )}
              {commercialKitchenContext && (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 border border-orange-200">
                  Commercial kitchen context
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-1">{source.prompt}</p>
            {commercialKitchenContext && (
              <p className="mt-2 text-xs text-orange-800">
                Include extraction / duct cleaning, grease build-up, deep fat frying, suppression, cleaning regime, kitchen shutdown procedures, supervision, staff controls and housekeeping around cooking equipment.
              </p>
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-neutral-500 transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-neutral-200 bg-white p-4 space-y-4">
          <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-neutral-700">Change presence status</summary>
            <div className="mt-3 max-w-sm">
              <label className="block text-sm font-medium text-neutral-700 mb-2">Manual presence override</label>
              <select
                value={assessment.presence || ''}
                onChange={(e) => updateSourceAssessment(source.key, { presence: e.target.value as IgnitionAssessment['presence'] })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Use derived / not assessed in detail</option>
                <option value="present">Present</option>
                <option value="not_present">Not present</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </details>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Risk significance</label>
              <select
                value={assessment.risk_significance || ''}
                onChange={(e) => updateSourceAssessment(source.key, { risk_significance: e.target.value as IgnitionAssessment['risk_significance'] })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="low">Low — risk well controlled</option>
                <option value="medium">Medium — controls partially adequate</option>
                <option value="high">High — significant risk or controls inadequate</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Recommended action required?</label>
              <select
                value={assessment.recommended_action_trigger || ''}
                onChange={(e) => updateSourceAssessment(source.key, { recommended_action_trigger: e.target.value as IgnitionAssessment['recommended_action_trigger'] })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="none">No action required</option>
                <option value="consider">Consider action</option>
                <option value="action_required">Action required</option>
                <option value="urgent">Urgent action</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Controls / adequacy notes</label>
            <textarea
              value={assessment.condition_adequacy || ''}
              onChange={(e) => updateSourceAssessment(source.key, { condition_adequacy: e.target.value })}
              placeholder="Brief judgement on control adequacy or uncertainty..."
              rows={2}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Existing controls</label>
              <textarea
                value={assessment.existing_controls || ''}
                onChange={(e) => updateSourceAssessment(source.key, { existing_controls: e.target.value })}
                placeholder="Controls observed or evidenced..."
                rows={3}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Deficiency observed</label>
              <textarea
                value={assessment.deficiencies || ''}
                onChange={(e) => updateSourceAssessment(source.key, { deficiencies: e.target.value })}
                placeholder="Deficiencies, gaps or concerns. Leave blank if controls are adequate."
                rows={3}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-700">Evidence</p>
                <p className="mt-1 text-sm text-neutral-500">No evidence added yet.</p>
              </div>
              <button
                type="button"
                onClick={() => handleQuickAction({
                  action: source.actionText,
                  likelihood: assessment.risk_significance === 'high' ? 4 : 3,
                  impact: assessment.risk_significance === 'high' ? 4 : 3,
                  source: 'recommendation',
                  sectionKey: source.key,
                  sectionLabel: source.label,
                  sourceKey: source.key,
                  sourceLabel: source.label,
                  defaultCategory,
                })}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
              >
                <Plus className="h-4 w-4" />
                Add recommendation
              </button>
            </div>
            {legacyEvidenceNotes && (
              <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-amber-800">Advanced / legacy evidence notes</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{legacyEvidenceNotes}</p>
              </details>
            )}
          </div>

          {(needsAction || highPriorityNoEvidence) && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {needsAction && <p><AlertTriangle className="mr-1 inline h-4 w-4" />Action required.</p>}
              {highPriorityNoEvidence && <p><AlertTriangle className="mr-1 inline h-4 w-4" />Needs evidence.</p>}
            </div>
          )}

          <ModuleAreaRecommendationControls
              documentId={document.id}
              moduleInstanceId={moduleInstance.id}
              moduleKey={moduleInstance.module_key}
            sourceAssessmentType="ignition_source_assessments"
            areaKey={source.key}
            areaLabel={source.label}
            defaultRecommendation={source.actionText}
            defaultObservation={assessment.condition_adequacy || source.prompt}
            severity={assessment.risk_significance}
            evidenceContext={assessment.evidence_references}
            assessment={assessment}
            legacyLinkedActionReference={assessment.linked_action_reference}
            defaultCategory={defaultCategory}
          />

          {assessment.linked_action_reference && !needsAction && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Linked recommendation preserved: {assessment.linked_action_reference}
            </div>
          )}
        </div>
      </details>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Flame className="w-6 h-6 text-neutral-700" />
          <h2 className="text-2xl font-bold text-neutral-900">
            Fire Hazards & Ignition Sources
          </h2>
        </div>
        <p className="text-neutral-600">
          Assess the fire triangle: ignition sources, fuel loads, and oxygen enrichment plus arson risk
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

      <div className="mb-6">
        <InfoGapQuickActions
          detection={infoGapDetection}
          moduleKey={moduleInstance.module_key}
          onCreateAction={handleCreateQuickAction}
          showCreateButtons={true}
        />
      </div>

      <nav aria-label="Module sections" className="sticky top-0 z-10 -mx-4 sm:-mx-6 mb-4 border-b border-neutral-100 bg-neutral-50/95 px-4 py-1.5">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <span className="mr-1 shrink-0 text-xs text-neutral-400">Jump:</span>
          {NAV_SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollToSection(id)}
              className={`rounded px-1.5 py-0.5 text-xs transition-colors ${activeSection === id ? 'font-medium text-neutral-900 underline underline-offset-2' : 'text-neutral-500 hover:text-neutral-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-6">
        <div id="fra1-ignition" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Ignition Sources
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Select all ignition sources present or reasonably foreseeable
          </p>
          <div className="space-y-2">
            {IGNITION_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={formData.ignition_sources.includes(option)}
                  onChange={() => toggleMultiSelect('ignition_sources', option)}
                  className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-2 focus:ring-neutral-900"
                />
                <span className="text-sm text-neutral-700">{formatLabel(option)}</span>
              </label>
            ))}
          </div>
          {formData.ignition_sources.includes('other') && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Specify other ignition sources
              </label>
              <input
                type="text"
                value={formData.ignition_other}
                onChange={(e) => setFormData({ ...formData, ignition_other: e.target.value })}
                placeholder="Describe other ignition sources..."
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>
          )}

        </div>



        {qualityGateWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="text-sm font-bold text-amber-900 mb-2">Advisory quality checks</h3>
            <ul className="space-y-1 text-sm text-amber-800 list-disc list-inside">
              {qualityGateWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              Advisory only — these checks do not block saving or issue.
            </p>
          </div>
        )}

        <div id="fra1-fuel" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Fuel Sources
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Select all significant fuel sources present
          </p>
          <div className="space-y-2">
            {FUEL_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={formData.fuel_sources.includes(option)}
                  onChange={() => toggleMultiSelect('fuel_sources', option)}
                  className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-2 focus:ring-neutral-900"
                />
                <span className="text-sm text-neutral-700">{formatLabel(option)}</span>
              </label>
            ))}
          </div>
          {formData.fuel_sources.includes('other') && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Specify other fuel sources
              </label>
              <input
                type="text"
                value={formData.fuel_other}
                onChange={(e) => setFormData({ ...formData, fuel_other: e.target.value })}
                placeholder="Describe other fuel sources..."
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>
          )}


          <div className="mt-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              General housekeeping and fire load assessment
            </label>
            <select
              value={formData.housekeeping_fire_load}
              onChange={(e) =>
                setFormData({ ...formData, housekeeping_fire_load: e.target.value })
              }
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            >
              <option value="unknown">Unknown</option>
              <option value="low">Low - Good housekeeping, minimal fire load</option>
              <option value="medium">Medium - Moderate fire load, acceptable housekeeping</option>
              <option value="high">High - Poor housekeeping, excessive fire load</option>
            </select>
          </div>

        </div>

        <div id="fra1-oxygen" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Oxygen Enrichment
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Oxygen enrichment status
              </label>
              <select
                value={formData.oxygen_enrichment}
                onChange={(e) =>
                  setFormData({ ...formData, oxygen_enrichment: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="none">None - no oxygen enrichment</option>
                <option value="possible">Possible - requires verification</option>
                <option value="known">Known - oxygen enrichment present</option>
                <option value="unknown">Unknown</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                Medical gases, industrial oxidisers, oxygen therapy, compressed air systems
              </p>
            </div>

            {(formData.oxygen_enrichment === 'known' || formData.oxygen_enrichment === 'possible') && (
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Oxygen sources and control measures
                </label>
                <textarea
                  value={formData.oxygen_sources_notes}
                  onChange={(e) =>
                    setFormData({ ...formData, oxygen_sources_notes: e.target.value })
                  }
                  placeholder="Describe oxygen sources, storage locations, piped systems, and control measures in place..."
                  rows={3}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
                />
              </div>
            )}
          </div>
        </div>

        <div id="fra1-activities" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            High-Risk Activities
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Select all high-risk fire activities undertaken
          </p>
          <div className="space-y-2">
            {HIGH_RISK_ACTIVITIES.map((option) => (
              <label key={option} className="flex items-center gap-2 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={formData.high_risk_activities.includes(option)}
                  onChange={() => toggleMultiSelect('high_risk_activities', option)}
                  className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-2 focus:ring-neutral-900"
                />
                <span className="text-sm text-neutral-700">{formatLabel(option)}</span>
              </label>
            ))}
          </div>
          {formData.high_risk_activities.includes('other') && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Specify other high-risk activities
              </label>
              <input
                type="text"
                value={formData.high_risk_other}
                onChange={(e) => setFormData({ ...formData, high_risk_other: e.target.value })}
                placeholder="Describe other activities..."
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>
          )}


        </div>

        <div id="fra1-arson" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Arson Risk & Lone Working
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Arson risk assessment
              </label>
              <select
                value={formData.arson_risk}
                onChange={(e) =>
                  setFormData({ ...formData, arson_risk: e.target.value })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="low">Low - Good security, no history</option>
                <option value="medium">Medium - Some vulnerabilities</option>
                <option value="high">High - Poor security or history of incidents</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                Consider security, access control, history, location, and vulnerable areas
              </p>
            </div>


          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Additional Hazard Notes
          </h3>
          <textarea
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder="Add any additional observations about fire hazards, ignition sources, or risk factors..."
            rows={4}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
          />
        </div>

        <div id="fra1-source-cards" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-2">
            Contextual Ignition Source Cards
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Complete the cards that match the ignition sources or high-risk activities present.
          </p>

          {sourceCardState.activeSourceKeys.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
              No contextual source cards are active yet. Select a broad ignition, fuel or high-risk activity item above.
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Selected / present sources</h4>
              {sourceCardState.activeSourceKeys.map((sourceKey) => {
                const source = IGNITION_SOURCE_AREAS.find((item) => item.key === sourceKey);
                return source ? renderSourceCard(source, true) : null;
              })}
            </div>
          )}

        </div>



        <div id="fixed-wiring-eicr-section" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-bold text-neutral-900">
              Electrical Installation Safety (Fixed Wiring / EICR)
            </h3>
          </div>
          <p className="text-sm text-neutral-600 mb-4">
            Assess electrical installation condition and compliance with BS 7671
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Date of Last EICR (Electrical Installation Condition Report)
              </label>
              <input
                type="date"
                value={formData.electrical_safety.eicr_last_date || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_last_date: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Recommended Test Interval
              </label>
              <select
                value={formData.electrical_safety.eicr_interval_years}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_interval_years: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Select interval</option>
                <option value="1">Annual</option>
                <option value="3">Every 3 Years</option>
                <option value="5">Every 5 Years</option>
                <option value="other">Other</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                Typical intervals: HMOs/commercial 1-3 years, domestic letting 5 years
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                EICR Result (if available)
              </label>
              <select
                value={formData.electrical_safety.eicr_satisfactory}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_satisfactory: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="satisfactory">Satisfactory</option>
                <option value="unsatisfactory">Unsatisfactory</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                EICR Evidence Seen
              </label>
              <select
                value={formData.electrical_safety.eicr_evidence_seen}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_evidence_seen: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="no">No - Evidence not seen</option>
                <option value="yes">Yes - Evidence seen and reviewed</option>
              </select>
              {formData.electrical_safety.eicr_evidence_seen === 'no' && (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    <strong>Information Gap:</strong> EICR evidence should be requested and reviewed.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Unresolved C1 or C2 Observations
              </label>
              <select
                value={formData.electrical_safety.eicr_outstanding_c1_c2}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_outstanding_c1_c2: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="no">No - All observations resolved</option>
                <option value="yes">Yes - Unresolved C1/C2 observations present</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                C1 = Danger present (immediate risk); C2 = Potentially dangerous (urgent remedial action required)
              </p>
              {formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>Critical:</strong> Unresolved C1/C2 observations represent immediate or potential danger and must be addressed urgently.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Electrical Safety Notes
              </label>
              <textarea
                value={formData.electrical_safety.eicr_notes}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      eicr_notes: e.target.value,
                    },
                  })
                }
                placeholder="Details of EICR findings, observations, electrical safety concerns, or remedial works..."
                rows={3}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                PAT Testing Regime (Optional)
              </label>
              <select
                value={formData.electrical_safety.pat_in_place}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electrical_safety: {
                      ...formData.electrical_safety,
                      pat_in_place: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Yes - PAT regime in place</option>
                <option value="no">No PAT regime</option>
                <option value="na">Not applicable</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                Portable Appliance Testing for user equipment (not part of fixed installation)
              </p>
            </div>

            {(formData.electrical_safety.eicr_evidence_seen === 'no' ||
              formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes') && !hasDetailedIgnitionSource && (
              <div className="pt-4 border-t border-neutral-200">
                <button
                  onClick={() =>
                    handleQuickAction({
                      action: formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes'
                        ? 'Urgent: Rectify unresolved C1/C2 electrical observations identified in EICR. Engage competent electrical contractor to assess and remediate all immediate and potential dangers in accordance with BS 7671.'
                        : 'Obtain and review current EICR (Electrical Installation Condition Report) to verify electrical installation safety and compliance with BS 7671. Implement any required remedial works.',
                      likelihood: formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' ? 5 : 4,
                      impact: 4,
                      sectionKey: EICR_SECTION_KEY,
                      sectionLabel: EICR_SECTION_LABEL,
                      sourceKey: EICR_SECTION_KEY,
                      sourceLabel: EICR_SOURCE_LABEL,
                      defaultCategory: 'Electrical installation',
                    })
                  }
                  className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add recommendation: {formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' ? 'Rectify C1/C2 Observations' : 'Request EICR Evidence'}
                </button>
              </div>
            )}

            <ModuleAreaRecommendationControls
              documentId={document.id}
              moduleInstanceId={moduleInstance.id}
              moduleKey={moduleInstance.module_key}
              sourceAssessmentType="fixed_wiring"
              areaKey="fixed_wiring_eicr"
              areaLabel="Fixed wiring / EICR"
              sectionKey={EICR_SECTION_KEY}
              sectionLabel={EICR_SECTION_LABEL}
              sourceKey={EICR_SECTION_KEY}
              sourceLabel={EICR_SOURCE_LABEL}
              defaultCategory="Electrical installation"
              defaultObservation={formData.electrical_safety.eicr_notes || 'Fixed wiring and EICR evidence review.'}
              defaultRiskImplication="Unverified or defective fixed wiring can increase ignition risk and may compromise fire safety management assurance."
              defaultRecommendation={formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes'
                ? 'Rectify unresolved C1/C2 electrical observations identified in the EICR using a competent electrical contractor.'
                : 'Obtain and review current EICR evidence and complete any required remedial works.'}
              severity={formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' ? 'high' : formData.electrical_safety.eicr_evidence_seen === 'no' ? 'medium' : 'low'}
              assessment={{
                status: formData.electrical_safety.eicr_satisfactory === 'unsatisfactory' ? 'inadequate' : 'unknown',
                observations: formData.electrical_safety.eicr_notes,
                deficiencies: formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes'
                  ? 'Unresolved C1/C2 electrical observations require competent remediation.'
                  : formData.electrical_safety.eicr_evidence_seen === 'no'
                    ? 'Current EICR evidence has not been seen.'
                    : '',
                risk_significance: formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' ? 'high' : formData.electrical_safety.eicr_evidence_seen === 'no' ? 'medium' : 'low',
                recommended_action_trigger: formData.electrical_safety.eicr_outstanding_c1_c2 === 'yes' || formData.electrical_safety.eicr_evidence_seen === 'no' ? 'action_required' : 'none',
              }}
            />

          </div>
        </div>

        <div id="fra1-lightning" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Lightning Protection
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Lightning risk assessment and protection systems
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Lightning protection present?
              </label>
              <select
                value={formData.lightning.lightning_protection_present || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lightning: {
                      ...formData.lightning,
                      lightning_protection_present: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Lightning risk assessment completed?
              </label>
              <select
                value={formData.lightning.lightning_risk_assessment_completed || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lightning: {
                      ...formData.lightning,
                      lightning_risk_assessment_completed: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Assessment date (if known)
              </label>
              <input
                type="text"
                value={formData.lightning.assessment_date || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lightning: {
                      ...formData.lightning,
                      assessment_date: e.target.value || null,
                    },
                  })
                }
                placeholder="e.g., March 2024"
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Lightning protection notes
              </label>
              <textarea
                value={formData.lightning.notes}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lightning: {
                      ...formData.lightning,
                      notes: e.target.value,
                    },
                  })
                }
                placeholder="Details about lightning protection system, test records, risk assessment findings..."
                rows={2}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>


            {(formData.lightning.lightning_protection_present === 'unknown' ||
              formData.lightning.lightning_risk_assessment_completed === 'no' ||
              formData.lightning.lightning_risk_assessment_completed === 'unknown') && !hasDetailedIgnitionSource && (
              <div className="pt-4 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() =>
                    handleQuickAction({
                      action: 'Verify lightning exposure and protection arrangements, including lightning risk assessment status, inspection/test records and remediation of any identified defects.',
                      likelihood: 3,
                      impact: 4,
                    })
                  }
                  className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add recommendation: Verify lightning protection arrangements
                </button>
              </div>
            )}

            <ModuleAreaRecommendationControls
              documentId={document.id}
              moduleInstanceId={moduleInstance.id}
              moduleKey={moduleInstance.module_key}
              sourceAssessmentType="lightning_protection"
              areaKey="lightning_protection"
              areaLabel="Lightning protection"
              defaultObservation={formData.lightning.notes || 'Lightning protection and risk assessment review.'}
              defaultRiskImplication="Unverified lightning exposure or protection arrangements can leave the premises vulnerable to ignition, damage to safety-critical systems and avoidable interruption following storm activity."
              defaultRecommendation="Verify lightning exposure and protection arrangements, including risk assessment status, inspection/test records and remediation of any identified defects."
              severity={formData.lightning.lightning_protection_present === 'no' || formData.lightning.lightning_risk_assessment_completed === 'no' ? 'medium' : 'unknown'}
              assessment={{
                status: formData.lightning.lightning_protection_present === 'no' || formData.lightning.lightning_risk_assessment_completed === 'no' ? 'inadequate' : 'unknown',
                observations: formData.lightning.notes,
                deficiencies: formData.lightning.lightning_protection_present === 'no'
                  ? 'Lightning protection is absent or has not been justified by risk assessment.'
                  : formData.lightning.lightning_risk_assessment_completed === 'no' || formData.lightning.lightning_risk_assessment_completed === 'unknown'
                    ? 'Lightning risk assessment status is not confirmed.'
                    : '',
                risk_significance: formData.lightning.lightning_protection_present === 'no' || formData.lightning.lightning_risk_assessment_completed === 'no' ? 'medium' : 'unknown',
                recommended_action_trigger: formData.lightning.lightning_protection_present === 'no' || formData.lightning.lightning_risk_assessment_completed === 'no' || formData.lightning.lightning_risk_assessment_completed === 'unknown' ? 'action_required' : 'none',
              }}
            />
          </div>
        </div>

        <div id="fra1-duct" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            Duct & Extract Cleaning
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Primary extract ventilation and cleaning record. Action ownership sits with the Cooking / Kitchen Processes source card when kitchen fire risk controls need improvement.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Extract ductwork present?
              </label>
              <select
                value={formData.duct_cleaning.ducts_present || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    duct_cleaning: {
                      ...formData.duct_cleaning,
                      ducts_present: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            {formData.duct_cleaning.ducts_present === 'yes' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Dust / grease accumulation risk
                  </label>
                  <select
                    value={formData.duct_cleaning.dust_grease_risk || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        duct_cleaning: {
                          ...formData.duct_cleaning,
                          dust_grease_risk: e.target.value || null,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  >
                    <option value="">Not stated</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Cleaning frequency
                  </label>
                  <select
                    value={formData.duct_cleaning.cleaning_frequency || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        duct_cleaning: {
                          ...formData.duct_cleaning,
                          cleaning_frequency: e.target.value || null,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  >
                    <option value="">Not stated</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                    <option value="ad-hoc">Ad-hoc</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Last cleaned (if known)
                  </label>
                  <input
                    type="text"
                    value={formData.duct_cleaning.last_cleaned || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        duct_cleaning: {
                          ...formData.duct_cleaning,
                          last_cleaned: e.target.value || null,
                        },
                      })
                    }
                    placeholder="e.g., January 2026"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Duct cleaning notes
              </label>
              <textarea
                value={formData.duct_cleaning.notes}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    duct_cleaning: {
                      ...formData.duct_cleaning,
                      notes: e.target.value,
                    },
                  })
                }
                placeholder="Details about duct systems, kitchen extract, maintenance records..."
                rows={2}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        <div id="fra1-dsear" className="bg-white rounded-lg border border-neutral-200 p-6 scroll-mt-12">
          <h3 className="text-lg font-bold text-neutral-900 mb-4">
            DSEAR Screening
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Dangerous Substances and Explosive Atmospheres Regulations 2002 screening for flammable liquids, flammable gases, combustible dusts and relevant vapours or mists.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Flammable substances or combustible dusts present?
              </label>
              <select
                value={formData.dsear_screen.flammables_present || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    dsear_screen: {
                      ...formData.dsear_screen,
                      flammables_present: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
                <option value="not_applicable_not_installed">Not applicable — system not installed</option>
                <option value="not_applicable_landlord_controlled">Not applicable — landlord-controlled</option>
                <option value="not_applicable_outside_tenant_control">Not applicable — outside tenant control</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Explosive atmospheres possible?
              </label>
              <select
                value={formData.dsear_screen.explosive_atmospheres_possible || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    dsear_screen: {
                      ...formData.dsear_screen,
                      explosive_atmospheres_possible: e.target.value || null,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              >
                <option value="">Not stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
                <option value="not_applicable_no_substances">Not applicable — no relevant dangerous substances or combustible dusts identified</option>
                <option value="not_applicable_not_required">Not applicable — not required for this premises</option>
              </select>
            </div>

            {(formData.dsear_screen.flammables_present === 'yes' || formData.dsear_screen.explosive_atmospheres_possible === 'yes') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    DSEAR assessment status
                  </label>
                  <select
                    value={formData.dsear_screen.dsear_assessment_status || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        dsear_screen: {
                          ...formData.dsear_screen,
                          dsear_assessment_status: e.target.value || null,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  >
                    <option value="">Not stated</option>
                    <option value="completed">Completed</option>
                    <option value="not completed">Not completed</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Assessor / responsible person
                  </label>
                  <input
                    type="text"
                    value={formData.dsear_screen.assessor || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        dsear_screen: {
                          ...formData.dsear_screen,
                          assessor: e.target.value || null,
                        },
                      })
                    }
                    placeholder="Name or role"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                DSEAR screening notes
              </label>
              <textarea
                value={formData.dsear_screen.notes}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    dsear_screen: {
                      ...formData.dsear_screen,
                      notes: e.target.value,
                    },
                  })
                }
                placeholder="Details about flammable liquids, flammable gases, combustible dusts, relevant vapours/mists, assessment findings and control measures..."
                rows={2}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              />
            </div>

            <ModuleActions
              documentId={document.id}
              moduleInstanceId={moduleInstance.id}
              buttonLabel="Add Recommendation"
              sectionKey={DSEAR_SCREENING_SECTION_KEY}
              sectionLabel={DSEAR_SCREENING_SECTION_LABEL}
              sourceKey={DSEAR_SCREENING_SECTION_KEY}
              sourceLabel={DSEAR_SCREENING_SECTION_LABEL}
              defaultCategory="Dangerous substances / DSEAR relevance"
              compact
            />
          </div>
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
        scoringData={scoringData}
        onScoringChange={setScoringData}
      />


      {showActionModal && (
        <AddActionModal
          documentId={document.id}
          moduleInstanceId={moduleInstance.id}
          onClose={() => {
            setShowActionModal(false);
            setQuickActionTemplate(null);
          }}
          onActionCreated={() => {
            setShowActionModal(false);
            setQuickActionTemplate(null);
          }}
          defaultAction={quickActionTemplate?.action}
          source={quickActionTemplate?.source}
          sourceModuleKey={moduleInstance.module_key}
          sectionKey={quickActionTemplate?.sectionKey}
          sectionLabel={quickActionTemplate?.sectionLabel}
          sourceKey={quickActionTemplate?.sourceKey}
          sourceLabel={quickActionTemplate?.sourceLabel}
          defaultCategory={quickActionTemplate?.defaultCategory}
        />
      )}
    </div>
  );
}
