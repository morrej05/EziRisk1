import type { AutoRecommendationLifecycleState } from './recommendations/recommendationPipeline';

export interface Re06AutoRecommendationSyncInput {
  buildingId: string;
  canonicalKey: string;
  rating_1_5: number;
  kind: 'localised_knockout' | 'sprinklers_warranted_absent';
}

export interface Re06BuildingSyncResult {
  buildingId: string;
  lifecycleState: AutoRecommendationLifecycleState;
}

export function collectRe06AutoRecommendationSyncInputs(
  buildings: Record<string, any> | null | undefined,
): Re06AutoRecommendationSyncInput[] {
  return Object.entries(buildings || {}).flatMap(([buildingId, buildingData]) => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const localisedKnockoutFailed = sprinklerData.localised_required === 'Yes' && sprinklerData.localised_present === 'No';
    const sprinklersWarrantedAbsent = sprinklerData.sprinklers_installed === 'No' && sprinklerData.sprinklers_warranted === 'Yes';

    return [
      {
        buildingId,
        canonicalKey: `re06_fp_localised_required_installation:${buildingId}`,
        rating_1_5: localisedKnockoutFailed ? 1 : 5,
        kind: 'localised_knockout' as const,
      },
      {
        buildingId,
        canonicalKey: `re06_fp_sprinklers_warranted_absent:${buildingId}`,
        rating_1_5: sprinklersWarrantedAbsent ? 1 : 5,
        kind: 'sprinklers_warranted_absent' as const,
      },
    ];
  });
}
