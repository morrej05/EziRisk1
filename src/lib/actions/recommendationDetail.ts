export interface RecommendationDetail {
  schema_version?: number;
  observation?: string | null;
  consequence?: string | null;
  recommendation?: string | null;
  rationale?: string | null;
  standards_reference?: string | null;
  timeframe_guidance?: string | null;
  existing_controls?: string | null;
  evidence_notes?: string | null;
  linked_module?: string | null;
  assessor_commentary?: string | null;
  management_response?: string | null;
  status_notes?: string | null;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const EMPTY_RECOMMENDATION_DETAIL: RecommendationDetail = {
  schema_version: 1,
  observation: '',
  consequence: '',
  recommendation: '',
  rationale: '',
  standards_reference: '',
  timeframe_guidance: '',
  existing_controls: '',
  evidence_notes: '',
  linked_module: '',
  assessor_commentary: '',
  management_response: '',
  status_notes: '',
  sectionKey: '',
  sectionLabel: '',
  sourceKey: '',
  sourceLabel: '',
  category: '',
  metadata: null,
};

export function normalizeRecommendationDetail(value: unknown): RecommendationDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_RECOMMENDATION_DETAIL };
  }

  const source = value as Record<string, unknown>;
  const read = (key: keyof RecommendationDetail): string => {
    const raw = source[key];
    return typeof raw === 'string' ? raw : '';
  };

  return {
    schema_version: typeof source.schema_version === 'number' ? source.schema_version : 1,
    observation: read('observation'),
    consequence: read('consequence'),
    recommendation: read('recommendation'),
    rationale: read('rationale'),
    standards_reference: read('standards_reference'),
    timeframe_guidance: read('timeframe_guidance'),
    existing_controls: read('existing_controls'),
    evidence_notes: read('evidence_notes'),
    linked_module: read('linked_module'),
    assessor_commentary: read('assessor_commentary'),
    management_response: read('management_response'),
    status_notes: read('status_notes'),
    sectionKey: read('sectionKey'),
    sectionLabel: read('sectionLabel'),
    sourceKey: read('sourceKey'),
    sourceLabel: read('sourceLabel'),
    category: read('category'),
    metadata: typeof source.metadata === 'object' && source.metadata !== null && !Array.isArray(source.metadata)
      ? (source.metadata as Record<string, unknown>)
      : null,
  };
}

export function compactRecommendationDetail(value: RecommendationDetail): RecommendationDetail | null {
  const normalized = normalizeRecommendationDetail(value);
  const compacted: RecommendationDetail = { schema_version: normalized.schema_version || 1 };

  for (const key of Object.keys(EMPTY_RECOMMENDATION_DETAIL) as Array<keyof RecommendationDetail>) {
    if (key === 'schema_version') continue;
    if (key === 'metadata') {
      if (normalized.metadata && Object.keys(normalized.metadata).length > 0) {
        compacted.metadata = normalized.metadata;
      }
      continue;
    }

    const text = String(normalized[key] || '').trim();
    if (text) {
      compacted[key] = text;
    }
  }

  return Object.keys(compacted).length > 1 ? compacted : null;
}

export function hasRecommendationDetail(value: unknown): boolean {
  return compactRecommendationDetail(normalizeRecommendationDetail(value)) !== null;
}

export function getRecommendationFindingText(action: {
  recommended_action?: string | null;
  trigger_text?: string | null;
  recommendation_detail?: unknown;
}): string {
  const detail = normalizeRecommendationDetail(action.recommendation_detail);
  return (
    String(detail.observation || '').trim() ||
    String(detail.consequence || '').trim() ||
    String(action.trigger_text || '').trim() ||
    String(action.recommended_action || '').trim()
  );
}

export function getRecommendationActionText(action: {
  recommended_action?: string | null;
  recommendation_detail?: unknown;
}): string {
  const detail = normalizeRecommendationDetail(action.recommendation_detail);
  return String(detail.recommendation || '').trim() || String(action.recommended_action || '').trim();
}
