const WEAK_ACTION_TEXTS = new Set([
  '',
  'improvement needed',
  'improvements needed',
  'improvement required',
  'action required',
  'review required',
  'tbd',
  'to be confirmed',
  'n/a',
  'na',
  '(no action text provided)',
]);

interface FsdActionWordingInput {
  recommendedAction?: string | null;
  moduleKey?: string | null;
  moduleTitle?: string | null;
  triggerText?: string | null;
  triggerId?: string | null;
  category?: string | null;
}

function normalizeRuleTitle(triggerText?: string | null, triggerId?: string | null): string {
  const fromTriggerText = (triggerText || '').trim();
  if (fromTriggerText) {
    if (fromTriggerText === 'Priority derived from previous assessment model.') return '';
    return fromTriggerText.replace(/\.$/, '');
  }

  const fromTriggerId = (triggerId || '').trim();
  if (!fromTriggerId) return '';

  return fromTriggerId
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function moduleSpecificFallback(moduleKey?: string | null, ruleTitle?: string): string {
  const normalizedRule = (ruleTitle || '').toLowerCase();

  switch (moduleKey) {
    case 'FSD_1_REG_BASIS':
      if (normalizedRule.includes('deviation') || normalizedRule.includes('travel distance')) {
        return 'Provide technical justification for the recorded travel distance deviation.';
      }
      return 'Document the regulatory basis, design assumptions, and any departures from guidance with supporting justification.';
    case 'FSD_2_EVAC_STRATEGY':
      return 'Define assisted evacuation assumptions and align them with occupancy characteristics.';
    case 'FSD_3_ESCAPE_DESIGN':
      return 'Confirm means-of-escape capacity and travel distance compliance against the selected design approach.';
    case 'FSD_4_PASSIVE_PROTECTION':
      return 'Provide evidence of compartmentation strategy to support the stay-put evacuation approach.';
    case 'FSD_5_ACTIVE_SYSTEMS':
      return 'Document sprinkler coverage, design basis, and relevant standard.';
    case 'FSD_6_FRS_ACCESS':
      return 'Confirm fire and rescue service access facilities and document the design assumptions for fire-fighting operations.';
    case 'FSD_7_DRAWINGS':
      return 'Provide coordinated fire strategy drawings and schedules to support design approval and construction delivery.';
    case 'FSD_8_SMOKE_CONTROL':
      return 'Document smoke control design basis, control philosophy, and supporting calculations for the affected areas.';
    case 'FSD_9_CONSTRUCTION_PHASE':
      return 'Confirm temporary means of escape arrangements during the construction phase.';
    default:
      return '';
  }
}

export function deriveFsdProfessionalActionText(input: FsdActionWordingInput): string {
  const recommendedAction = (input.recommendedAction || '').trim();
  const normalizedRecommendedAction = recommendedAction.toLowerCase();

  if (recommendedAction && !WEAK_ACTION_TEXTS.has(normalizedRecommendedAction)) {
    return recommendedAction;
  }

  const ruleTitle = normalizeRuleTitle(input.triggerText, input.triggerId);
  const moduleFallback = moduleSpecificFallback(input.moduleKey, ruleTitle);
  if (moduleFallback) return moduleFallback;

  const moduleTitle = (input.moduleTitle || '').trim();
  const category = (input.category || '').trim();

  if (ruleTitle && moduleTitle) {
    return `Address "${ruleTitle}" in ${moduleTitle} and document the fire strategy basis, assumptions, and evidence.`;
  }

  if (moduleTitle && category) {
    return `Define and document the ${category.toLowerCase()} requirements for ${moduleTitle}, including assumptions and supporting evidence.`;
  }

  if (moduleTitle) {
    return `Provide a documented fire strategy recommendation for ${moduleTitle}, including scope, basis, and supporting evidence.`;
  }

  if (ruleTitle) {
    return `Address "${ruleTitle}" and provide supporting fire strategy justification and evidence.`;
  }

  return 'Provide a documented fire strategy recommendation with clear scope, technical basis, and supporting evidence.';
}
