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
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'section_assessment_outcome' && key !== 'section_assessment_notes')
      .some(([, entry]) => hasMeaningfulValue(entry));
  }

  return false;
}

/**
 * Shared UI completion semantics:
 * - Any explicit outcome/completed_at marks complete (all products)
 * - RE modules also count as complete when they have persisted, meaningful data
 */
export function isModuleCompleteForUi(moduleInstance: ModuleCompletionShape): boolean {
  if (!moduleInstance) return false;

  const resolvedOutcome = resolveSectionAssessmentOutcome(moduleInstance);
  if (typeof resolvedOutcome === 'string' && resolvedOutcome.trim().length > 0) return true;
  if (typeof moduleInstance.completed_at === 'string' && moduleInstance.completed_at.length > 0) return true;

  if (isReModule(moduleInstance.module_key)) {
    return hasMeaningfulValue(moduleInstance.data);
  }

  return false;
}
