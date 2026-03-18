export const RE_RECOMMENDATIONS_REGISTER_MODULE_KEYS = new Set([
  'RE_13_RECOMMENDATIONS',
]);

export const RE_MODULE_KEYS_WITHOUT_RECOMMENDATION_WORKFLOW = new Set([
  'RE_12_LOSS_VALUES',
  'RE_10_SITE_PHOTOS',
  'RE_10_PROCESS_RISK',
]);

export const RE_MODULE_KEYS_FORCE_DOCUMENT_RECOMMENDATION_SCOPE = new Set([
  'RISK_ENGINEERING',
  'RE_14_DRAFT_OUTPUTS',
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

export const hasReRecommendationWorkflow = (moduleKey?: string | null): boolean => (
  Boolean(moduleKey?.startsWith('RE_') && !RE_MODULE_KEYS_WITHOUT_RECOMMENDATION_WORKFLOW.has(moduleKey))
);

export const shouldForceDocumentRecommendationScope = (moduleKey?: string | null): boolean => (
  Boolean(
    isReRecommendationsRegisterModule(moduleKey)
    || (moduleKey && RE_MODULE_KEYS_FORCE_DOCUMENT_RECOMMENDATION_SCOPE.has(moduleKey))
  )
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
