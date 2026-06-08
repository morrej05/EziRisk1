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
      hazard_class: 'OH3',
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
      hazard_class: '',
      sprinkler_adequacy: 'Unknown',
      maintenance_status: 'Unknown',
    });

    expect(applySprinklerInstalledBranch(previous, 'Unknown')).toMatchObject({
      sprinklers_installed: 'Unknown',
      sprinklers_warranted: undefined,
      no_sprinklers_commentary: '',
      sprinkler_coverage_installed_pct: null,
      sprinkler_coverage_required_pct: null,
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
