import { supabase } from '../../supabase';

interface RecommendationFromRatingParams {
  documentId: string;
  sourceModuleKey: string;
  sourceFactorKey?: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
}

export type AutoRecommendationLifecycleState =
  | 'none'
  | 'created'
  | 'updated'
  | 'restored'
  | 'suppressed';

interface FallbackContent {
  title: string;
  observation_text: string;
  action_required_text: string;
  hazard_text: string;
}

/**
 * Humanize a canonical key into a readable phrase
 */
function humanizeFactorKey(canonicalKey: string): string {
  return canonicalKey
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build fallback content for auto-recommendations when library doesn't provide it.
 * Uses SAME wording for rating 1 and 2 (only priority differs).
 */
function buildFallbackContent(factorKey: string): FallbackContent {
  const factorLabel = humanizeFactorKey(factorKey);

  return {
    title: `Improve ${factorLabel}`,
    observation_text: `${factorLabel} has been identified as requiring attention based on current site conditions. Control effectiveness is below acceptable standards and requires corrective action.`,
    action_required_text: `Review and implement improvements to bring ${factorLabel} up to acceptable standards. Address identified deficiencies through documented corrective actions with clear ownership and target dates.`,
    hazard_text: `Inadequate controls increase the likelihood of loss events escalating beyond planned defenses. A foreseeable incident could develop faster than current safeguards allow, increasing damage extent and recovery time. Strengthening this control reduces overall facility risk profile.`,
  };
}

interface LibraryRecommendation {
  id: string;
  title: string;
  observation_text: string;
  action_required_text: string;
  hazard_text: string;
  priority: 'High' | 'Medium' | 'Low';
  relevance_rules?: {
    modules?: string[];
    factors?: string[];
    industries?: string[];
    min_rating?: number;
    max_rating?: number;
  };
}

/**
 * Ensures ONE auto recommendation is created in re_recommendations table based on a rating.
 * Uses same wording for rating 1 and 2 (only priority differs).
 *
 * @param params - Parameters for creating/ensuring the recommendation
 * @returns The created or existing recommendation ID, or null if no recommendation needed
 */
export async function ensureRecommendationFromRating(
  params: RecommendationFromRatingParams
): Promise<AutoRecommendationLifecycleState> {
  const { documentId, sourceModuleKey, sourceFactorKey, moduleInstanceId, rating_1_5, industryKey } = params;

  // Find all historical rows for this auto recommendation identity.
  const { data: allRows, error: readError } = await supabase
    .from('re_recommendations')
    .select('id, is_suppressed, created_at')
    .eq('document_id', documentId)
    .eq('source_type', 'auto')
    .eq('source_module_key', sourceModuleKey)
    .eq('source_factor_key', sourceFactorKey || null)
    .eq('module_instance_id', moduleInstanceId || null)
    .order('created_at', { ascending: false });

  if (readError) {
    console.error('Error loading auto recommendation rows:', readError);
    return 'none';
  }

  const existingRows = allRows || [];
  const primaryRow = existingRows[0] || null;

  if (existingRows.length > 1) {
    const duplicateIds = existingRows.slice(1).map((row) => row.id);
    if (duplicateIds.length > 0) {
      await supabase
        .from('re_recommendations')
        .update({ is_suppressed: true })
        .in('id', duplicateIds);
    }
  }

  if (rating_1_5 > 2) {
    if (!primaryRow || primaryRow.is_suppressed) {
      return 'none';
    }

    const { error: suppressError } = await supabase
      .from('re_recommendations')
      .update({ is_suppressed: true })
      .eq('id', primaryRow.id);

    if (suppressError) {
      console.error('Error suppressing auto recommendation:', suppressError);
      return 'none';
    }

    return 'suppressed';
  }

  const recommendationPayload = await buildRecommendationPayload({
    sourceModuleKey,
    sourceFactorKey,
    moduleInstanceId,
    rating_1_5,
    industryKey,
  });

  if (primaryRow) {
    const { error: updateError } = await supabase
      .from('re_recommendations')
      .update({
        ...recommendationPayload,
        is_suppressed: false,
      })
      .eq('id', primaryRow.id);

    if (updateError) {
      console.error('Error updating auto recommendation:', updateError);
      return 'none';
    }

    return primaryRow.is_suppressed ? 'restored' : 'updated';
  }

  const created = await createAutoRecommendation({
    documentId,
    moduleInstanceId,
    sourceModuleKey,
    sourceFactorKey,
    recommendationPayload,
  });

  return created ? 'created' : 'none';
}

async function buildRecommendationPayload(params: {
  sourceModuleKey: string;
  sourceFactorKey?: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
}) {
  const { sourceModuleKey, sourceFactorKey, moduleInstanceId, rating_1_5, industryKey } = params;

  // Try to find matching library recommendation
  const libraryTemplate = await findMatchingLibraryRecommendation({
    sourceModuleKey,
    sourceFactorKey,
    moduleInstanceId,
    rating_1_5,
    industryKey,
  });

  const fallback = buildFallbackContent(sourceFactorKey || sourceModuleKey);
  const priority = rating_1_5 === 1 ? 'High' : 'Medium';

  if (libraryTemplate) {
    return {
      library_id: libraryTemplate.id,
      source_module_key: sourceModuleKey,
      source_factor_key: sourceFactorKey || null,
      title: libraryTemplate.title || fallback.title,
      observation_text: libraryTemplate.observation_text || fallback.observation_text,
      action_required_text: libraryTemplate.action_required_text || fallback.action_required_text,
      hazard_text: libraryTemplate.hazard_text || fallback.hazard_text,
      priority,
      status: 'Open',
      photos: [],
    };
  }

  return {
    library_id: null,
    source_module_key: sourceModuleKey,
    source_factor_key: sourceFactorKey || null,
    title: fallback.title,
    observation_text: fallback.observation_text,
    action_required_text: fallback.action_required_text,
    hazard_text: fallback.hazard_text,
    priority,
    status: 'Open',
    photos: [],
  };
}

/**
 * Find a matching recommendation template from the library
 */
async function findMatchingLibraryRecommendation(params: {
  sourceModuleKey: string;
  sourceFactorKey?: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
}): Promise<LibraryRecommendation | null> {
  const { sourceModuleKey, sourceFactorKey, rating_1_5, industryKey } = params;

  try {
    // Query library recommendations with relevance to this module/factor
    const { data: templates, error } = await supabase
      .from('re_recommendation_library')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) {
      console.error('Error querying recommendation library:', error);
      return null;
    }

    if (!templates || templates.length === 0) {
      return null;
    }

    // Find best matching template based on relevance rules
    const typedTemplates = templates as LibraryRecommendation[];
    const matchingTemplate = typedTemplates.find((template) => {
      const rules = template.relevance_rules || {};

      // Check module match
      if (rules.modules && Array.isArray(rules.modules)) {
        if (!rules.modules.includes(sourceModuleKey)) {
          return false;
        }
      }

      // Check factor match
      if (sourceFactorKey && rules.factors && Array.isArray(rules.factors)) {
        if (!rules.factors.includes(sourceFactorKey)) {
          return false;
        }
      }

      // Check rating range
      if (rules.min_rating && rating_1_5 < rules.min_rating) {
        return false;
      }
      if (rules.max_rating && rating_1_5 > rules.max_rating) {
        return false;
      }

      // Check industry match (if specified)
      if (industryKey && rules.industries && Array.isArray(rules.industries)) {
        if (!rules.industries.includes(industryKey)) {
          return false;
        }
      }

      return true;
    });

    return matchingTemplate || null;
  } catch (err) {
    console.error('Error finding library recommendation:', err);
    return null;
  }
}

/**
 * Create a recommendation from a library template
 */
async function createAutoRecommendation(params: {
  documentId: string;
  moduleInstanceId?: string;
  sourceModuleKey: string;
  sourceFactorKey?: string;
  recommendationPayload: Awaited<ReturnType<typeof buildRecommendationPayload>>;
}): Promise<boolean> {
  const { documentId, moduleInstanceId, sourceModuleKey, sourceFactorKey, recommendationPayload } = params;

  const { data, error } = await supabase
    .from('re_recommendations')
    .insert({
      document_id: documentId,
      module_instance_id: moduleInstanceId || null,
      source_type: 'auto',
      source_module_key: sourceModuleKey,
      source_factor_key: sourceFactorKey || null,
      ...recommendationPayload,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating recommendation from library:', error);
    return false;
  }

  return !!data?.id;
}

/**
 * Check if an auto recommendation exists for a given factor
 */
export async function hasAutoRecommendation(
  documentId: string,
  sourceModuleKey: string,
  sourceFactorKey?: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('re_recommendations')
    .select('id')
    .eq('document_id', documentId)
    .eq('source_type', 'auto')
    .eq('source_module_key', sourceModuleKey)
    .eq('source_factor_key', sourceFactorKey || null)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking auto recommendation:', error);
    return false;
  }

  return !!data;
}


export async function syncAutoRecToRegister(params: {
  documentId: string;
  moduleKey: string;
  canonicalKey: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
}): Promise<AutoRecommendationLifecycleState> {
  const { documentId, moduleKey, canonicalKey, moduleInstanceId, rating_1_5, industryKey } = params;

  return ensureRecommendationFromRating({
    documentId,
    sourceModuleKey: moduleKey,          // ✅ correct
    sourceFactorKey: canonicalKey,       // ✅ correct
    moduleInstanceId,
    rating_1_5,
    industryKey,
  });
}
