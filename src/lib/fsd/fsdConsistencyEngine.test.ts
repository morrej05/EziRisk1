import { describe, expect, it } from 'vitest';
import { runFsdConsistencyChecks } from './fsdConsistencyEngine';

function module(module_key: string, data: Record<string, any>, outcome: string | null = 'compliant') {
  return { module_key, data, outcome };
}

describe('runFsdConsistencyChecks', () => {
  it('adds stay-put dependency flags when passive evidence is missing', () => {
    const result = runFsdConsistencyChecks({
      modules: [
        module('FSD_2_EVAC_STRATEGY', { evacuation_strategy: 'stay_put' }),
        module('FSD_4_PASSIVE_PROTECTION', {
          compartmentation_strategy: 'Compartmentation present but limited detail.',
          structural_fire_resistance_minutes: '',
          penetrations_fire_stopping_strategy: '',
        }),
      ],
    });

    expect(result.flags.map((f) => f.id)).toContain('CHK-ES-03');
  });

  it('adds sprinkler evidence flag when interface assumptions are missing', () => {
    const result = runFsdConsistencyChecks({
      modules: [
        module('FSD_5_ACTIVE_SYSTEMS', {
          sprinkler_provision: 'yes',
          sprinkler_standard: 'BS EN 12845',
          sprinkler_notes: 'Full building coverage as part of life safety and property protection strategy.',
          interface_dependencies: '',
        }),
      ],
    });

    expect(result.flags.some((f) => f.id === 'CHK-SP-01')).toBe(true);
  });

  it('adds fire-engineered basis checks when deviations/standards/drawings are missing', () => {
    const result = runFsdConsistencyChecks({
      modules: [
        module('FSD_1_REG_BASIS', {
          regulatory_framework: 'fire_engineered',
          deviations: [],
          standards_referenced: [],
          key_assumptions: 'brief',
        }),
        module('FSD_7_DRAWINGS', {
          drawings_checklist: { general_arrangement: true },
          drawings_uploaded: [],
        }),
      ],
    });

    const ids = result.flags.map((f) => f.id);
    expect(ids).toContain('CHK-GD-03');
    expect(ids).toContain('CHK-GD-04');
    expect(ids).toContain('CHK-GD-05');
  });

  it('adds construction phase checks when applicable controls are missing', () => {
    const result = runFsdConsistencyChecks({
      modules: [
        module('FSD_9_CONSTRUCTION_PHASE', {
          construction_phase_applicable: 'yes',
          temporary_means_of_escape: 'unknown',
          fire_plan_exists: 'no',
        }),
      ],
    });

    const ids = result.flags.map((f) => f.id);
    expect(ids).toContain('CHK-CP-01');
    expect(ids).toContain('CHK-CP-02');
  });
});
