import { supabase } from '../../supabase';

interface RecommendationFromRatingParams {
  documentId: string;
  sourceModuleKey: string;
  sourceFactorKey?: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
}

/**
 * 'none'     — no recommendation was created or already existed.
 * 'created'  — a new recommendation was just created for the first time.
 * 'exists'   — a recommendation already exists for this factor; left untouched.
 * 'resolved' — an open recommendation was auto-completed because its data-field
 *              trigger condition is no longer active (e.g. sprinklers_warranted
 *              changed from Yes to No). Only applies to data-assessment recs that
 *              opt in via resolveWhenNotTriggered in syncAutoRecToRegister.
 *
 * 'updated', 'restored', and 'suppressed' are intentionally removed:
 * auto recommendations are now independent records after creation and are
 * never mutated or suppressed by the pipeline except via explicit opt-in.
 */
export type AutoRecommendationLifecycleState = 'none' | 'created' | 'exists' | 'resolved';

interface FallbackContent {
  title: string;
  observation_text: string;
  action_required_text: string;
  hazard_text: string;
}

const FACTOR_SPECIFIC_FALLBACKS: Record<string, FallbackContent> = {

  // Dynamic per-building key: re06_fp_sprinklers_warranted_absent:<buildingId>
  // Matched by prefix — see buildRecommendationPayload prefix-lookup below
  re06_fp_sprinklers_warranted_absent: {
    title: 'Install automatic sprinkler system — warranted protection absent',
    observation_text: 'No automatic sprinkler system is installed in this building, and the occupancy/hazard profile warrants suppression. The absence of automatic sprinklers represents a material protection deficiency.',
    action_required_text: 'Commission a sprinkler system design study and implement automatic sprinkler protection in accordance with the applicable standard (EN 12845, NFPA 13 or equivalent) for the occupancy/hazard present.',
    hazard_text: 'Absence of warranted suppression significantly increases expected fire damage, delays control, and may materially affect property and business interruption loss outcomes.',
  },

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

  // ─── Module-level fallbacks (used when no factor key is provided) ─────────────

  RE_02_CONSTRUCTION: {
    title: 'Improve construction standard to reduce fire and loss escalation potential',
    observation_text: 'The assessed construction standard presents elevated fire spread or structural collapse potential under foreseeable incident conditions.',
    action_required_text: 'Commission a construction fire risk review focusing on frame type, compartmentation, roof/cladding combustibility, and openings. Implement identified improvements with prioritised actions and accountable owners.',
    hazard_text: 'Sub-standard construction can allow rapid structural failure and fire spread to adjacent areas, materially increasing property and business interruption loss severity.',
  },

  RE_03_OCCUPANCY: {
    title: 'Reduce occupancy fire load and hazard exposure',
    observation_text: 'The assessed occupancy and process activities present a fire load or hazard profile that is not adequately controlled.',
    action_required_text: 'Review and reduce fire load concentrations, assess process hazards, and implement targeted controls. Document corrective measures with named owners and target dates.',
    hazard_text: 'Elevated fire load and uncontrolled process hazards increase ignition likelihood and can allow rapid fire development beyond the capacity of installed protection.',
  },

  RE_07_NATURAL_HAZARDS: {
    title: 'Strengthen natural hazard resilience and exposure controls',
    observation_text: 'The site\'s natural hazard exposure is not adequately mitigated by current controls. Resilience measures are insufficient for the identified hazard profile.',
    action_required_text: 'Conduct a targeted natural hazard exposure assessment covering flood, wind, seismic, and subsidence risk as applicable. Implement physical and operational resilience measures with a named accountable owner and target completion date.',
    hazard_text: 'Inadequate natural hazard controls can result in unplanned asset damage, extended business interruption, and compounded loss from concurrent incidents affecting the site.',
  },

  RE_08_UTILITIES: {
    title: 'Improve utility reliability and backup arrangements',
    observation_text: 'Utility supply reliability and backup resilience are not sufficient for the operational and safety demands of the site.',
    action_required_text: 'Review primary utility dependencies, backup power provision, and automatic changeover capability. Implement reliability improvements and formally document emergency utility response procedures.',
    hazard_text: 'Utility failure during fire or incident conditions can remove critical safety and suppression systems, materially increasing loss severity and recovery time.',
  },

  RE_09_MANAGEMENT: {
    title: 'Strengthen risk management systems and loss-prevention controls',
    observation_text: 'Risk management systems and loss-prevention controls are assessed below the acceptable engineering standard. Current arrangements do not provide sufficient assurance that hazards are consistently identified and controlled.',
    action_required_text: 'Define and implement specific improvements to management controls — including permit to work, hot work, housekeeping, contractor management, and impairment procedures — with named owners and target completion dates. Evidence implementation through documented audits or inspection records.',
    hazard_text: 'Weak management controls increase the frequency and severity of incidents by allowing hazardous conditions to persist undetected and by reducing the effectiveness of other installed controls.',
  },

  // ─── HRG occupancy driver canonical keys ─────────────────────────────────────

  natural_hazard_exposure_and_controls: {
    title: 'Strengthen natural hazard exposure controls to engineering standard',
    observation_text: 'Natural hazard exposure controls have been assessed below the acceptable engineering standard. Current mitigation measures are insufficient to reliably limit loss severity under credible natural hazard scenarios.',
    action_required_text: 'Conduct a focused natural hazard exposure review and implement corrective measures — including physical protection, operational procedures, and emergency response provisions — with a named accountable owner and target completion date. Evidence completion through documented assessment or inspection records.',
    hazard_text: 'Sub-standard natural hazard controls create unmitigated pathways for weather, flood, seismic, or subsidence-related damage that can cause significant structural loss and prolonged business interruption.',
  },

  electrical_and_utilities_reliability: {
    title: 'Improve electrical and utilities reliability to engineering standard',
    observation_text: 'Electrical supply and utilities reliability have been assessed below the acceptable engineering standard. Backup arrangements, resilience controls, and failure-mode protection are insufficient.',
    action_required_text: 'Complete an electrical and utilities resilience review. Implement improvements including backup power provision, automatic changeover, supply monitoring, and utility failure response procedures. Assign a named accountable owner and target completion date.',
    hazard_text: 'Sub-standard utilities reliability can remove critical safety, suppression, and process control systems during incident conditions, significantly increasing loss severity and business interruption duration.',
  },

  process_control_and_stability: {
    title: 'Improve process control and stability to engineering standard',
    observation_text: 'Process control and stability have been assessed below the acceptable engineering standard. Control effectiveness is insufficient to prevent process deviations that could lead to fire, explosion, or toxic release.',
    action_required_text: 'Review process control systems, instrumentation, alarm management, and deviation response procedures. Implement corrective measures with a named accountable owner and target completion date.',
    hazard_text: 'Inadequate process control can allow hazardous process conditions to develop unchecked, increasing fire, explosion, and toxic release risk beyond containment design assumptions.',
  },

  safety_and_control_systems: {
    title: 'Strengthen safety and control system performance to engineering standard',
    observation_text: 'Safety and control system performance has been assessed below the acceptable engineering standard. Current arrangements do not provide sufficient confidence in reliable hazard detection and emergency response.',
    action_required_text: 'Review safety instrumented systems, emergency shutdown logic, detector coverage, and proof-test frequencies. Implement corrective measures and validate function by independent test. Assign a named owner and target completion date.',
    hazard_text: 'Under-performing safety systems can allow incident escalation beyond designed containment limits, increasing loss severity and complicating emergency response.',
  },

  process_safety_management: {
    title: 'Strengthen process safety management to engineering standard',
    observation_text: 'Process safety management has been assessed below the acceptable engineering standard. Current arrangements — including management of change, process hazard analysis, and mechanical integrity — are insufficient.',
    action_required_text: 'Conduct a process safety management gap assessment against the applicable standard (e.g., IEC 61511, API RP 750, or equivalent). Implement prioritised corrective actions with named owners and completion dates. Evidence through documented audits and close-out records.',
    hazard_text: 'Weak process safety management increases the probability of major loss events from process deviations, inadequate change control, or unidentified hazards, with potentially severe property, liability, and business interruption consequences.',
  },

  flammable_liquids_and_fire_risk: {
    title: 'Improve flammable liquid controls and fire risk mitigation',
    observation_text: 'Flammable liquid handling, storage, and associated fire risk controls have been assessed below the acceptable engineering standard.',
    action_required_text: 'Review flammable liquid storage, dispensing, containment, ignition source controls, and detection/suppression provision. Implement corrective actions with named owners and target completion dates. Evidence through documented inspection.',
    hazard_text: 'Sub-standard flammable liquid controls create conditions for rapid fire development with high heat release, increasing both property damage and the risk of structural loss and business interruption.',
  },

  critical_equipment_reliability: {
    title: 'Improve critical equipment reliability and maintenance governance',
    observation_text: 'Critical equipment reliability and maintenance governance have been assessed below the acceptable engineering standard. Maintenance programme quality and evidence are insufficient.',
    action_required_text: 'Identify critical equipment items, implement risk-based maintenance programmes, and improve defect close-out tracking. Strengthen condition monitoring and spare parts provision for high-consequence items. Assign named owners and target dates.',
    hazard_text: 'Sub-standard maintenance governance increases the probability of critical equipment failures that could initiate or escalate incidents, and may also reduce the reliability of safety and suppression systems when most needed.',
  },

  high_energy_materials_control: {
    title: 'Strengthen control of high-energy materials to engineering standard',
    observation_text: 'Controls over high-energy or reactive materials have been assessed below the acceptable engineering standard. Storage, handling, and emergency response arrangements are insufficient.',
    action_required_text: 'Review high-energy material inventories, storage conditions, separation distances, and emergency response procedures. Implement corrective measures with named owners and target dates. Evidence through documented inspection or hazard assessment records.',
    hazard_text: 'Inadequate control of high-energy or reactive materials creates conditions for rapid escalation that can overwhelm installed protection, cause structural damage, and severely impact surrounding assets.',
  },

  high_energy_process_equipment: {
    title: 'Improve high-energy process equipment controls and integrity',
    observation_text: 'High-energy process equipment controls and mechanical integrity have been assessed below the acceptable engineering standard.',
    action_required_text: 'Review mechanical integrity programmes for high-energy equipment, pressure protection, inspection schedules, and overpressure response procedures. Implement prioritised corrective actions with named owners and target completion dates.',
    hazard_text: 'Inadequate control of high-energy process equipment can allow catastrophic equipment failure, increasing loss severity and creating secondary hazards for adjacent assets and personnel.',
  },

  emergency_response_and_bcp: {
    title: 'Improve emergency response and business continuity planning',
    observation_text: 'Emergency response capabilities and business continuity planning have been assessed below the acceptable engineering standard. Current arrangements are insufficient to limit loss severity and support effective recovery.',
    action_required_text: 'Review and strengthen emergency response plans, on-site resource provisions, brigade arrangements, and business continuity recovery procedures. Conduct drills and document performance. Assign a named owner and target completion date.',
    hazard_text: 'Sub-standard emergency response and continuity planning can significantly extend incident duration and property damage, and delay resumption of operations, increasing overall loss.',
  },

  // ─── RE07 Exposures / natural-hazard peril factor keys ────────────────────────

  exposures_flood: {
    title: 'Commission site-specific flood resilience review',
    observation_text: 'Flood exposure has been assessed as presenting a material risk to the site. Current flood resilience measures have not been confirmed as adequate for the assessed flood source and expected depth.',
    action_required_text: 'Undertake a site-specific flood resilience review for the factory, including flood source, expected flood depth, critical plant exposure, stock vulnerability, drainage condition, access constraints and emergency response arrangements. Confirm whether temporary or permanent flood barriers, raised storage, plant protection, drainage maintenance or emergency relocation procedures are required.',
    hazard_text: 'Inadequate flood resilience can result in prolonged inundation of process equipment, stock, and utilities, with direct property loss compounded by extended business interruption pending drainage, decontamination, and equipment recommissioning.',
  },

  exposures_wind_storm: {
    title: 'Improve windstorm resilience for roof, cladding and critical plant',
    observation_text: 'Windstorm exposure has been assessed as presenting a material risk. Roof, cladding, and external plant resilience to wind loading have not been confirmed as adequate.',
    action_required_text: 'Assess roof sheet fixings, cladding anchorage, rooflights, external plant, and drainage outlets against design wind load for the site location. Identify and rectify items that could fail or dislodge in a severe windstorm event. Confirm emergency response arrangements for wind-damage scenarios.',
    hazard_text: 'Roof and cladding failure in a severe windstorm can cause direct structural damage, expose process equipment and stock to weather, and create secondary fire or equipment hazards from dislodged services.',
  },

  exposures_wildfire: {
    title: 'Implement wildfire buffer and external exposure controls',
    observation_text: 'Wildfire exposure has been assessed as presenting a material risk. External fire spread from vegetation or surroundings has not been adequately controlled.',
    action_required_text: 'Assess vegetation management, defensible space, and external construction materials in relation to wildfire hazard. Implement and maintain a vegetation clearance and management plan. Review emergency procedures for site evacuation and utility isolation under wildfire threat.',
    hazard_text: 'Wildfire can cause rapid external ignition and structural loss, with limited opportunity for effective fire service intervention under severe conditions. Smoke and heat damage can affect process equipment, stock, and utilities beyond the directly ignited area.',
  },

  exposures_earthquake: {
    title: 'Assess and improve seismic resilience for critical plant and structure',
    observation_text: 'Seismic exposure has been assessed as presenting a material risk. Structural seismic resilience and critical plant anchorage have not been confirmed as adequate.',
    action_required_text: 'Commission a seismic risk assessment covering structural resilience, critical plant and equipment anchorage, utility connection flexibility, and emergency response capability. Implement priority mitigations for highest-consequence items and confirm emergency shutdown procedures for seismic events.',
    hazard_text: 'Inadequate seismic resilience can result in structural damage, critical plant failure, utility disruption, and secondary fire or chemical release hazards, with compounded business interruption from concurrent damage across the site.',
  },

  exposures_human_malicious: {
    title: 'Strengthen perimeter security and malicious-act resilience',
    observation_text: 'The site\'s exposure to deliberate or opportunistic loss from human threat has been assessed as requiring attention. Access controls, perimeter security, and threat-response arrangements are not confirmed as adequate.',
    action_required_text: 'Review perimeter security arrangements, access control effectiveness, CCTV coverage, and response protocols for deliberate or opportunistic loss. Identify and address specific vulnerability points for this site type and location. Document emergency response procedures for security incidents.',
    hazard_text: 'Inadequate security controls create vulnerability to malicious damage, arson, or opportunistic loss, with the potential for fire or chemical incidents that are more difficult to detect and control than accidental events.',
  },

  // ─── RE09 Management category factor keys ────────────────────────────────────

  management_hot_work: {
    title: 'Strengthen hot work permit and control procedures',
    observation_text: 'Hot work controls have been assessed below the acceptable engineering standard. Permit discipline, competency, and fire watch/extinguishment arrangements are insufficient for the work types undertaken on this site.',
    action_required_text: 'Review and strengthen the hot work permit-to-work system, covering pre-work risk assessment, area preparation, equipment condition checks, permit authority, fire watch duration, and sign-off requirements. Confirm that all contractors and in-house trades are subject to the permit system and that compliance is audited periodically.',
    hazard_text: 'Inadequate hot work controls are a recurring cause of large fire losses, particularly where combustible construction is present. Sparks, slag, or heat transfer can initiate fire in concealed locations that are not detected until a full fire has developed.',
  },

  management_maintenance: {
    title: 'Improve planned maintenance governance for loss-critical equipment',
    observation_text: 'Maintenance programme quality has been assessed below the acceptable engineering standard. Planned maintenance scheduling, defect close-out tracking, and evidence retention are insufficient.',
    action_required_text: 'Define a risk-based planned maintenance schedule for loss-critical equipment including fryer systems, electrical equipment, refrigeration plant, detection systems, localised protection, and emergency shutdown controls. Implement tracked defect close-out with named accountable owners and completion-date discipline. Retain maintenance records as evidence of system condition.',
    hazard_text: 'Weak maintenance governance increases the probability of equipment failure that initiates or escalates incidents, and reduces the reliability of protection systems when most needed. For this occupancy, degraded fryer controls, electrical faults, or refrigeration failures are direct loss drivers.',
  },

  management_impairment_management: {
    title: 'Strengthen impairment control and protection system downtime management',
    observation_text: 'Impairment management has been assessed below the acceptable engineering standard. Protection system outages are not consistently controlled, tracked, or restored within defined timeframes.',
    action_required_text: 'Implement or strengthen formal impairment control procedures covering permit authorisation, compensatory protection measures, escalation triggers, and restoration verification for all fire protection and detection system outages. Maintain a live impairment register and review at management level.',
    hazard_text: 'Uncontrolled protection impairments can leave the site without suppression, detection, or alarm capability during the period most likely to produce a large loss — when systems are under maintenance or test.',
  },

  management_contractor_control: {
    title: 'Improve contractor management and site induction controls',
    observation_text: 'Contractor management has been assessed below the acceptable engineering standard. Site induction, permit compliance, and contractor oversight are insufficient.',
    action_required_text: 'Strengthen contractor management controls including pre-qualification, site induction content, permit-to-work supervision, and post-work sign-off for all contractors working on site. Confirm emergency evacuation and communication procedures are covered in induction and understood by contractors.',
    hazard_text: 'Inadequate contractor controls are a leading cause of fire incidents from hot work, electrical work, and inadvertent hazardous-material contact. Contractors unfamiliar with site hazards present elevated ignition and escalation risk.',
  },

  management_emergency_planning: {
    title: 'Improve emergency response planning and drill frequency',
    observation_text: 'Emergency response planning has been assessed below the acceptable engineering standard. Plans, drills, and on-site emergency resource provision are insufficient for credible incident scenarios.',
    action_required_text: 'Review and update site emergency response plans covering fire, chemical release, utility failure, flood, and evacuation scenarios applicable to this site. Schedule and record drills at appropriate frequency. Confirm emergency service liaison and access arrangements. Document business continuity actions for extended production outage.',
    hazard_text: 'Inadequate emergency response capability extends incident duration and damage scope, and can delay site access for emergency services. For this occupancy, delayed response to ammonia or fryer fire incidents carries particular escalation risk.',
  },

  management_housekeeping: {
    title: 'Improve site housekeeping and fire load management',
    observation_text: 'Site housekeeping has been assessed below the acceptable engineering standard. Combustible waste accumulation, storage discipline, and housekeeping routine are insufficient.',
    action_required_text: 'Implement a housekeeping inspection regime with regular scheduled checks, documented results, and accountable ownership. Address combustible waste accumulation, particularly near process plant, ignition sources, and electrical equipment. Establish clear storage disciplines for raw materials, packaging, and finished goods.',
    hazard_text: 'Poor housekeeping creates additional fire load close to ignition sources, increases flame spread velocity, and can obstruct fire service access. Combustible waste near fryer extraction or electrical equipment is a direct ignition pathway.',
  },

  // ─── RE03 occupancy factor keys ───────────────────────────────────────────────

  re03_occ_fire_load_density: {
    title: 'Reduce fire load density to an acceptable level',
    observation_text: 'The assessed fire load density is above the acceptable threshold for the occupancy type and available protection standard. Current storage, process, or material arrangements create a high-risk fire load concentration.',
    action_required_text: 'Review storage arrangements, material quantities, and area utilisation. Implement measures to reduce fire load density including maximum stock height controls, fire load zoning, increased compartmentation, or enhanced suppression in high-density areas.',
    hazard_text: 'Excessive fire load density can overwhelm installed suppression, accelerate structural heating, and increase the probability of total loss across the affected area.',
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
    title: `Strengthen ${factorLabel} to engineering standard`,
    observation_text: `${factorLabel} has been assessed below the acceptable engineering standard. Current control effectiveness is insufficient to reliably limit loss severity under foreseeable incident conditions.`,
    action_required_text: `Define and implement specific corrective measures for ${factorLabel} with a named accountable owner and a target completion date. Evidence completion through documented inspection or test records. Interim risk management measures should be applied until permanent remediation is confirmed.`,
    hazard_text: `Sub-standard performance in ${factorLabel} creates a pathway for incident escalation that current defences may not interrupt reliably. A foreseeable event could develop faster and with greater severity than planning assumptions allow, increasing physical damage, restoration complexity and interruption duration.`,
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
 * Intended lifecycle:
 * Auto recommendations are generated once from a poor RE rating, then become
 * independent recommendation records. Later rating changes must not suppress,
 * delete, restore or overwrite them; assessors must manage the recommendation
 * manually.
 *
 * Implementation:
 *   - If a recommendation already exists for this (document, module, factor,
 *     module_instance) identity, it is left completely untouched and 'exists'
 *     is returned.  The record is an independent assessor-owned artefact.
 *   - If no record exists and the rating is ≤ 2, one is created and 'created'
 *     is returned.  The triggering rating is stored in metadata for traceability.
 *   - If no record exists and the rating is > 2, nothing is created and 'none'
 *     is returned.
 */
export async function ensureRecommendationFromRating(
  params: RecommendationFromRatingParams
): Promise<AutoRecommendationLifecycleState> {
  const { documentId, sourceModuleKey, sourceFactorKey, moduleInstanceId, rating_1_5, industryKey } = params;

  // Check whether an auto recommendation already exists for this identity.
  const { data: existingRow, error: readError } = await supabase
    .from('re_recommendations')
    .select('id')
    .eq('document_id', documentId)
    .eq('source_type', 'auto')
    .eq('source_module_key', sourceModuleKey)
    .eq('source_factor_key', sourceFactorKey || null)
    .eq('module_instance_id', moduleInstanceId || null)
    .maybeSingle();

  if (readError) {
    if (import.meta.env.DEV) console.error('Error checking auto recommendation:', readError);
    return 'none';
  }

  // Record already exists — it is now independent; leave it untouched.
  if (existingRow) {
    return 'exists';
  }

  // No record exists and the rating is acceptable — nothing to create.
  if (rating_1_5 > 2) {
    return 'none';
  }

  // First time a poor rating (≤ 2) is seen for this factor — create once.
  const recommendationPayload = await buildRecommendationPayload({
    sourceModuleKey,
    sourceFactorKey,
    moduleInstanceId,
    rating_1_5,
    industryKey,
  });

  const created = await createAutoRecommendation({
    documentId,
    moduleInstanceId,
    sourceModuleKey,
    sourceFactorKey,
    recommendationPayload,
    triggeredByRating: rating_1_5,
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
  // Warranted-absent sprinklers and required-but-missing fixed protection are always High
  // priority regardless of the numeric rating — absence of warranted suppression is the
  // most severe underwriting exposure regardless of how the factor was scored.
  const HIGH_PRIORITY_FACTOR_PREFIXES = [
    're06_fp_sprinklers_warranted_absent',
    're06_fp_adequacy_fixed_protection_required',
    're06_fp_localised_required_installation',
  ];
  const forceHigh = HIGH_PRIORITY_FACTOR_PREFIXES.some(
    (prefix) => sourceFactorKey?.startsWith(prefix)
  );
  const priority = forceHigh || rating_1_5 === 1 ? 'High' : 'Medium';

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
      if (import.meta.env.DEV) console.error('Error querying recommendation library:', error);
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
    if (import.meta.env.DEV) console.error('Error finding library recommendation:', err);
    return null;
  }
}

/**
 * Create an auto recommendation record.
 * Stores the triggering rating in metadata for traceability.
 */
async function createAutoRecommendation(params: {
  documentId: string;
  moduleInstanceId?: string;
  sourceModuleKey: string;
  sourceFactorKey?: string;
  recommendationPayload: Awaited<ReturnType<typeof buildRecommendationPayload>>;
  triggeredByRating?: number;
}): Promise<boolean> {
  const { documentId, moduleInstanceId, sourceModuleKey, sourceFactorKey, recommendationPayload, triggeredByRating } = params;

  const { data, error } = await supabase
    .from('re_recommendations')
    .insert({
      document_id: documentId,
      module_instance_id: moduleInstanceId || null,
      source_type: 'auto',
      source_module_key: sourceModuleKey,
      source_factor_key: sourceFactorKey || null,
      ...recommendationPayload,
      metadata: {
        ...(recommendationPayload.metadata ?? {}),
        triggered_by_rating: triggeredByRating ?? null,
        triggered_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error('Error creating recommendation from library:', error);
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
    if (import.meta.env.DEV) console.error('Error checking auto recommendation:', error);
    return false;
  }

  return !!data;
}


/**
 * Suppress an open auto-recommendation whose data-field trigger condition is
 * no longer active, without implying that any physical corrective work was done.
 *
 * Background:
 *   The `re_recommendations` status column is constrained to
 *   ('Open', 'In Progress', 'Completed'). 'Completed' carries the semantic of
 *   physical remediation, which is incorrect when the trigger condition simply
 *   changes (e.g. sprinklers_warranted changes from Yes to No). Using
 *   'Completed' for a data-change dismissal would mislead PDF readers and
 *   portfolio metrics.
 *
 *   Instead, this function sets is_suppressed = true — which removes the rec
 *   from both the PDF (DocumentPreviewPage queries filter is_suppressed = false)
 *   and the workspace recommendation panel. The reason is preserved in
 *   metadata.auto_dismissed_* so the decision is auditable.
 *
 * Rules:
 *   - Only acts on records with status = 'Open'. Never touches 'In Progress'
 *     or 'Completed' records — those have been manually actioned by the assessor.
 *   - source_type must be 'auto' (never touches manual recommendations).
 *   - Performs a read-modify-write to preserve existing metadata fields
 *     (e.g. triggered_by_rating) while appending the dismissal keys.
 *   - Returns true if a record was suppressed, false otherwise.
 */
async function suppressStaleAutoRec(params: {
  documentId: string;
  sourceModuleKey: string;
  sourceFactorKey: string;
  moduleInstanceId?: string;
  reason: string;
}): Promise<boolean> {
  const { documentId, sourceModuleKey, sourceFactorKey, moduleInstanceId, reason } = params;

  const { data: existingRow, error: readError } = await supabase
    .from('re_recommendations')
    .select('id, status, metadata')
    .eq('document_id', documentId)
    .eq('source_type', 'auto')
    .eq('source_module_key', sourceModuleKey)
    .eq('source_factor_key', sourceFactorKey)
    .eq('module_instance_id', moduleInstanceId || null)
    .maybeSingle();

  if (readError || !existingRow) return false;

  // Only suppress if still Open — never overwrite records the assessor has progressed.
  const status = String((existingRow as any).status || '').trim().toLowerCase();
  if (status !== 'open') return false;

  // Merge dismissal keys into existing metadata (preserves triggered_by_rating etc.)
  const existingMetadata: Record<string, unknown> = (existingRow as any).metadata || {};
  const mergedMetadata: Record<string, unknown> = {
    ...existingMetadata,
    auto_dismissed: true,
    auto_dismissed_reason: reason,
    auto_dismissed_at: new Date().toISOString(),
    auto_dismissed_by: 'system',
  };

  const { error: updateError } = await supabase
    .from('re_recommendations')
    .update({ is_suppressed: true, metadata: mergedMetadata })
    .eq('id', (existingRow as any).id);

  if (updateError) {
    if (import.meta.env.DEV) console.error('suppressStaleAutoRec: update failed', updateError);
    return false;
  }

  return true;
}

export async function syncAutoRecToRegister(params: {
  documentId: string;
  moduleKey: string;
  canonicalKey: string;
  moduleInstanceId?: string;
  rating_1_5: number;
  industryKey: string | null;
  /**
   * When true and the current rating is > 2 (trigger condition no longer active),
   * any open auto-recommendation for this factor is suppressed (is_suppressed = true)
   * with a metadata dismissal record. The rec becomes invisible in the PDF and
   * workspace without implying that physical corrective work was done.
   *
   * Use this ONLY for data-assessment recommendations where the trigger is a
   * field value (e.g. sprinklers_warranted), not a corrective action.
   * Standard action-based recommendations must never be auto-suppressed.
   */
  resolveWhenNotTriggered?: boolean;
}): Promise<AutoRecommendationLifecycleState> {
  const { documentId, moduleKey, canonicalKey, moduleInstanceId, rating_1_5, industryKey, resolveWhenNotTriggered } = params;

  // When the trigger condition is no longer active and the caller opts in:
  // suppress the open rec so the PDF is immediately consistent with the data.
  if (resolveWhenNotTriggered && rating_1_5 > 2) {
    const suppressed = await suppressStaleAutoRec({
      documentId,
      sourceModuleKey: moduleKey,
      sourceFactorKey: canonicalKey,
      moduleInstanceId,
      reason: 'No longer applicable — data-field trigger condition is no longer active',
    });
    if (suppressed) return 'resolved';
  }

  return ensureRecommendationFromRating({
    documentId,
    sourceModuleKey: moduleKey,          // ✅ correct
    sourceFactorKey: canonicalKey,       // ✅ correct
    moduleInstanceId,
    rating_1_5,
    industryKey,
  });
}
