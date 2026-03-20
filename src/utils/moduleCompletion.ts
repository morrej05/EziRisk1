import { resolveSectionAssessmentOutcome, type ModuleInstanceAssessmentShape } from './moduleAssessment';

const RE_MODULE_KEY_PREFIX = 'RE_';
const RE_ROOT_MODULE_KEY = 'RISK_ENGINEERING';

interface ModuleCompletionShape extends ModuleInstanceAssessmentShape {
  id?: string;
  module_key?: string;
  completed_at?: string | null;
}

interface ModuleCompletionContext {
  allModules?: ModuleCompletionShape[];
}

type CompletionState = 'complete' | 'incomplete' | 'untouched';

interface ModuleCompletionDetails {
  state: CompletionState;
  missingRequirements: string[];
}

function isReModule(moduleKey?: string): boolean {
  return Boolean(moduleKey && (moduleKey.startsWith(RE_MODULE_KEY_PREFIX) || moduleKey === RE_ROOT_MODULE_KEY));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['unknown', 'not specified', 'n/a', 'na', 'not set'].includes(normalized)) return false;
    return true;
  }
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'section_assessment_outcome' && key !== 'section_assessment_notes')
      .some(([, entry]) => hasMeaningfulValue(entry));
  }

  return false;
}

const RE_NON_INPUT_KEYS = new Set([
  'version',
  'section_key',
  'help',
  'key',
  'type',
  'document_type',
  'rating_scale',
  'weighting_source',
  'weight',
  'weighted_score',
  'max_possible',
  'total_weighted_score',
  'percent',
  'band',
  'numbering_prefix',
  'numbering_includes_year_month',
  'max_images_per_recommendation',
  'currency',
]);

function hasMeaningfulReUserInput(value: unknown, fieldName?: string): boolean {
  if (value == null) return false;

  if (fieldName && RE_NON_INPUT_KEYS.has(fieldName)) return false;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['unknown', 'not specified', 'n/a', 'na', 'not set', 'v1', 'gbp', '1_to_5'].includes(normalized)) return false;
    return true;
  }

  if (typeof value === 'number') {
    if (fieldName && RE_NON_INPUT_KEYS.has(fieldName)) return false;
    return true;
  }

  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulReUserInput(entry));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'section_assessment_outcome' && key !== 'section_assessment_notes')
      .some(([key, entry]) => hasMeaningfulReUserInput(entry, key));
  }

  return false;
}

/**
 * Shared UI completion semantics:
 * - Complete only when explicitly marked by outcome/completed_at
 *   (prevents seeded/default data showing as complete).
 */
export function isModuleCompleteForUi(moduleInstance: ModuleCompletionShape): boolean {
  return getModuleCompletionDetails(moduleInstance).state === 'complete';
}

function hasRating(ratings: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(ratings && typeof ratings[key] === 'number');
}

function getRiskEngineeringRatings(context?: ModuleCompletionContext): Record<string, unknown> {
  const riskEngineeringModule = context?.allModules?.find((module) => module.module_key === 'RISK_ENGINEERING');
  return (riskEngineeringModule?.data?.ratings || {}) as Record<string, unknown>;
}

function getReModuleMissingRequirements(
  moduleInstance: ModuleCompletionShape,
  context?: ModuleCompletionContext,
): string[] {
  const moduleKey = moduleInstance.module_key;
  const data = moduleInstance.data || {};

  if (moduleKey === 'RISK_ENGINEERING' || moduleKey === 'RE_14_DRAFT_OUTPUTS') {
    return [];
  }

  if (moduleKey === 'RE_01_DOC_CONTROL' || moduleKey === 'RE_01_DOCUMENT_CONTROL') {
    const missing: string[] = [];
    if (!hasMeaningfulValue(data?.client_site?.site)) missing.push('Complete required field: Site');
    if (!hasMeaningfulValue(data?.assessor?.name)) missing.push('Complete required field: Assessor');
    if (!hasMeaningfulValue(data?.dates?.assessment_date)) missing.push('Complete required field: Date');
    return missing;
  }

  if (moduleKey === 'RE_02_CONSTRUCTION') {
    const buildings = Array.isArray(data?.construction?.buildings)
      ? data.construction.buildings
      : Array.isArray(data?.buildings)
        ? data.buildings
        : [];

    if (buildings.length === 0) {
      return ['Add at least one building'];
    }

    const hasBuildingWithRequiredFields = buildings.some((building) => {
      const areaCandidates = [
        building?.roof?.area_sqm,
        building?.floor_area_sqm,
        building?.footprint_m2,
      ];
      const hasArea = areaCandidates.some((value) => typeof value === 'number' && value > 0);
      const hasConstructionType = hasMeaningfulValue(building?.frame_type);
      return hasArea && hasConstructionType;
    });

    return hasBuildingWithRequiredFields ? [] : ['Complete construction details (area + construction type)'];
  }

  const ratings = getRiskEngineeringRatings(context);

  if (moduleKey === 'RE_03_OCCUPANCY') {
    const hasIndustry = hasMeaningfulValue(data?.industry_key) || hasMeaningfulValue(data?.occupancy?.process_overview);
    const hasAnyRating = Object.keys(ratings).length > 0;
    return hasIndustry && hasAnyRating ? [] : ['Complete all required ratings'];
  }

  if (moduleKey === 'RE_06_FIRE_PROTECTION') {
    const required = ['fire_protection_water_supply_reliability', 'fire_protection_automatic_suppression'];
    return required.every((key) => hasRating(ratings, key)) ? [] : ['Complete all required ratings'];
  }

  if (moduleKey === 'RE_07_NATURAL_HAZARDS') {
    const required = ['exposures_flood', 'exposures_wind_storm', 'exposures_earthquake', 'exposures_wildfire', 'exposures_human_malicious'];
    return required.every((key) => hasRating(ratings, key)) ? [] : ['Complete all required ratings'];
  }

  if (moduleKey === 'RE_08_UTILITIES') {
    const required = ['electrical_and_utilities_reliability', 'critical_equipment_reliability'];
    return required.every((key) => hasRating(ratings, key)) ? [] : ['Complete all required ratings'];
  }

  if (moduleKey === 'RE_09_MANAGEMENT') {
    const required = [
      'management_housekeeping',
      'management_hot_work',
      'management_impairment_management',
      'management_contractor_control',
      'management_maintenance',
      'management_emergency_planning',
      'management_change_management',
    ];
    return required.every((key) => hasRating(ratings, key)) ? [] : ['Complete all required ratings'];
  }

  if (moduleKey === 'RE_12_LOSS_VALUES') {
    const hasPropertyDamageValue = hasMeaningfulValue(data?.sums_insured?.property_damage?.buildings_improvements)
      || hasMeaningfulValue(data?.sums_insured?.property_damage?.plant_machinery_contents)
      || hasMeaningfulValue(data?.sums_insured?.property_damage?.stock_wip)
      || hasMeaningfulValue(data?.sums_insured?.property_damage?.computers)
      || hasMeaningfulValue(data?.sums_insured?.property_damage?.other);
    const hasBusinessInterruptionValue = hasMeaningfulValue(data?.sums_insured?.business_interruption?.gross_profit_annual)
      || hasMeaningfulValue(data?.sums_insured?.business_interruption?.aicow)
      || hasMeaningfulValue(data?.sums_insured?.business_interruption?.loss_of_rent)
      || hasMeaningfulValue(data?.sums_insured?.business_interruption?.other);

    return hasPropertyDamageValue && hasBusinessInterruptionValue
      ? []
      : ['Complete required loss/value fields'];
  }

  if (moduleKey === 'RE_13_RECOMMENDATIONS') {
    return [];
  }

  return [];
}

export function getModuleCompletionDetails(
  moduleInstance: ModuleCompletionShape,
  context?: ModuleCompletionContext,
): ModuleCompletionDetails {
  if (!moduleInstance) {
    return { state: 'untouched', missingRequirements: [] };
  }

  if (moduleInstance.module_key === 'RISK_ENGINEERING') {
    return { state: 'untouched', missingRequirements: [] };
  }

  if (isReModule(moduleInstance.module_key)) {
    const missingRequirements = getReModuleMissingRequirements(moduleInstance, context);
    if (missingRequirements.length === 0) {
      return { state: 'complete', missingRequirements: [] };
    }

    const started = hasMeaningfulReUserInput(moduleInstance.data);
    return {
      state: started ? 'incomplete' : 'untouched',
      missingRequirements,
    };
  }

  const resolvedOutcome = resolveSectionAssessmentOutcome(moduleInstance);
  const hasExplicitCompletion = (
    (typeof resolvedOutcome === 'string' && resolvedOutcome.trim().length > 0)
    || (typeof moduleInstance.completed_at === 'string' && moduleInstance.completed_at.length > 0)
  );

  if (hasExplicitCompletion) {
    return { state: 'complete', missingRequirements: [] };
  }

  return {
    state: hasMeaningfulValue(moduleInstance.data) ? 'incomplete' : 'untouched',
    missingRequirements: [],
  };
}

export function isModuleStartedForUi(moduleInstance: ModuleCompletionShape): boolean {
  if (!moduleInstance) return false;
  return getModuleCompletionDetails(moduleInstance).state !== 'untouched';
}
