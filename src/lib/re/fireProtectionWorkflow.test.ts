import { describe, expect, it } from 'vitest';
import { collectRe06AutoRecommendationSyncInputs } from './fireProtectionWorkflow';

describe('collectRe06AutoRecommendationSyncInputs', () => {
  it('creates low-rated scoped inputs for localised protection knockout and warranted absent sprinklers', () => {
    const inputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { localised_required: 'Yes', localised_present: 'No', sprinklers_installed: 'No', sprinklers_warranted: 'Yes' } },
    });

    expect(inputs).toEqual([
      {
        buildingId: 'b1',
        canonicalKey: 're06_fp_localised_required_installation:b1',
        rating_1_5: 1,
        kind: 'localised_knockout',
      },
      {
        buildingId: 'b1',
        canonicalKey: 're06_fp_sprinklers_warranted_absent:b1',
        rating_1_5: 1,
        kind: 'sprinklers_warranted_absent',
      },
    ]);
  });

  it('keeps generate-once lifecycle calls harmless when knockout conditions are not failed', () => {
    const inputs = collectRe06AutoRecommendationSyncInputs({
      b1: { sprinklerData: { localised_required: 'Yes', localised_present: 'Yes', sprinklers_installed: 'Yes', sprinklers_warranted: 'No' } },
    });

    expect(inputs.map((input) => input.rating_1_5)).toEqual([5, 5]);
  });
});
