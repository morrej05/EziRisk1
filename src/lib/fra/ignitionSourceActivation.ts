export type IgnitionPresence = 'present' | 'not_present' | 'unknown' | '';

export interface IgnitionSourceAssessmentLike {
  presence?: IgnitionPresence;
  condition_adequacy?: string;
  existing_controls?: string;
  deficiencies?: string;
  evidence_references?: string;
  assessor_commentary?: string;
  risk_significance?: string;
  recommended_action_trigger?: string;
  linked_action_reference?: string;
}

export type IgnitionSourceAssessmentMapLike = Record<string, IgnitionSourceAssessmentLike | undefined>;

export interface HazardToSourceMapping {
  broadField: 'ignition_sources' | 'high_risk_activities' | 'fuel_sources' | 'arson_risk';
  broadKey: string;
  sourceKey: string;
  label: string;
  dsearPrompt?: boolean;
  commercialKitchenContext?: boolean;
}

export interface ActiveIgnitionSourceCardsInput {
  broadSelections: {
    ignition_sources?: string[];
    high_risk_activities?: string[];
    fuel_sources?: string[];
    arson_risk?: string;
    dsear_screen?: {
      flammables_present?: unknown;
      explosive_atmospheres_possible?: unknown;
    };
  };
  sourceAssessments?: IgnitionSourceAssessmentMapLike;
  sourceKeys: string[];
}

export interface ActiveIgnitionSourceCardsResult {
  activeSourceKeys: string[];
  optionalSourceKeys: string[];
  dsearPrompt: boolean;
  activationBySource: Record<string, HazardToSourceMapping[]>;
  completedLegacySourceKeys: string[];
}

const DETAIL_FIELDS: Array<keyof IgnitionSourceAssessmentLike> = [
  'condition_adequacy',
  'existing_controls',
  'deficiencies',
  'evidence_references',
  'assessor_commentary',
  'risk_significance',
  'recommended_action_trigger',
  'linked_action_reference',
];

/**
 * Central FRA hazard/source activation map. Broad checklist selections remain the
 * triage layer; these entries decide which contextual source card is surfaced.
 */
export const DEDICATED_STRUCTURED_WORKFLOW_SOURCE_KEYS = ['fixed_wiring_eicr'] as const;

const DEDICATED_STRUCTURED_WORKFLOW_SOURCE_KEY_SET = new Set<string>(DEDICATED_STRUCTURED_WORKFLOW_SOURCE_KEYS);

export function hasDedicatedStructuredWorkflow(sourceKey: string): boolean {
  return DEDICATED_STRUCTURED_WORKFLOW_SOURCE_KEY_SET.has(sourceKey);
}

export const HAZARD_TO_SOURCE_MAPPINGS: HazardToSourceMapping[] = [
  { broadField: 'ignition_sources', broadKey: 'smoking', sourceKey: 'smoking', label: 'Smoking → Smoking controls source card' },
  { broadField: 'ignition_sources', broadKey: 'electrical_equipment', sourceKey: 'electrical', label: 'Electrical equipment → Electrical ignition source card' },
  { broadField: 'ignition_sources', broadKey: 'cooking', sourceKey: 'cooking', label: 'Cooking → Cooking / Kitchen Processes card' },
  { broadField: 'ignition_sources', broadKey: 'portable_heaters', sourceKey: 'portable_heaters', label: 'Portable heaters → Heating/appliances source card' },
  { broadField: 'ignition_sources', broadKey: 'plant_rooms', sourceKey: 'plant_machinery', label: 'Plant rooms → Plant/machinery source card' },
  { broadField: 'ignition_sources', broadKey: 'arson_ignition_points', sourceKey: 'arson', label: 'Arson/security concern → Arson/external ignition card' },
  { broadField: 'ignition_sources', broadKey: 'other', sourceKey: 'other', label: 'Other ignition source → Other ignition sources card' },
  { broadField: 'high_risk_activities', broadKey: 'commercial_kitchens', sourceKey: 'cooking', label: 'Commercial Kitchens → Cooking / Kitchen Processes card', commercialKitchenContext: true },
  { broadField: 'high_risk_activities', broadKey: 'laundry_operations', sourceKey: 'laundry', label: 'Laundry operations → laundry fire load, lint and dryer maintenance follow-up' },
  { broadField: 'high_risk_activities', broadKey: 'hot_work', sourceKey: 'hot_works', label: 'Hot work → hot work ignition exposure card' },
  { broadField: 'high_risk_activities', broadKey: 'lithium_ion_charging', sourceKey: 'battery_charging_lithium_ion', label: 'Lithium-ion charging → Battery charging / lithium-ion card' },
  { broadField: 'high_risk_activities', broadKey: 'other', sourceKey: 'high_risk_other', label: 'Other high-risk activity → free-text high-risk activity card' },
  { broadField: 'fuel_sources', broadKey: 'flammable_liquids', sourceKey: 'hazardous_substances_dsear', label: 'Flammable liquids → Flammable substances / DSEAR prompt card', dsearPrompt: true },
  { broadField: 'fuel_sources', broadKey: 'lpg_cylinders', sourceKey: 'hazardous_substances_dsear', label: 'Flammable gases/LPG → Flammable substances / DSEAR prompt card', dsearPrompt: true },
  { broadField: 'arson_risk', broadKey: 'medium', sourceKey: 'arson', label: 'Medium arson risk → Arson/external ignition card' },
  { broadField: 'arson_risk', broadKey: 'high', sourceKey: 'arson', label: 'High arson risk → Arson/external ignition card' },
];

export function sourceAssessmentHasDetail(assessment?: IgnitionSourceAssessmentLike): boolean {
  if (!assessment) return false;
  return Boolean(
    assessment.presence || DETAIL_FIELDS.some((field) => String(assessment[field] ?? '').trim())
  );
}

function mappingIsSelected(mapping: HazardToSourceMapping, broadSelections: ActiveIgnitionSourceCardsInput['broadSelections']): boolean {
  if (mapping.broadField === 'arson_risk') {
    return broadSelections.arson_risk === mapping.broadKey;
  }

  const selectedValues = broadSelections[mapping.broadField];
  return Array.isArray(selectedValues) && selectedValues.includes(mapping.broadKey);
}

export function getHazardMappingsForSource(
  sourceKey: string,
  broadSelections: ActiveIgnitionSourceCardsInput['broadSelections']
): HazardToSourceMapping[] {
  return HAZARD_TO_SOURCE_MAPPINGS.filter((mapping) =>
    mapping.sourceKey === sourceKey && mappingIsSelected(mapping, broadSelections)
  );
}


export function hasCommercialKitchenContext(
  sourceKey: string,
  broadSelections: ActiveIgnitionSourceCardsInput['broadSelections']
): boolean {
  return getHazardMappingsForSource(sourceKey, broadSelections).some((mapping) => mapping.commercialKitchenContext);
}

export function getEffectiveIgnitionPresence(options: {
  sourceKey: string;
  assessment?: IgnitionSourceAssessmentLike;
  broadSelections: ActiveIgnitionSourceCardsInput['broadSelections'];
}): IgnitionPresence {
  const { sourceKey, assessment, broadSelections } = options;
  if (assessment?.presence) return assessment.presence;
  if (getHazardMappingsForSource(sourceKey, broadSelections).length > 0) return 'present';
  if (sourceKey === 'hazardous_substances_dsear' && (
    broadSelections.dsear_screen?.flammables_present === 'yes' ||
    broadSelections.dsear_screen?.explosive_atmospheres_possible === 'yes'
  )) {
    return 'present';
  }
  return sourceAssessmentHasDetail(assessment) ? 'unknown' : '';
}

export function getActiveIgnitionSourceCards(input: ActiveIgnitionSourceCardsInput): ActiveIgnitionSourceCardsResult {
  const { broadSelections, sourceAssessments = {}, sourceKeys } = input;
  const activationBySource: Record<string, HazardToSourceMapping[]> = {};
  const active = new Set<string>();
  const completedLegacy = new Set<string>();
  let dsearPrompt = false;

  sourceKeys.forEach((sourceKey) => {
    const mappings = getHazardMappingsForSource(sourceKey, broadSelections);
    if (mappings.length > 0) {
      activationBySource[sourceKey] = mappings;
      if (!hasDedicatedStructuredWorkflow(sourceKey)) {
        active.add(sourceKey);
      }
      if (mappings.some((mapping) => mapping.dsearPrompt)) dsearPrompt = true;
    }

    const assessment = sourceAssessments[sourceKey];
    if (sourceAssessmentHasDetail(assessment)) {
      completedLegacy.add(sourceKey);
      if (!hasDedicatedStructuredWorkflow(sourceKey)) {
        active.add(sourceKey);
      }
      if (sourceKey === 'hazardous_substances_dsear') dsearPrompt = true;
    }
  });

  if (
    broadSelections.dsear_screen?.flammables_present === 'yes' ||
    broadSelections.dsear_screen?.explosive_atmospheres_possible === 'yes'
  ) {
    active.add('hazardous_substances_dsear');
    dsearPrompt = true;
  }

  const activeSourceKeys = sourceKeys.filter((key) => active.has(key));
  return {
    activeSourceKeys,
    optionalSourceKeys: sourceKeys.filter((key) => !active.has(key)),
    dsearPrompt,
    activationBySource,
    completedLegacySourceKeys: sourceKeys.filter((key) => completedLegacy.has(key)),
  };
}
