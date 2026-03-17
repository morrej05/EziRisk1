export type Re04EngineeringGroup = 'adequacy' | 'reliability' | 'localised';

export interface Re04EngineeringQuestionDefinition {
  id: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9' | 'Q10' | 'Q11' | 'Q12' | 'Q13';
  factorKey: string;
  group: Re04EngineeringGroup;
  prompt: string;
  weight: number;
}

export const RE04_LOCALISED_REQUIRED_FACTOR_KEY = 're06_fp_localised_required';
export const RE04_LOCALISED_INSTALLED_FACTOR_KEY = 're06_fp_localised_installed';

export const RE04_ENGINEERING_QUESTIONS: Re04EngineeringQuestionDefinition[] = [
  {
    id: 'Q1',
    factorKey: 're06_fp_adequacy_sprinkler_design_hazard',
    group: 'adequacy',
    prompt: 'Is the sprinkler system designed for the current hazard and storage configuration?',
    weight: 1,
  },
  {
    id: 'Q2',
    factorKey: 're06_fp_adequacy_sprinkler_coverage',
    group: 'adequacy',
    prompt: 'Does the sprinkler system provide adequate coverage for all areas requiring protection?',
    weight: 1,
  },
  {
    id: 'Q3',
    factorKey: 're06_fp_adequacy_water_hydraulic_demand',
    group: 'adequacy',
    prompt: 'Is the water supply capable of meeting the hydraulic demand of the sprinkler system?',
    weight: 1,
  },
  {
    id: 'Q4',
    factorKey: 're06_fp_adequacy_water_duration',
    group: 'adequacy',
    prompt: 'Can the water supply sustain sprinkler discharge for the required duration?',
    weight: 1,
  },
  {
    id: 'Q5',
    factorKey: 're06_fp_adequacy_impairment_conditions',
    group: 'adequacy',
    prompt: 'Are there installation or operational conditions that could impair sprinkler performance?',
    weight: 1,
  },
  {
    id: 'Q6',
    factorKey: 're06_fp_reliability_primary_water_source',
    group: 'reliability',
    prompt: 'How reliable is the primary water source supplying the system?',
    weight: 1,
  },
  {
    id: 'Q7',
    factorKey: 're06_fp_reliability_pumps_power',
    group: 'reliability',
    prompt: 'How reliable is the fire pump arrangement supplying the sprinkler system?',
    weight: 1,
  },
  {
    id: 'Q8',
    factorKey: 're06_fp_reliability_itm_programme',
    group: 'reliability',
    prompt: 'Is the sprinkler system subject to a structured ITM programme?',
    weight: 1,
  },
  {
    id: 'Q9',
    factorKey: 're06_fp_reliability_third_party_inspection',
    group: 'reliability',
    prompt: 'Is the system periodically inspected by a third party?',
    weight: 1,
  },
  {
    id: 'Q10',
    factorKey: 're06_fp_reliability_impairment_management',
    group: 'reliability',
    prompt: 'How effectively are sprinkler impairments controlled and managed?',
    weight: 1,
  },
  {
    id: 'Q11',
    factorKey: 're06_fp_localised_hazard_match',
    group: 'localised',
    prompt: 'Suitability of protection — Is the localised protection appropriate for the specific hazard and process conditions?',
    weight: 1,
  },
  {
    id: 'Q12',
    factorKey: 're06_fp_localised_shutdown_response',
    group: 'localised',
    prompt: 'System integration and shutdown functions — Does activation of the local protection system initiate appropriate shutdown actions?',
    weight: 1,
  },
  {
    id: 'Q13',
    factorKey: 're06_fp_localised_itm_reliability',
    group: 'localised',
    prompt: 'Maintenance and reliability of local protection — Is the local protection system inspected, tested, and maintained as part of a structured maintenance programme?',
    weight: 1,
  },
];

export const RE04_ENGINEERING_QUESTIONS_BY_GROUP = {
  adequacy: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'adequacy'),
  reliability: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'reliability'),
  localised: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'localised'),
};
