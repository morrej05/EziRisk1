import { describe, expect, it } from 'vitest';
import { collectRe06AutoRecommendationSyncInputs } from './fireProtectionWorkflow';

describe('collectRe06AutoRecommendationSyncInputs', () => {
  it('creates low-rated scoped inputs for installed/partial localised knockout and warranted absent sprinklers', () => {
    const installedInputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { localised_required: 'Yes', localised_present: 'No', sprinklers_installed: 'Partial' } },
    });

    expect(installedInputs.find((input) => input.kind === 'localised_knockout')).toMatchObject({
      buildingId: 'b1',
      canonicalKey: 're06_fp_localised_required_installation:b1',
      rating_1_5: 1,
      kind: 'localised_knockout',
    });

    const absentInputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'Yes' } },
    });

    expect(absentInputs.find((input) => input.kind === 'sprinklers_warranted_absent')).toMatchObject({
      buildingId: 'b1',
      canonicalKey: 're06_fp_sprinklers_warranted_absent:b1',
      rating_1_5: 1,
      kind: 'sprinklers_warranted_absent',
    });
  });

  it('keeps generate-once lifecycle calls harmless when knockout conditions are not failed', () => {
    const inputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { localised_required: 'Yes', localised_present: 'Yes', sprinklers_installed: 'Yes', sprinklers_warranted: 'No' } },
    });

    expect(inputs.map((input) => input.rating_1_5)).toEqual([5, 5]);
  });

  it('does not keep a stale localised knockout active when Q1 is No or Unknown', () => {
    const inputs = collectRe06AutoRecommendationSyncInputs({
      noSprinklers: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'No', localised_required: 'Yes', localised_present: 'No' } },
      unknownSprinklers: { sprinklerData: { sprinklers_installed: 'Unknown', localised_required: 'Yes', localised_present: 'No' } },
    });

    expect(inputs.filter((input) => input.kind === 'localised_knockout').map((input) => input.rating_1_5)).toEqual([5, 5]);
  });

  it('normalizes the warranted-absent sprinkler recommendation mapper', () => {
    const inputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { sprinklers_installed: 'no', sprinklers_warranted: 'yes' } },
    });

    expect(inputs.find((input) => input.kind === 'sprinklers_warranted_absent')).toMatchObject({
      canonicalKey: 're06_fp_sprinklers_warranted_absent:b1',
      rating_1_5: 1,
    });
  });
});
