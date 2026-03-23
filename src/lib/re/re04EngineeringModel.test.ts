import { describe, expect, it } from 'vitest';
import { deriveRe04SupplementaryScores, RE04_ENGINEERING_QUESTIONS } from './re04EngineeringModel';

function rated(factor_key: string, score: number) {
  const q = RE04_ENGINEERING_QUESTIONS.find((item) => item.factorKey === factor_key);
  if (!q) throw new Error(`Missing question for ${factor_key}`);
  return { factor_key, group: q.group, score_1_5: score };
}

describe('deriveRe04SupplementaryScores', () => {
  it('computes weighted pillar and overall scores on 0-4, mapped to 0-5', () => {
    const scores = deriveRe04SupplementaryScores([
      rated('re06_fp_adequacy_fixed_protection_required_provided', 4),
      rated('re06_fp_adequacy_system_type_hazard_match', 3),
      rated('re06_fp_adequacy_critical_area_coverage', 4),
      rated('re06_fp_adequacy_supply_capacity_pressure_duration', 3),
      rated('re06_fp_reliability_pumps_valves_controls_utilities', 3),
      rated('re06_fp_reliability_itm_standard', 3),
      rated('re06_fp_reliability_impairment_fault_escalation', 4),
      rated('re06_fp_localised_required_provided', 4),
      rated('re06_fp_localised_reliability_testing_integration', 3),
      rated('re06_fp_evidence_design_performance_change_control', 3),
    ]);

    expect(scores.adequacy_subscore_raw_0_4).toBe(3.6);
    expect(scores.reliability_subscore_raw_0_4).toBe(3.4);
    expect(scores.localised_subscore_raw_0_4).toBe(3.6);
    expect(scores.evidence_subscore_raw_0_4).toBe(3);
    expect(scores.overall_raw_0_4).toBe(3.4);
    expect(scores.overall_score).toBe(4.3);
  });

  it('excludes localised pillar and renormalises weights when not applicable', () => {
    const scores = deriveRe04SupplementaryScores(
      [
        rated('re06_fp_adequacy_fixed_protection_required_provided', 3),
        rated('re06_fp_adequacy_system_type_hazard_match', 3),
        rated('re06_fp_adequacy_critical_area_coverage', 3),
        rated('re06_fp_adequacy_supply_capacity_pressure_duration', 3),
        rated('re06_fp_reliability_pumps_valves_controls_utilities', 3),
        rated('re06_fp_reliability_itm_standard', 3),
        rated('re06_fp_reliability_impairment_fault_escalation', 3),
        rated('re06_fp_evidence_design_performance_change_control', 3),
      ],
      { includeLocalisedGroup: false }
    );

    expect(scores.localised_subscore_raw_0_4).toBeNull();
    expect(scores.overall_raw_0_4).toBe(3);
    expect(scores.overall_score).toBe(3.8);
  });
});
