export type Re04EngineeringGroup = 'adequacy' | 'reliability' | 'localised' | 'evidence';

export interface Re04AnswerStateDefinition {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
}

export interface Re04EngineeringQuestionDefinition {
  id: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9' | 'Q10';
  factorKey: string;
  group: Re04EngineeringGroup;
  uiLabel: string;
  prompt: string;
  weight: number;
  answerStates: Re04AnswerStateDefinition[];
}

export interface Re04SupplementaryQuestionScore {
  factor_key: string;
  group: Re04EngineeringGroup;
  score_1_5: number | null;
}

export interface Re04DerivedSupplementaryScores {
  adequacy_subscore: number | null;
  reliability_subscore: number | null;
  localised_subscore: number | null;
  evidence_subscore: number | null;
  adequacy_subscore_raw_0_4: number | null;
  reliability_subscore_raw_0_4: number | null;
  localised_subscore_raw_0_4: number | null;
  evidence_subscore_raw_0_4: number | null;
  overall_raw_0_4: number | null;
  overall_score: number | null;
}

export const RE04_LOCALISED_REQUIRED_FACTOR_KEY = 're06_fp_localised_required';
export const RE04_LOCALISED_INSTALLED_FACTOR_KEY = 're06_fp_localised_installed';

const RE04_PILLAR_WEIGHTS: Record<Re04EngineeringGroup, number> = {
  adequacy: 0.4,
  reliability: 0.35,
  localised: 0.1,
  evidence: 0.15,
};

const ROUND_1DP = (value: number): number => Math.round(value * 10) / 10;

const toDisplayScore1to5 = (raw0to4: number): number => ROUND_1DP((raw0to4 / 4) * 5);

export const RE04_ENGINEERING_QUESTIONS: Re04EngineeringQuestionDefinition[] = [
  {
    id: 'Q1',
    factorKey: 're06_fp_adequacy_fixed_protection_required_provided',
    group: 'adequacy',
    uiLabel: 'Fixed protection provided where required',
    prompt: 'Is fixed protection provided wherever occupancy, process, or storage hazards clearly warrant it?',
    weight: 0.25,
    answerStates: [
      { score: 0, label: 'Absent where required', description: 'No fixed protection where clearly required by the hazard.' },
      { score: 1, label: 'Very limited provision', description: 'Fixed protection provided only in isolated areas; major risk areas unprotected.' },
      { score: 2, label: 'Partly provided', description: 'Fixed protection exists but important hazard areas are not adequately protected.' },
      { score: 3, label: 'Broadly provided', description: 'Fixed protection is in the main risk areas and broadly aligned to hazard.' },
      { score: 4, label: 'Fully provided', description: 'Fixed protection is fully provided wherever warranted and aligned to the hazard profile.' },
    ],
  },
  {
    id: 'Q2',
    factorKey: 're06_fp_adequacy_system_type_hazard_match',
    group: 'adequacy',
    uiLabel: 'System type appropriate for the hazard',
    prompt: 'Is the installed protection system type and design basis suitable for the actual occupancy/process/storage hazard?',
    weight: 0.25,
    answerStates: [
      { score: 0, label: 'Clearly unsuitable', description: 'Protection type is clearly unsuitable for the actual hazard.' },
      { score: 1, label: 'Poorly matched', description: 'Protection type is poorly matched and likely inadequate in a fire scenario.' },
      { score: 2, label: 'Partly suitable', description: 'Protection type is only partly suitable or the design basis is unclear.' },
      { score: 3, label: 'Generally suitable', description: 'Protection type is generally suitable for occupancy/process/storage hazards.' },
      { score: 4, label: 'Clearly matched', description: 'Protection type is clearly designed and well matched for the actual hazard profile.' },
    ],
  },
  {
    id: 'Q3',
    factorKey: 're06_fp_adequacy_critical_area_coverage',
    group: 'adequacy',
    uiLabel: 'Coverage complete for critical areas',
    prompt: 'Does protection coverage include all critical risk areas that should be protected?',
    weight: 0.3,
    answerStates: [
      { score: 0, label: 'Major areas unprotected', description: 'Major critical areas are unprotected.' },
      { score: 1, label: 'Significant gaps', description: 'Significant coverage gaps exist across important risk areas.' },
      { score: 2, label: 'Incomplete extent', description: 'Some important areas are unprotected or extent is incomplete.' },
      { score: 3, label: 'Broadly complete', description: 'Coverage is broadly complete with only minor omissions.' },
      { score: 4, label: 'Complete coverage', description: 'Coverage is complete for all critical areas requiring protection.' },
    ],
  },
  {
    id: 'Q4',
    factorKey: 're06_fp_adequacy_supply_capacity_pressure_duration',
    group: 'adequacy',
    uiLabel: 'Extinguishing supply sufficient (capacity/pressure/duration)',
    prompt: 'Is extinguishing supply demonstrably sufficient in capacity, pressure, and duration for expected hazard demand?',
    weight: 0.2,
    answerStates: [
      { score: 0, label: 'Clearly inadequate', description: 'Supply is clearly inadequate for expected hazard demand.' },
      { score: 1, label: 'Likely inadequate', description: 'Supply is likely inadequate or materially vulnerable.' },
      { score: 2, label: 'Uncertain/partial', description: 'Supply adequacy is uncertain or only partly adequate.' },
      { score: 3, label: 'Appears adequate', description: 'Supply appears adequate for expected demand.' },
      { score: 4, label: 'Demonstrably adequate', description: 'Supply is demonstrably adequate with confidence and margin.' },
    ],
  },
  {
    id: 'Q5',
    factorKey: 're06_fp_reliability_pumps_valves_controls_utilities',
    group: 'reliability',
    uiLabel: 'Pumps, valves, controls and utility reliability',
    prompt: 'Are pumps, valves, controls, and utilities arranged to function reliably when needed?',
    weight: 0.3,
    answerStates: [
      { score: 0, label: 'Poor reliability', description: 'Major single-point failure or uncontrolled dependency exists.' },
      { score: 1, label: 'Weak reliability', description: 'Obvious vulnerabilities exist in key components/utilities.' },
      { score: 2, label: 'Partly dependable', description: 'Basic arrangement exists but remains vulnerable.' },
      { score: 3, label: 'Broadly reliable', description: 'Arrangement appears reliable for normal expected service.' },
      { score: 4, label: 'Robust reliability', description: 'Arrangement is robust and protected against likely failure modes.' },
    ],
  },
  {
    id: 'Q6',
    factorKey: 're06_fp_reliability_itm_standard',
    group: 'reliability',
    uiLabel: 'Inspection, testing and maintenance standard',
    prompt: 'Is inspection, testing, and maintenance (ITM) regular, documented, and strong enough to support readiness?',
    weight: 0.35,
    answerStates: [
      { score: 0, label: 'No meaningful ITM', description: 'No meaningful evidence of inspection, testing, or maintenance.' },
      { score: 1, label: 'Irregular/poor ITM', description: 'ITM is irregular, poor, or materially deficient.' },
      { score: 2, label: 'Basic/incomplete ITM', description: 'Basic compliance-style ITM exists but is incomplete or weakly evidenced.' },
      { score: 3, label: 'Regular ITM', description: 'ITM is regular, documented, and broadly appropriate.' },
      { score: 4, label: 'Strong ITM', description: 'ITM is strong, well documented, and gives confidence in readiness.' },
    ],
  },
  {
    id: 'Q7',
    factorKey: 're06_fp_reliability_impairment_fault_escalation',
    group: 'reliability',
    uiLabel: 'Impairment control and fault/alarm escalation',
    prompt: 'Are impairments, faults, isolations, and alarm conditions formally controlled and escalated?',
    weight: 0.35,
    answerStates: [
      { score: 0, label: 'No impairment control', description: 'No impairment/fault control process exists.' },
      { score: 1, label: 'Informal control', description: 'Controls are informal and unlikely to manage outages effectively.' },
      { score: 2, label: 'Basic/inconsistent control', description: 'Some process exists but controls are limited or inconsistent.' },
      { score: 3, label: 'Formal arrangements', description: 'Formal impairment/fault control is in place and broadly followed.' },
      { score: 4, label: 'Strong governance', description: 'Strong control with escalation, tracking, and timely restoration.' },
    ],
  },
  {
    id: 'Q8',
    factorKey: 're06_fp_localised_required_provided',
    group: 'localised',
    uiLabel: 'Localised/special hazard protection provided where required',
    prompt: 'Where localised/special hazard protection is required, is it provided in appropriate form?',
    weight: 0.6,
    answerStates: [
      { score: 0, label: 'Required but absent', description: 'Localised protection is required but none is provided.' },
      { score: 1, label: 'Limited/inappropriate', description: 'Localised protection is present only in limited or inappropriate form.' },
      { score: 2, label: 'Partly suitable', description: 'Localised protection is partly suitable or incomplete for identified hazards.' },
      { score: 3, label: 'Appropriate for main hazards', description: 'Appropriate localised protection is provided for main identified hazards.' },
      { score: 4, label: 'Comprehensive provision', description: 'Appropriate and comprehensive localised protection is provided wherever required.' },
    ],
  },
  {
    id: 'Q9',
    factorKey: 're06_fp_localised_reliability_testing_integration',
    group: 'localised',
    uiLabel: 'Localised protection reliability/testing/integration',
    prompt: 'Where localised/special systems are present, are reliability, testing, and integration arrangements strong?',
    weight: 0.4,
    answerStates: [
      { score: 0, label: 'Poor/unknown reliability', description: 'Reliability is poor or unknown; no meaningful maintenance/testing/integration evidence.' },
      { score: 1, label: 'Weak reliability', description: 'Reliability is weak with poor maintenance, testing, or integration.' },
      { score: 2, label: 'Limited confidence', description: 'Basic arrangements exist but confidence is limited.' },
      { score: 3, label: 'Satisfactory reliability', description: 'Reliability appears satisfactory with maintenance/testing broadly in place.' },
      { score: 4, label: 'Strong reliability', description: 'Reliability is strong, well maintained, tested, and appropriately integrated.' },
    ],
  },
  {
    id: 'Q10',
    factorKey: 're06_fp_evidence_design_performance_change_control',
    group: 'evidence',
    uiLabel: 'Evidence of design, performance and change control',
    prompt: 'How strong is the available evidence base for design intent, performance, and change control confidence?',
    weight: 1,
    answerStates: [
      { score: 0, label: 'No meaningful evidence', description: 'No meaningful design/performance/change-control evidence is available.' },
      { score: 1, label: 'Very limited evidence', description: 'Evidence is very limited, outdated, or unreliable.' },
      { score: 2, label: 'Partial evidence', description: 'Partial evidence exists but confidence is incomplete.' },
      { score: 3, label: 'Adequate evidence', description: 'Adequate evidence supports the claimed protection standard.' },
      { score: 4, label: 'Strong evidence', description: 'Strong evidence exists including design/performance records and change-control confidence.' },
    ],
  },
];

export const RE04_ENGINEERING_QUESTIONS_BY_GROUP = {
  adequacy: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'adequacy'),
  reliability: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'reliability'),
  localised: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'localised'),
  evidence: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'evidence'),
};

function weightedAverageRaw(items: Re04SupplementaryQuestionScore[]): number | null {
  if (!items.length) return null;

  const weights = items.reduce((sum, item) => {
    const definition = RE04_ENGINEERING_QUESTIONS.find((q) => q.factorKey === item.factor_key);
    return sum + (definition?.weight ?? 0);
  }, 0);

  if (weights <= 0) return null;

  const weighted = items.reduce((sum, item) => {
    const definition = RE04_ENGINEERING_QUESTIONS.find((q) => q.factorKey === item.factor_key);
    if (!definition || item.score_1_5 === null) return sum;
    const boundedScore = Math.max(0, Math.min(4, Number(item.score_1_5)));
    return sum + boundedScore * definition.weight;
  }, 0);

  return ROUND_1DP(weighted / weights);
}

export function deriveRe04SupplementaryScores(
  questions: Re04SupplementaryQuestionScore[],
  options?: { includeLocalisedGroup?: boolean }
): Re04DerivedSupplementaryScores {
  const includeLocalisedGroup = options?.includeLocalisedGroup ?? true;
  const rated = questions.filter((q) => q.score_1_5 !== null && q.score_1_5 !== undefined);

  const adequacyRated = rated.filter((q) => q.group === 'adequacy');
  const reliabilityRated = rated.filter((q) => q.group === 'reliability');
  const localisedRated = includeLocalisedGroup ? rated.filter((q) => q.group === 'localised') : [];
  const evidenceRated = rated.filter((q) => q.group === 'evidence');

  const adequacyRaw = weightedAverageRaw(adequacyRated);
  const reliabilityRaw = weightedAverageRaw(reliabilityRated);
  const localisedRaw = weightedAverageRaw(localisedRated);
  const evidenceRaw = weightedAverageRaw(evidenceRated);

  const includedPillars: Array<{ pillar: Re04EngineeringGroup; value: number }> = [];
  if (adequacyRaw !== null) includedPillars.push({ pillar: 'adequacy', value: adequacyRaw });
  if (reliabilityRaw !== null) includedPillars.push({ pillar: 'reliability', value: reliabilityRaw });
  if (includeLocalisedGroup && localisedRaw !== null) includedPillars.push({ pillar: 'localised', value: localisedRaw });
  if (evidenceRaw !== null) includedPillars.push({ pillar: 'evidence', value: evidenceRaw });

  const includedWeight = includedPillars.reduce((sum, pillar) => sum + RE04_PILLAR_WEIGHTS[pillar.pillar], 0);
  const overallRaw0to4 =
    includedWeight > 0
      ? ROUND_1DP(
          includedPillars.reduce((sum, pillar) => sum + pillar.value * RE04_PILLAR_WEIGHTS[pillar.pillar], 0) /
            includedWeight
        )
      : null;

  return {
    adequacy_subscore: adequacyRaw === null ? null : toDisplayScore1to5(adequacyRaw),
    reliability_subscore: reliabilityRaw === null ? null : toDisplayScore1to5(reliabilityRaw),
    localised_subscore: localisedRaw === null ? null : toDisplayScore1to5(localisedRaw),
    evidence_subscore: evidenceRaw === null ? null : toDisplayScore1to5(evidenceRaw),
    adequacy_subscore_raw_0_4: adequacyRaw,
    reliability_subscore_raw_0_4: reliabilityRaw,
    localised_subscore_raw_0_4: localisedRaw,
    evidence_subscore_raw_0_4: evidenceRaw,
    overall_raw_0_4: overallRaw0to4,
    overall_score: overallRaw0to4 === null ? null : toDisplayScore1to5(overallRaw0to4),
  };
}
