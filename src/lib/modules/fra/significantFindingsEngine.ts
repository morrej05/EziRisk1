import {
  deriveExecutiveOutcome,
  checkMaterialDeficiency,
  type FraExecutiveOutcome,
  type FraPriority,
  type FraContext,
  type FraFindingCategory,
} from './severityEngine';
import type { FraComplexityBand } from './complexityEngine';

export interface FraTopIssue {
  title: string;
  priority: FraPriority;
  triggerText?: string;
  category?: FraFindingCategory;
}

export interface FraComputedSummary {
  computedOutcome: FraExecutiveOutcome;
  counts: {
    p1: number;
    p2: number;
    p3: number;
    p4: number;
  };
  topIssues: FraTopIssue[];
  materialDeficiency: boolean;
  toneParagraph: string;
}

export interface ActionForComputation {
  title?: string;
  priority?: string | null;
  priority_band?: string | null;
  action_priority?: string | null;
  severity?: string | null;
  severity_tier?: string | null;
  severityTier?: string | null;
  category?: FraFindingCategory;
  trigger_text?: string;
  status?: string | null;
}

export function normalizeFraPriority(action: ActionForComputation): FraPriority {
  const rawPriority = String(
    action.priority ??
    action.priority_band ??
    action.action_priority ??
    action.severity ??
    action.severity_tier ??
    action.severityTier ??
    ''
  ).trim().toLowerCase();

  if (['p1', 'priority 1', 'priority1', 'high', 'urgent', 'critical', 't4'].includes(rawPriority)) return 'P1';
  if (['p2', 'priority 2', 'priority2', 'medium-high', 'high-medium', 't3'].includes(rawPriority)) return 'P2';
  if (['p3', 'priority 3', 'priority3', 'medium', 'moderate', 't2'].includes(rawPriority)) return 'P3';
  if (['p4', 'priority 4', 'priority4', 'low', 't1'].includes(rawPriority)) return 'P4';

  return 'P4';
}

const PRIORITY_ORDER: Record<FraPriority, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

const HIGH_PRIORITY_CATEGORIES: FraFindingCategory[] = [
  'MeansOfEscape',
  'DetectionAlarm',
  'Compartmentation',
];

function generateToneParagraph(
  scsBand: FraComplexityBand,
  occupancyRisk: 'NonSleeping' | 'Sleeping' | 'Vulnerable',
  outcome: FraExecutiveOutcome
): string {
  const complexityContext = (() => {
    switch (scsBand) {
      case 'VeryHigh':
        return 'The premises comprises a complex building with significant reliance on structural and active fire protection systems. Effective maintenance and management controls are critical.';
      case 'High':
        return 'The building presents structural and occupancy complexity which increases reliance on fire protection measures.';
      case 'Moderate':
        return 'The building has moderate complexity requiring appropriate fire safety provisions.';
      case 'Low':
      default:
        return 'The premises presents a relatively straightforward fire safety context.';
    }
  })();

  const occupancyContext = (() => {
    switch (occupancyRisk) {
      case 'Vulnerable':
        return ' The presence of vulnerable occupants increases the criticality of maintaining robust fire safety systems.';
      case 'Sleeping':
        return ' As sleeping accommodation, occupants may be less alert to fire cues, requiring higher standards of detection and alarm provision.';
      case 'NonSleeping':
      default:
        return '';
    }
  })();

  const outcomeContext = (() => {
    switch (outcome) {
      case 'MaterialLifeSafetyRiskPresent':
        return ' Material life safety deficiencies have been identified which require immediate attention.';
      case 'SignificantDeficiencies':
        return ' Significant deficiencies have been identified which require prompt remedial action.';
      case 'ImprovementsRequired':
        return ' Improvements are required to achieve compliance with fire safety standards.';
      case 'SatisfactoryWithImprovements':
      default:
        return ' Overall, fire safety arrangements are satisfactory subject to the improvements identified.';
    }
  })();

  return `${complexityContext}${occupancyContext}${outcomeContext}`;
}

function sortActions(
  actions: ActionForComputation[],
  scsBand: FraComplexityBand
): ActionForComputation[] {
  const highComplexity = scsBand === 'High' || scsBand === 'VeryHigh';

  return [...actions].sort((a, b) => {
    const aPriority = normalizeFraPriority(a);
    const bPriority = normalizeFraPriority(b);

    const priorityDiff = PRIORITY_ORDER[aPriority] - PRIORITY_ORDER[bPriority];
    if (priorityDiff !== 0) return priorityDiff;

    if (highComplexity) {
      const aIsHighPriorityCat = HIGH_PRIORITY_CATEGORIES.includes(
        a.category as FraFindingCategory
      );
      const bIsHighPriorityCat = HIGH_PRIORITY_CATEGORIES.includes(
        b.category as FraFindingCategory
      );

      if (aIsHighPriorityCat && !bIsHighPriorityCat) return -1;
      if (!aIsHighPriorityCat && bIsHighPriorityCat) return 1;
    }

    return 0;
  });
}

export function computeFraSummary(context: {
  actions: ActionForComputation[];
  scsBand: FraComplexityBand;
  fraContext: FraContext;
}): FraComputedSummary {
  const { actions, scsBand, fraContext } = context;

  const currentActions = actions;

  const counts = {
    p1: currentActions.filter((a) => normalizeFraPriority(a) === 'P1').length,
    p2: currentActions.filter((a) => normalizeFraPriority(a) === 'P2').length,
    p3: currentActions.filter((a) => normalizeFraPriority(a) === 'P3').length,
    p4: currentActions.filter((a) => normalizeFraPriority(a) === 'P4').length,
  };

  const actionsForOutcome = currentActions.map((action) => ({
    ...action,
    priority: normalizeFraPriority(action),
  }));

  const severityActions = actionsForOutcome.map((action) => ({ priority: action.priority as FraPriority }));

  const computedOutcome = deriveExecutiveOutcome(severityActions);

  const materialDefCheck = checkMaterialDeficiency(severityActions, fraContext);
  const materialDeficiency = materialDefCheck.isMaterialDeficiency;

  const sortedActions = sortActions(actionsForOutcome, scsBand);
  const topIssues: FraTopIssue[] = sortedActions.slice(0, 3).map((action) => {
    const priority = normalizeFraPriority(action);
    const showTrigger = priority === 'P1' || priority === 'P2';

    return {
      title: action.title || 'Untitled action',
      priority,
      triggerText: showTrigger ? action.trigger_text : undefined,
      category: action.category,
    };
  });

  const toneParagraph = generateToneParagraph(
    scsBand,
    fraContext.occupancyRisk,
    computedOutcome
  );

  return {
    computedOutcome,
    counts,
    topIssues,
    materialDeficiency,
    toneParagraph,
  };
}
