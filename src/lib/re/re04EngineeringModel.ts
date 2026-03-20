export type Re04EngineeringGroup = 'adequacy' | 'reliability' | 'localised' | 'evidence';

export interface Re04EngineeringQuestionDefinition {
  id: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9' | 'Q10';
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
    factorKey: 're06_fp_adequacy_fixed_protection_provided',
    group: 'adequacy',
    prompt: 'Where fixed fire protection is warranted by occupancy/process/storage, is it provided at the required locations?',
    weight: 1,
  },
  {
    id: 'Q2',
    factorKey: 're06_fp_adequacy_system_suitability',
    group: 'adequacy',
    prompt: 'Is the selected protection system type/design suitable for the actual occupancy, process hazards, and storage arrangement?',
    weight: 1,
  },
  {
    id: 'Q3',
    factorKey: 're06_fp_adequacy_coverage_supply_capacity_duration',
    group: 'adequacy',
    prompt: 'Are coverage, water/application rate capacity, pressure, and discharge duration adequate for the demand scenario?',
    weight: 1,
  },
  {
    id: 'Q4',
    factorKey: 're06_fp_reliability_pumps_valves_controls',
    group: 'reliability',
    prompt: 'Are pumps, valves, control arrangements, and supporting utilities configured for dependable operation during fire conditions?',
    weight: 1,
  },
  {
    id: 'Q5',
    factorKey: 're06_fp_reliability_itm_quality',
    group: 'reliability',
    prompt: 'Is inspection, testing, and maintenance quality sufficient to demonstrate dependable system readiness?',
    weight: 1,
  },
  {
    id: 'Q6',
    factorKey: 're06_fp_reliability_impairment_and_fault_monitoring',
    group: 'reliability',
    prompt: 'Are impairments tightly controlled and are alarm/fault conditions supervised with timely escalation and restoration?',
    weight: 1,
  },
  {
    id: 'Q7',
    factorKey: 're06_fp_localised_protection_suitability',
    group: 'localised',
    prompt: 'Where localised/special hazard protection is required, is the installed solution suitable for the specific hazard and operating conditions?',
    weight: 1,
  },
  {
    id: 'Q8',
    factorKey: 're06_fp_localised_reliability_integration',
    group: 'localised',
    prompt: 'Is localised/special hazard protection reliably integrated, functionally tested, and maintained to perform on demand?',
    weight: 1,
  },
  {
    id: 'Q9',
    factorKey: 're06_fp_evidence_design_and_asset_documentation',
    group: 'evidence',
    prompt: 'Is there current design basis, zone/asset coverage evidence, and clear documentation supporting adequacy conclusions?',
    weight: 1,
  },
  {
    id: 'Q10',
    factorKey: 're06_fp_evidence_test_records_and_change_control',
    group: 'evidence',
    prompt: 'Do recent test records, impairment logs, and change-control updates provide high confidence in reliability conclusions?',
    weight: 1,
  },
];

export const RE04_ENGINEERING_QUESTIONS_BY_GROUP = {
  adequacy: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'adequacy'),
  reliability: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'reliability'),
  localised: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'localised'),
  evidence: RE04_ENGINEERING_QUESTIONS.filter((q) => q.group === 'evidence'),
};
