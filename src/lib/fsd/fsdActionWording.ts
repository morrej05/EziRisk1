const WEAK_ACTION_TEXTS = new Set([
  '',
  'improvement needed',
  'improvements needed',
  'improvement required',
  'action required',
  'review needed',
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

function stripActionLeadIn(text: string): string {
  return text
    .replace(/^(action\s*[:-]?\s*)/i, '')
    .replace(/^(recommendation\s*[:-]?\s*)/i, '')
    .replace(/^(please\s+)/i, '')
    .trim();
}

function ensureSentenceCase(text: string): string {
  if (!text) return text;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function cleanRecommendedAction(text: string): string {
  const cleaned = ensureSentenceCase(stripActionLeadIn(text)).replace(/\.$/, '');
  if (!cleaned) return '';

  const needsVerbPrefix = !/^(Provide|Confirm|Define|Document|Review|Update|Coordinate|Issue|Complete|Record|Undertake|Align|Verify|Prepare|Submit|Demonstrate)\b/i.test(cleaned);
  const professional = needsVerbPrefix ? `Complete the following design action: ${cleaned}` : cleaned;

  return `${professional}.`;
}

function moduleSpecificFallback(moduleKey?: string | null, ruleTitle?: string, category?: string): string {
  const normalizedRule = (ruleTitle || '').toLowerCase();
  const normalizedCategory = (category || '').toLowerCase();

  switch (moduleKey) {
    case 'FSD_1_REG_BASIS':
      if (normalizedRule.includes('deviation') || normalizedRule.includes('travel distance')) {
        return 'Provide a technical justification for the travel distance deviation and record the compensatory design measures.';
      }
      return 'Document the regulatory basis, design assumptions, and any departures from guidance with supporting technical justification.';
    case 'FSD_2_EVAC_STRATEGY':
      if (normalizedRule.includes('assist') || normalizedCategory.includes('evac')) {
        return 'Define assisted evacuation assumptions and align them with occupancy characteristics and management procedures.';
      }
      return 'Define assisted evacuation assumptions, management procedures, and interface requirements for all relevant occupant groups.';
    case 'FSD_3_ESCAPE_DESIGN':
      return 'Confirm means-of-escape capacity and travel distance compliance against the selected fire strategy approach and occupancy profile.';
    case 'FSD_4_PASSIVE_PROTECTION':
      return 'Provide evidence for compartmentation, fire stopping, and structural fire protection measures supporting the evacuation strategy.';
    case 'FSD_5_ACTIVE_SYSTEMS':
      if (normalizedRule.includes('sprinkler')) {
        return 'Document sprinkler coverage, design basis, and the applicable reference standard.';
      }
      return 'Document active fire system coverage, design basis, cause-and-effect intent, and the applicable reference standards.';
    case 'FSD_6_FRS_ACCESS':
      return 'Confirm fire and rescue service access, facilities, and operational assumptions for fire-fighting and rescue activities.';
    case 'FSD_7_DRAWINGS':
      return 'Issue coordinated fire strategy drawings and schedules that align with the written strategy and current design stage.';
    case 'FSD_8_SMOKE_CONTROL':
      if (normalizedRule.includes('smoke')) {
        return 'Confirm smoke control design basis, coverage areas, and the relevant reference standard.';
      }
      return 'Document smoke control design criteria, control philosophy, and supporting calculations for the affected spaces.';
    case 'FSD_9_CONSTRUCTION_PHASE':
      return 'Confirm temporary means of escape, fire precautions, and phasing controls for the construction period.';
    default:
      return '';
  }
}

export function deriveFsdProfessionalActionText(input: FsdActionWordingInput): string {
  const recommendedAction = (input.recommendedAction || '').trim();
  const normalizedRecommendedAction = recommendedAction.toLowerCase();

  if (recommendedAction && !WEAK_ACTION_TEXTS.has(normalizedRecommendedAction)) {
    return cleanRecommendedAction(recommendedAction);
  }

  const ruleTitle = normalizeRuleTitle(input.triggerText, input.triggerId);
  const moduleFallback = moduleSpecificFallback(input.moduleKey, ruleTitle, input.category);
  if (moduleFallback) return moduleFallback;

  const moduleTitle = (input.moduleTitle || '').trim();
  const category = (input.category || '').trim();

  if (ruleTitle && moduleTitle) {
    return `Address "${ruleTitle}" within ${moduleTitle} by defining the design intent, acceptance criteria, and supporting evidence requirements.`;
  }

  if (moduleTitle && category) {
    return `Define and document ${category.toLowerCase()} requirements for ${moduleTitle}, including design assumptions, interfaces, and verification evidence.`;
  }

  if (moduleTitle) {
    return `Provide a documented fire strategy recommendation for ${moduleTitle}, including scope, technical basis, and required evidence.`;
  }

  if (ruleTitle) {
    return `Address "${ruleTitle}" and provide a clear technical justification with supporting evidence and implementation requirements.`;
  }

  return 'Provide a documented fire strategy recommendation with clear scope, technical basis, implementation requirements, and supporting evidence.';
}
