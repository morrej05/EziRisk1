export const RE_RECOMMENDATIONS_REGISTER_MODULE_KEYS = new Set([
  'RE_13_RECOMMENDATIONS',
]);

export interface ReRecommendationRow {
  module_instance_id: string | null;
}

interface FilterReRecommendationsParams {
  scope: 'module' | 'document';
  moduleInstanceId?: string | null;
  isRegisterModule?: boolean;
}

export const isReRecommendationsRegisterModule = (moduleKey?: string | null): boolean => (
  Boolean(moduleKey && RE_RECOMMENDATIONS_REGISTER_MODULE_KEYS.has(moduleKey))
);

export const filterReRecommendationsByScope = <T extends ReRecommendationRow>(
  recommendations: T[],
  params: FilterReRecommendationsParams,
): T[] => {
  const { scope, moduleInstanceId, isRegisterModule = false } = params;

  if (scope === 'document' || isRegisterModule) {
    return recommendations;
  }

  if (!moduleInstanceId) {
    return [];
  }

  return recommendations.filter((recommendation) => recommendation.module_instance_id === moduleInstanceId);
};

