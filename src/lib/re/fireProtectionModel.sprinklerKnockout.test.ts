import { describe, expect, it } from 'vitest';
import {
  applySprinklerInstalledBranch,
  getRe06SprinklerKnockoutBranch,
  normalizeSprinklersInstalled,
  normalizeSprinklersWarranted,
  type BuildingSprinklerData,
} from './fireProtectionModel';

describe('RE06 sprinkler knockout branch', () => {
  it.each([
    ['Yes', true, false, false],
    ['Partial', true, false, false],
    ['No', false, true, false],
    ['Unknown', false, false, true],
  ] as const)(
    'maps Q1=%s to the expected rendered branch flags',
    (status, showDetailQuestions, showWarrantedQuestion, showUnknownConfirmationNotes) => {
      expect(getRe06SprinklerKnockoutBranch(status)).toMatchObject({
        status,
        showDetailQuestions,
        showWarrantedQuestion,
        showUnknownConfirmationNotes,
      });
    }
  );

  it('normalizes legacy/lower-case Q1 and warranted values before branching', () => {
    expect(normalizeSprinklersInstalled('partial')).toBe('Partial');
    expect(normalizeSprinklersInstalled(false)).toBe('No');
    expect(normalizeSprinklersWarranted('unsure')).toBe('Unknown');

    expect(getRe06SprinklerKnockoutBranch('no', 'yes')).toMatchObject({
      status: 'No',
      showDetailQuestions: false,
      showWarrantedQuestion: true,
      showWarrantedCommentary: true,
      showUnknownConfirmationNotes: false,
    });
  });

  it('clears stale detail and warranted state when Q1 changes branches', () => {
    const previous: BuildingSprinklerData = {
      sprinklers_installed: 'Yes',
      sprinklers_warranted: 'Yes',
      no_sprinklers_commentary: 'stale warranted note',
      unknown_status_notes: 'stale unknown note',
      sprinkler_coverage_installed_pct: 80,
      sprinkler_coverage_required_pct: 100,
      system_type: 'Wet pipe',
      standard: 'EN 12845',
      standard_other: 'legacy standard note',
      localised_required: 'Yes',
      localised_present: 'No',
      localised_type: 'Gas suppression',
      localised_protected_asset: 'Spray booth',
      localised_comments: 'stale localised detail',
      hazard_class: 'OH3',
      density_area: '5mm/min over 216m²',
      pressure: '2 bar',
      number_of_heads: '12',
      sprinkler_adequacy: 'Adequate',
      maintenance_status: 'Good',
      final_active_score_1_5: 4,
      sprinkler_score_1_5: 4,
    };

    expect(applySprinklerInstalledBranch(previous, 'No')).toMatchObject({
      sprinklers_installed: 'No',
      sprinklers_warranted: 'Yes',
      unknown_status_notes: '',
      sprinkler_coverage_installed_pct: null,
      sprinkler_coverage_required_pct: null,
      system_type: 'Unknown',
      standard: undefined,
      standard_other: '',
      localised_required: 'Unknown',
      localised_present: 'Unknown',
      localised_type: '',
      localised_protected_asset: '',
      localised_comments: '',
      hazard_class: '',
      density_area: '',
      pressure: '',
      number_of_heads: '',
      sprinkler_adequacy: 'Unknown',
      maintenance_status: 'Unknown',
    });

    expect(applySprinklerInstalledBranch(previous, 'Unknown')).toMatchObject({
      sprinklers_installed: 'Unknown',
      sprinklers_warranted: undefined,
      no_sprinklers_commentary: '',
      sprinkler_coverage_installed_pct: null,
      sprinkler_coverage_required_pct: null,
      localised_required: 'Unknown',
      localised_present: 'Unknown',
    });

    expect(applySprinklerInstalledBranch(previous, 'Partial')).toMatchObject({
      sprinklers_installed: 'Partial',
      sprinklers_warranted: undefined,
      no_sprinklers_commentary: '',
      unknown_status_notes: '',
      sprinkler_coverage_installed_pct: 80,
      sprinkler_coverage_required_pct: 100,
    });
  });
});
