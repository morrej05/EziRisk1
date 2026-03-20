import { resolveSectionAssessmentOutcome, type ModuleInstanceAssessmentShape } from './moduleAssessment';

const RE_MODULE_KEY_PREFIX = 'RE_';
const RE_ROOT_MODULE_KEY = 'RISK_ENGINEERING';

interface ModuleCompletionShape extends ModuleInstanceAssessmentShape {
  module_key?: string;
  completed_at?: string | null;
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
  if (!moduleInstance) return false;

  const resolvedOutcome = resolveSectionAssessmentOutcome(moduleInstance);
  if (typeof resolvedOutcome === 'string' && resolvedOutcome.trim().length > 0) return true;
  if (typeof moduleInstance.completed_at === 'string' && moduleInstance.completed_at.length > 0) return true;

  return false;
}

export function isModuleStartedForUi(moduleInstance: ModuleCompletionShape): boolean {
  if (!moduleInstance) return false;
  if (isModuleCompleteForUi(moduleInstance)) return true;

  if (isReModule(moduleInstance.module_key)) {
    return hasMeaningfulReUserInput(moduleInstance.data);
  }

  return hasMeaningfulValue(moduleInstance.data);
}
