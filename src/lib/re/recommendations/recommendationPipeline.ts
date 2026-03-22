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

  re06_fp_adequacy_fixed_protection_required_provided: {
    title: 'Provide/extend fixed protection where hazard warrants it',
    observation_text: 'Areas requiring fixed fire protection are not adequately protected across the current occupancy/process/storage profile.',
    action_required_text: 'Provide or extend fixed fire protection in warranted areas based on occupancy/process/storage hazards and current risk profile.',
    hazard_text: 'Unprotected warranted areas can permit rapid fire growth before intervention, increasing loss severity.',
  },
  re06_fp_adequacy_system_type_hazard_match: {
    title: 'Review protection type/design suitability against actual hazard',
    observation_text: 'Installed protection type/design is not sufficiently matched to the actual occupancy/process/storage hazard.',
    action_required_text: 'Complete an engineering review of system type/design basis and align protection approach to the actual hazard profile.',
    hazard_text: 'A mismatched protection strategy may underperform in real fire conditions and allow escalation.',
  },
  re06_fp_adequacy_critical_area_coverage: {
    title: 'Extend protection to unprotected critical areas',
    observation_text: 'Protection coverage is incomplete across critical risk areas that should be protected.',
    action_required_text: 'Extend protection coverage to currently omitted critical areas (e.g., plant zones, storage, mezzanines, concealed/process areas).',
    hazard_text: 'Critical-area omissions can allow fire development in the least protected zones and increase escalation potential.',
  },
  re06_fp_adequacy_supply_capacity_pressure_duration: {
    title: 'Upgrade extinguishing supply sufficiency',
    observation_text: 'Extinguishing supply capacity/pressure/duration is inadequate or uncertain for expected hazard demand.',
    action_required_text: 'Review and upgrade extinguishing supply capacity, pressure, and duration where inadequate or uncertain.',
    hazard_text: 'Inadequate or uncertain supply can cause suppression underperformance during key incident stages.',
  },
  re06_fp_reliability_pumps_valves_controls_utilities: {
    title: 'Improve pumps/valves/controls/utilities reliability and supervision',
    observation_text: 'Critical pumps, valves, controls, or utility dependencies show reliability vulnerabilities.',
    action_required_text: 'Strengthen reliability of pumps/valves/controls/utilities and improve supervision of critical positions and dependencies.',
    hazard_text: 'Control or utility failures can remove suppression capability when needed most.',
  },
  re06_fp_reliability_itm_standard: {
    title: 'Strengthen documented inspection, testing, maintenance, and defect close-out',
    observation_text: 'ITM arrangements are irregular, incomplete, or weakly evidenced.',
    action_required_text: 'Implement or strengthen formal documented ITM arrangements and timely defect close-out tracking.',
    hazard_text: 'Weak ITM governance can leave latent failures unresolved until an incident.',
  },
  re06_fp_reliability_impairment_fault_escalation: {
    title: 'Strengthen impairment control and alarm/fault escalation',
    observation_text: 'Impairment, fault, isolation, and alarm conditions are not consistently controlled and escalated.',
    action_required_text: 'Implement or strengthen formal impairment management and alarm/fault escalation procedures with tracking to restoration.',
    hazard_text: 'Poor impairment governance can leave protection outages uncontrolled during fire events.',
  },
  re06_fp_localised_required_provided: {
    title: 'Provide or improve localised/special hazard protection',
    observation_text: 'Localised/special hazard protection is absent, limited, or incomplete for identified hazards.',
    action_required_text: 'Provide or improve localised/special hazard protection for identified hazards where required.',
    hazard_text: 'Uncontrolled special hazards can escalate before general area protection can contain the event.',
  },
  re06_fp_localised_reliability_testing_integration: {
    title: 'Improve localised protection testing, maintenance, and integration',
    observation_text: 'Localised protection reliability is weakened by limited testing, maintenance, or system integration assurance.',
    action_required_text: 'Improve testing, maintenance, and integration arrangements for localised protection systems.',
    hazard_text: 'Localised systems may fail on demand if reliability assurance and interfaces are weak.',
  },
  re06_fp_evidence_design_performance_change_control: {
    title: 'Improve documentation, performance evidence, and change-control discipline',
    observation_text: 'Design/performance/change-control evidence is limited or incomplete, reducing confidence in claimed protection standards.',
    action_required_text: 'Improve design/performance documentation, evidence retention, and change-control discipline.',
    hazard_text: 'Weak evidence and change control can conceal degradation and delay risk-reducing corrective actions.',
  },
  re06_fp_adequacy_fixed_protection_provided: {
    title: 'Provide fixed protection where hazard profile warrants it',
    observation_text: 'Areas/processes requiring fixed fire protection are not fully protected with suitable systems.',
    action_required_text: 'Complete a gap assessment of warranted fixed protection by area/process and install or extend systems where required.',
    hazard_text: 'Unprotected warranted areas can permit rapid fire growth before intervention, increasing property and business interruption loss.',
  },
  re06_fp_adequacy_system_suitability: {
    title: 'Align protection technology with occupancy/process/storage hazards',
    observation_text: 'Installed system type/design is not fully suited to the actual hazard characteristics and storage/process conditions.',
    action_required_text: 'Review design basis against current hazards and re-specify system type, density/application criteria, and zoning as needed.',
    hazard_text: 'Unsuitable suppression strategy can underperform at ignition source and allow escalation beyond controllable limits.',
  },
  re06_fp_adequacy_coverage_supply_capacity_duration: {
    title: 'Close suppression coverage and capacity shortfalls',
    observation_text: 'Coverage and/or supply capacity-duration evidence indicates shortfall against credible fire demand.',
    action_required_text: 'Undertake hydraulic/application verification and implement upgrades for coverage, pressure/flow, and discharge endurance.',
    hazard_text: 'Capacity or endurance deficits can lead to loss of suppression effectiveness during critical incident stages.',
  },
  re06_fp_reliability_pumps_valves_controls: {
    title: 'Improve dependability of pumps, valves, and control arrangements',
    observation_text: 'Pumps/valves/controls and utility resilience do not provide sufficient confidence in on-demand operation.',
    action_required_text: 'Rectify reliability weaknesses in pump duty/standby logic, valve supervision, controls, and supporting utilities with functional proving tests.',
    hazard_text: 'Control or utility failures during an incident can remove suppression capability and drive rapid loss escalation.',
  },
  re06_fp_reliability_itm_quality: {
    title: 'Strengthen fire protection inspection, testing, and maintenance quality',
    observation_text: 'Current ITM regime quality and closure discipline are not sufficient to demonstrate dependable system readiness.',
    action_required_text: 'Implement risk-based ITM frequencies, quality assurance checks, and tracked close-out of all defects.',
    hazard_text: 'Weak ITM quality allows latent failures to persist until demand conditions, increasing failure probability during fire events.',
  },
  re06_fp_reliability_impairment_and_fault_monitoring: {
    title: 'Tighten impairment control and fault/alarm supervision',
    observation_text: 'Impairments and fault conditions are not consistently controlled, escalated, and restored within defined timeframes.',
    action_required_text: 'Implement formal impairment permits, compensatory controls, remote/local fault monitoring, and escalation-response KPIs.',
    hazard_text: 'Poor impairment governance can create unrecognized protection outages when a fire occurs.',
  },
  re06_fp_localised_protection_suitability: {
    title: 'Improve suitability of localised/special hazard protection',
    observation_text: 'Localised/special hazard protection does not fully match the protected process/equipment hazard profile.',
    action_required_text: 'Reassess special hazard scenarios and align suppression media, discharge strategy, and protected scope accordingly.',
    hazard_text: 'Mismatched local protection can fail to control high-energy ignition sources before spread to surrounding assets.',
  },
  re06_fp_localised_reliability_integration: {
    title: 'Improve reliability and integration of localised protection',
    observation_text: 'Localised systems show weaknesses in integration logic, functional test assurance, or maintenance reliability.',
    action_required_text: 'Validate detection-actuation-shutdown interfaces and strengthen periodic functional testing and maintenance close-out evidence.',
    hazard_text: 'Integration or reliability failures can prevent localised systems from performing when rapid intervention is essential.',
  },
  re06_fp_evidence_design_and_asset_documentation: {
    title: 'Improve design and coverage evidence quality',
    observation_text: 'Design basis and asset/zone documentation evidence is incomplete, outdated, or insufficient for a high-confidence adequacy judgement.',
    action_required_text: 'Update design basis documents, as-built drawings, hazard-coverage schedules, and engineering assumptions to current conditions.',
    hazard_text: 'Low evidential confidence can mask adequacy gaps and delay corrective action planning.',
  },
  re06_fp_evidence_test_records_and_change_control: {
    title: 'Improve evidential confidence from test records and change control',
    observation_text: 'Test evidence, impairment logs, and change-control records are not sufficiently robust to support high reliability confidence.',
    action_required_text: 'Strengthen record quality, traceability, and management-of-change workflows to maintain reliable assurance over time.',
    hazard_text: 'Poor assurance records increase uncertainty in protection reliability and can conceal emerging control degradation.',
  },
  re06_fp_adequacy_sprinkler_coverage: {
    title: 'Align sprinkler design and coverage with hazard profile',
    observation_text: 'Sprinkler arrangement is not fully aligned with current occupancy, storage, or hazard demand.',
    action_required_text: 'Review sprinkler design basis and extend/reconfigure coverage, densities, or zoning to match the hazard profile.',
    hazard_text: 'Under-designed sprinkler protection can allow fire growth beyond controllable limits, increasing damage and downtime.',
  },
  re06_fp_adequacy_sprinkler_design_hazard: {
    title: 'Align sprinkler design basis with current hazard and storage profile',
    observation_text: 'The sprinkler design basis does not clearly match current process hazards and storage configuration.',
    action_required_text: 'Complete an engineering design-basis review and update sprinkler design criteria to reflect current hazard class, storage geometry, and occupancy changes.',
    hazard_text: 'A design basis mismatch can lead to underperformance during fire events and increased escalation potential.',
  },
  re06_fp_adequacy_hydrants_fire_main: {
    title: 'Improve hydrant and fire main firefighting reach',
    observation_text: 'Hydrant, ring main, or hose reel availability/positioning is not sufficient for reliable firefighting access.',
    action_required_text: 'Survey hydrant/fire main layout and implement upgrades to improve reach, coverage, and operational usability.',
    hazard_text: 'Insufficient firefighting water access can delay attack and increase incident escalation potential.',
  },
  re06_fp_adequacy_water_hydraulic_demand: {
    title: 'Improve firewater capability against sprinkler hydraulic demand',
    observation_text: 'Available water supply does not demonstrate reliable capacity against sprinkler hydraulic demand.',
    action_required_text: 'Verify hydraulic demand and upgrade supply/pumping arrangements so the sprinkler system can meet required flow and pressure conditions.',
    hazard_text: 'Hydraulic under-supply can reduce sprinkler control effectiveness during initial and developing fire stages.',
  },
  re06_fp_adequacy_water_duration: {
    title: 'Increase firewater endurance for required sprinkler discharge duration',
    observation_text: 'Water supply endurance is not assured for the required sprinkler discharge duration.',
    action_required_text: 'Increase usable storage/replenishment resilience and verify endurance calculations against required discharge duration criteria.',
    hazard_text: 'Insufficient water duration can lead to suppression failure before incident control is achieved.',
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
  re06_fp_adequacy_impairment_conditions: {
    title: 'Address installation and operational impairment conditions',
    observation_text: 'Installation or operating conditions are present that could impair sprinkler system performance.',
    action_required_text: 'Identify and rectify impairment-causing conditions (valve states, obstruction risks, process changes, or temporary disablements) and track closure through formal controls.',
    hazard_text: 'Impairment conditions can significantly reduce suppression reliability during critical incident periods.',
  },
  re06_fp_reliability_itm_programme: {
    title: 'Implement a structured sprinkler ITM programme',
    observation_text: 'The sprinkler system is not currently subject to a sufficiently structured inspection, testing, and maintenance programme.',
    action_required_text: 'Establish and enforce a documented ITM programme with defined frequencies, scope, accountability, and evidence retention.',
    hazard_text: 'Without structured ITM, latent defects can accumulate and compromise system performance when needed.',
  },
  re06_fp_reliability_third_party_inspection: {
    title: 'Introduce periodic independent third-party sprinkler inspection',
    observation_text: 'Independent third-party inspection evidence is limited or absent for the sprinkler system.',
    action_required_text: 'Arrange periodic qualified third-party inspections and close out findings through tracked corrective actions.',
    hazard_text: 'Lack of independent assurance can allow critical reliability gaps to remain undetected.',
  },
  re06_fp_reliability_impairment_management: {
    title: 'Strengthen sprinkler impairment control and management',
    observation_text: 'Impairment controls are not consistently effective in managing sprinkler system availability risks.',
    action_required_text: 'Implement formal impairment permits, temporary protection measures, escalation controls, and recovery verification for all sprinkler impairments.',
    hazard_text: 'Weak impairment management increases the chance of major protection shortfalls during fire incidents.',
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

export function resolveFactorFallback(factorKey: string): FallbackContent | null {
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

  if (factorKey.startsWith('re06_fp_')) {
    return {
      title: 'Improve fire protection control reliability and adequacy',
      observation_text:
        'Fire protection control performance for this assessment factor is below the expected engineering standard.',
      action_required_text:
        'Complete a focused engineering review for this fire protection factor and implement corrective measures with accountable owners and target dates.',
      hazard_text:
        'Weak fire protection controls can delay containment and allow incident escalation, increasing damage severity and operational downtime.',
    };
  }

  const factorLabel = humanizeFactorKey(factorKey)
    .replace(/^re\d+_fp_/i, '')
    .replace(/^Re\d+\s+/i, '')
    .trim();

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
      .order('default_priority', { ascending: false });

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
