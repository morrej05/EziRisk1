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

const FACTOR_SPECIFIC_FALLBACKS: Record<string, FallbackContent> = {
  re06_fp_adequacy_sprinkler_coverage: {
    title: 'Align sprinkler design and coverage with hazard profile',
    observation_text: 'Sprinkler arrangement is not fully aligned with current occupancy, storage, or hazard demand.',
    action_required_text: 'Review sprinkler design basis and extend/reconfigure coverage, densities, or zoning to match the hazard profile.',
    hazard_text: 'Under-designed sprinkler protection can allow fire growth beyond controllable limits, increasing damage and downtime.',
  },
  re06_fp_adequacy_hydrants_fire_main: {
    title: 'Improve hydrant and fire main firefighting reach',
    observation_text: 'Hydrant, ring main, or hose reel availability/positioning is not sufficient for reliable firefighting access.',
    action_required_text: 'Survey hydrant/fire main layout and implement upgrades to improve reach, coverage, and operational usability.',
    hazard_text: 'Insufficient firefighting water access can delay attack and increase incident escalation potential.',
  },
  re06_fp_adequacy_water_capacity: {
    title: 'Increase available firewater capacity and duration',
    observation_text: 'Firewater supply volume and/or duration appears below expected design fire demand.',
    action_required_text: 'Validate hydraulic demand and increase usable firewater storage/supply duration to meet design duty.',
    hazard_text: 'Inadequate firewater endurance can cause suppression shortfall during sustained incidents.',
  },
  re06_fp_adequacy_detection_alarm: {
    title: 'Improve detection and alarm coverage for early intervention',
    observation_text: 'Detection/alarm arrangements do not provide consistently adequate early warning coverage.',
    action_required_text: 'Upgrade detection and alarm zones/devices to ensure timely warning in occupied and higher-risk areas.',
    hazard_text: 'Late detection increases fire size at intervention and can materially worsen loss outcomes.',
  },
  re06_fp_adequacy_passive_protection: {
    title: 'Strengthen passive fire protection and compartment integrity',
    observation_text: 'Compartmentation, fire stopping, and/or structural fire protection is not performing to the expected containment standard.',
    action_required_text: 'Undertake a passive fire protection survey and complete remedial works to restore compliant compartment integrity and fire resistance performance.',
    hazard_text: 'Weak passive protection allows uncontrolled fire and smoke spread, increasing property loss and business interruption severity.',
  },
  re06_fp_reliability_water_supply: {
    title: 'Improve reliability of primary and backup firewater supply',
    observation_text: 'Current firewater supply resilience is not sufficient for dependable suppression performance under incident conditions.',
    action_required_text: 'Implement resilient supply arrangements (redundancy, storage, pumping, and resilience controls) and verify duty performance under loss-of-utility scenarios.',
    hazard_text: 'Unreliable firewater availability can compromise suppression effectiveness during critical early incident phases.',
  },
  re06_fp_reliability_pumps_power: {
    title: 'Improve fire pump and power resilience reliability',
    observation_text: 'Pump arrangement, controls, or power resilience measures do not provide confidence in sustained firefighting support.',
    action_required_text: 'Review pump duty/standby strategy, control logic, and emergency power arrangements; rectify deficiencies and validate performance by test.',
    hazard_text: 'Pump or power failure during a fire event can rapidly reduce suppression capability and increase escalation risk.',
  },
  re06_fp_reliability_system_condition: {
    title: 'Address condition-based reliability weaknesses in fire systems',
    observation_text: 'Observed condition, defects, or impairment control evidence indicates reduced reliability of fire protection systems.',
    action_required_text: 'Close outstanding defects, improve impairment management, and reinforce preventive maintenance to restore dependable readiness.',
    hazard_text: 'Latent defects increase the likelihood that protection systems will underperform when demanded by an incident.',
  },
  re06_fp_reliability_testing: {
    title: 'Strengthen fire protection inspection and test assurance',
    observation_text: 'Inspection, testing, and functional evidence is insufficient to demonstrate dependable performance.',
    action_required_text: 'Implement a documented inspection/testing plan with routine functional and flow verification evidence.',
    hazard_text: 'Poor assurance testing increases risk of latent protection failures during an incident.',
  },
  re06_fp_localised_systems_provided: {
    title: 'Provide localised suppression for process-specific hazards',
    observation_text: 'Local application/process-specific suppression is not adequately provided where hazards indicate it is required.',
    action_required_text: 'Identify relevant process/equipment hazards and install suitable localised suppression systems.',
    hazard_text: 'Unprotected localised hazards can develop rapidly and bypass broader area-level controls.',
  },
  re06_fp_localised_hazard_match: {
    title: 'Match localised protection technology to the actual hazard',
    observation_text: 'Installed localised suppression is not fully matched to fire load, fuel type, or process characteristics.',
    action_required_text: 'Review suppression media and discharge strategy to ensure compatibility with protected hazards/processes.',
    hazard_text: 'Mismatch between hazard and suppression method can lead to ineffective control at the point of ignition.',
  },
  re06_fp_localised_coverage_positioning: {
    title: 'Correct localised suppression coverage and nozzle positioning',
    observation_text: 'Localised/special suppression discharge pattern or coverage does not fully protect the identified hazard footprint.',
    action_required_text: 'Reassess protected zones and adjust coverage, nozzle placement, or actuation arrangements to deliver effective hazard interception.',
    hazard_text: 'Inadequate localised coverage can leave ignition points unprotected and permit rapid fire development.',
  },
  re06_fp_localised_itm_reliability: {
    title: 'Improve inspection, testing, and maintenance for localised systems',
    observation_text: 'Inspection and testing evidence for localised suppression systems is insufficient to confirm reliable operation.',
    action_required_text: 'Establish and execute a documented ITM programme with functional testing records and timely defect closure.',
    hazard_text: 'Without reliable ITM assurance, localised systems may fail to actuate or control fire at the point of origin.',
  },
  re06_fp_localised_shutdown_response: {
    title: 'Strengthen shutdown and operator response arrangements',
    observation_text: 'Shutdown, isolation, or operator response controls linked to protected hazards are not sufficiently robust.',
    action_required_text: 'Define and validate emergency shutdown/isolation procedures, roles, and training for hazards requiring localised suppression response.',
    hazard_text: 'Delayed or ineffective operator response can allow process-fed fires to escalate beyond suppression design assumptions.',
  },
  re06_fp_localised_required_installation: {
    title: 'Install required localised/special fire protection',
    observation_text: 'Localised/special protection has been identified as required but is not currently installed.',
    action_required_text: 'Design and install suitable localised/special protection for the identified process/equipment hazards.',
    hazard_text: 'Required point-of-hazard suppression absent: ignition can escalate before site-wide systems can control the event.',
  },
};

function resolveFactorFallback(factorKey: string): FallbackContent | null {
  if (FACTOR_SPECIFIC_FALLBACKS[factorKey]) {
    return FACTOR_SPECIFIC_FALLBACKS[factorKey];
  }

  // Allow building-scoped synthetic factors, e.g. `re06_fp_localised_required_installation:building-id`
  const [baseFactor] = factorKey.split(':');
  if (FACTOR_SPECIFIC_FALLBACKS[baseFactor]) {
    return FACTOR_SPECIFIC_FALLBACKS[baseFactor];
  }

  return null;
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
  const specificFallback = resolveFactorFallback(factorKey);
  if (specificFallback) {
    return specificFallback;
  }

  const factorLabel = humanizeFactorKey(factorKey).replace(/^Re\d+\s+/i, '').trim();

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
