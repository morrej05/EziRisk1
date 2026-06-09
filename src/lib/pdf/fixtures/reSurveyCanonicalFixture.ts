import type { RiskEngineeringScoreBreakdown } from '../../re/scoring/riskEngineeringHelpers';

const longNarrative = [
  'The assessed location is a large-scale frozen-food processing facility operating three continuous shifts with seasonal throughput peaks that materially increase exposure during high-production periods.',
  'Construction combines legacy steel portal frame with newer insulated panel extensions (PUR and phenolic sandwich panels) used extensively in cold-store and blast-freezing areas — these introduce concealed fire spread pathways that are disproportionate to their apparent area contribution.',
  'Site leadership has maintained a documented management framework; however, permit discipline and close-out evidence quality is variable between shifts, particularly for hot-work activities and impairment periods on ammonia refrigeration plant.',
  'From an insurer perspective, the combination of flammable cooking-oil fryer arrays, ammonia refrigeration dependency, spiral freezer critical-line concentration, and absent sprinkler protection creates compounded loss pathways that must be addressed as a programme rather than individually.',
].join(' ');

const appendixNarrative = [
  'Appendix evidence includes annotated site plans, ammonia refrigeration P&ID extracts, fryer maintenance records, blast-freezer operational logs, emergency response drill observations, and impairment governance permits.',
  'Evidence quality is generally adequate for underwriting review, but several ammonia-system records use site-specific labelling conventions without cross-reference to the BS EN 378 maintenance schedule, which limits independent verification.',
  'Photo records include close-ups of fryer extraction ducting, identified panel joint gaps at cold-store interfaces, and a temporary storage arrangement in the main blast-freeze corridor captured during a peak production period.',
].join(' ');

export function createCanonicalReSurveyFixture() {
  const now = new Date('2026-01-15T10:00:00.000Z').toISOString();

  const scoreBreakdownOverride: RiskEngineeringScoreBreakdown = {
    industryKey: 'food_processing',
    industryLabel: 'Food Processing — Frozen Fish Products',
    globalPillars: [
      { key: 'construction_and_combustibility', label: 'Construction & Combustibility', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'fire_protection', label: 'Fire Protection', rating: 1, weight: 5, score: 5, maxScore: 25 },
      { key: 'exposure', label: 'Exposure', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'management_systems', label: 'Management Systems', rating: 2, weight: 3, score: 6, maxScore: 15 },
    ],
    occupancyDrivers: [
      { key: 'natural_hazard_exposure_and_controls', label: 'Natural Hazard Exposure & Controls', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'electrical_and_utilities_reliability', label: 'Electrical & Utilities Reliability', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'process_control_and_stability', label: 'Process Control & Stability', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'safety_and_control_systems', label: 'Safety & Control Systems', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'flammable_liquids_and_fire_risk', label: 'Flammable Liquids & Fire Risk (Fryers)', rating: 1, weight: 5, score: 5, maxScore: 25 },
      { key: 'critical_equipment_reliability', label: 'Critical Equipment Reliability', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'emergency_response_and_bcp', label: 'Emergency Response & BCP', rating: 2, weight: 2, score: 4, maxScore: 10 },
    ],
    totalScore: 76,
    maxScore: 185,
    topContributors: [
      { key: 'fire_protection', label: 'Fire Protection', rating: 1, weight: 5, score: 5, maxScore: 25 },
      { key: 'flammable_liquids_and_fire_risk', label: 'Flammable Liquids & Fire Risk (Fryers)', rating: 1, weight: 5, score: 5, maxScore: 25 },
      { key: 'construction_and_combustibility', label: 'Construction & Combustibility', rating: 2, weight: 4, score: 8, maxScore: 20 },
    ],
  };

  return {
    filename: 'RE_SURVEY_CANONICAL_FIXTURE_FISH_PROCESSING.pdf',
    options: {
      document: {
        id: 're-fixture-doc-001',
        document_type: 'RE',
        title: 'Canonical RE Survey Fixture — Northgate Frozen Foods Processing Facility',
        status: 'draft',
        version: 1,
        version_number: 1,
        assessment_date: now,
        review_date: null,
        assessor_name: 'Alex Morgan',
        assessor_role: 'Senior Risk Engineer',
        responsible_person: 'Jordan Patel',
        scope_description: 'Northgate Frozen Foods Processing Facility',
        limitations_assumptions: 'This fixture is synthetic and intended for deterministic visual QA only. It represents a frozen-food processing site with fryers, ammonia refrigeration, PUR/phenolic insulated panel cladding, absent sprinkler protection, spiral-freezer critical-line dependency, and high BI exposure.',
        created_at: now,
        updated_at: now,
        issue_date: now,
        issue_status: 'draft',
        meta: {
          client: { name: 'Northgate Frozen Foods Ltd' },
          site: {
            name: 'Northgate Frozen Foods Processing Facility',
            address: 'Unit 7–9, Trent Vale Industrial Park, Nottingham NG7 4AB, United Kingdom',
          },
        },
      },
      organisation: {
        id: 'org-fixture-001',
        name: 'EziRisk QA Fixture Org',
        branding_logo_path: null,
      },
      actions: [
        {
          id: 'rec-001',
          document_id: 're-fixture-doc-001',
          recommended_action: 'Install automatic sprinkler protection to cover all process and storage areas — warranted protection is currently absent across the whole site.',
          description: 'No automatic sprinkler system is installed on site despite the assessed hazard profile (industrial fryers, flammable oils, ammonia refrigeration, PUR/phenolic insulated panels) warranting suppression. Manual intervention alone is insufficient to control a developing fire in the fryer extraction corridor or cold-store envelope.',
          hazard_text: 'Uncontrolled fryer fire or panel fire can achieve full-area involvement within minutes. Ammonia release following fire damage in the refrigeration plantroom introduces toxic hazard that will delay manual fire-fighting. BI from a total-loss event exceeds 24 months when cold-chain re-establishment and specialist reinstatement of insulated panel structures is accounted for.',
          source_module_key: 'RE_06_FIRE_PROTECTION',
          priority_band: 'P1',
          status: 'Open',
          owner_user_id: null,
          owner_display_name: 'Site FP Manager',
          target_date: '2026-09-30',
          module_instance_id: 're06',
          created_at: now,
          reference_number: 'RE-001',
          completed_at: null,
          is_complete: false,
          photos: [],
        },
        {
          id: 'rec-002',
          document_id: 're-fixture-doc-001',
          recommended_action: 'Complete per-building cladding combustibility assessment and implement an active monitoring programme for PUR/phenolic insulated panel joints, penetrations, and interfaces.',
          description: 'PUR and phenolic sandwich panel systems are present in the cold-store and blast-freezer envelope. These systems introduce concealed fire spread risk at joints and service penetrations. Current records do not confirm the extent of the combustible envelope or the quality of fire stopping at construction interfaces.',
          hazard_text: 'Insulated PUR/phenolic panels can sustain concealed fire propagation within the panel core without visible flame, producing dense toxic smoke and rapid structural failure. Reinstatement of damaged insulated panel structures involves specialist contractors and extended lead times — this directly extends the BI period beyond the physical fire-damage quantum.',
          source_module_key: 'RE_02_CONSTRUCTION',
          priority_band: 'P1',
          status: 'Open',
          owner_user_id: null,
          owner_display_name: 'Site Maintenance Manager',
          target_date: '2026-06-30',
          module_instance_id: 're02',
          created_at: now,
          reference_number: 'RE-002',
          completed_at: null,
          is_complete: false,
          photos: [],
        },
        {
          id: 'rec-003',
          document_id: 're-fixture-doc-001',
          recommended_action: 'Implement a structured ammonia refrigeration risk management programme aligned with BS EN 378 and the site DSEAR assessment.',
          description: 'Ammonia refrigeration systems serve the blast-freezers and spiral-freezer lines. Current documentation does not confirm that all equipment is within the BS EN 378 maintenance schedule or that the DSEAR assessment is current. A single mechanical failure or a fire in the plantroom can result in site evacuation, cold-chain loss, and insurance coverage questions.',
          hazard_text: 'Ammonia release from a fire-damaged or mechanically failed refrigeration system creates a toxic atmosphere requiring site evacuation and external emergency response. Cold-chain disruption begins immediately and extends the BI period beyond physical repair timescales — frozen product stock loss and customer penalty exposure must be assessed separately from the property damage quantum.',
          source_module_key: 'RE_08_UTILITIES',
          priority_band: 'P1',
          status: 'Open',
          owner_user_id: null,
          owner_display_name: 'Engineering Director',
          target_date: '2026-07-31',
          module_instance_id: 're08',
          created_at: now,
          reference_number: 'RE-003',
          completed_at: null,
          is_complete: false,
          photos: [],
        },
      ],
      selectedModules: [
        'RE_02_CONSTRUCTION',
        'RE_03_OCCUPANCY',
        'RE_06_FIRE_PROTECTION',
        'RE_07_NATURAL_HAZARDS',
        'RE_08_UTILITIES',
        'RE_09_MANAGEMENT',
        'RE_12_LOSS_VALUES',
        'RE_14_DRAFT_OUTPUTS',
      ],
      scoreBreakdownOverride,
      moduleInstances: [
        {
          id: 're02',
          module_key: 'RE_02_CONSTRUCTION',
          outcome: 'poor',
          assessor_notes: `${longNarrative} Compartment boundaries are disrupted at service risers through insulated panel walls; intumescent fire stopping is present but closure records are incomplete for five identified penetrations in the main cold-store block.`,
          data: {
            construction: {
              primary_construction_type: 'Steel portal frame with PUR insulated sandwich panel cladding to cold-store bays and phenolic insulated panel cladding to blast-freeze corridor',
              wall_construction: 'PUR sandwich panels (80 mm) to cold-store perimeter; phenolic insulated panels to blast-freeze corridor; masonry to admin and process areas',
              roof_construction: 'Metal deck over steel frame with PUR insulated panel overlay to cold-store roof — combustible roof void throughout cold-store block',
              cladding_description: 'PUR sandwich panel and phenolic insulated panel systems identified across cold-store and blast-freeze envelope. Panel joints and service penetrations require verification. Combustible core — concealed spread pathway confirmed by assessor.',
              compartmentation_quality: 'Inconsistent — formal quarterly checks in place but defect closure records incomplete for cold-store interfaces; insulated panel penetrations not consistently fire-stopped',
              site_combustible_percent: 56,
            },
            ratings: { site_rating_1_5: 2 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're03',
          module_key: 'RE_03_OCCUPANCY',
          outcome: 'high',
          assessor_notes: `${longNarrative} Process narrative: the primary process lines run continuously. Any unplanned outage of the spiral-freezer lines results in immediate production loss — restart after a full cold-store shutdown requires 48–72 hours of thermal restabilisation before product quality can be confirmed.`,
          data: {
            occupancy: {
              occupancy_type: 'Industrial fish processing — frying, blast-freezing, spiral-freeze packaging',
              process_description: 'Site processes raw fish through an industrial frying line (multiple commercial fryers using palm/sunflower oil blends at 175–185°C), blast-freezing chambers, spiral-freezer conveyors, and automated case-packing lines. Continuous three-shift operation with a partial fourth shift during seasonal peak. Ammonia refrigeration systems serve blast-freezers and cold-store. Combustible cooking oils are stored and used on site; oil-management procedures are documented but not consistently applied between shifts.',
              shift_pattern: '24/7 continuous with three shifts; seasonal fourth shift during Q4 peak',
              combustible_loading: 'High — fryer oil charge (palm/sunflower blend) plus cardboard packaging, waxed corrugated cartons, and palletised frozen-food product throughout production and storage areas',
              hazards: ['industrial_fryers', 'flammable_liquids', 'ammonia_refrigeration', 'frozen_food_production', 'critical_production_lines'],
              industry_special_hazards_notes: 'Industrial fryer arrays with palm/sunflower oil — auto-extinguishing system required. Ammonia refrigeration (HFC alternative not feasible at this scale). Spiral-freezer critical-line concentration — single-point BI dependency. Combustible PUR/phenolic insulated panel envelope.',
            },
            ratings: { site_rating_1_5: 1.5 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're06',
          module_key: 'RE_06_FIRE_PROTECTION',
          outcome: 'poor',
          assessor_notes: `${longNarrative} Fire protection narrative: no automatic sprinkler system is installed. Manual hose reels and extinguishers are present but are insufficient to control a developing fire in the fryer extraction corridor, insulated panel interfaces, or the cold-store block. The assessor considers sprinkler protection warranted across the whole site.`,
          data: {
            fire_protection: {
              // P1 test case: sprinklers absent, warranted — must show "Sprinklers absent; protection warranted"
              // and coverage "Not applicable - system absent", NOT "0% / 0%".
              buildings: {
                'building-process-hall': {
                  sprinklerData: {
                    sprinklers_installed: 'No',
                    sprinklers_warranted: 'Yes',
                    sprinkler_coverage_installed_pct: null,
                    sprinkler_coverage_required_pct: null,
                    sprinkler_adequacy: 'Not installed',
                    no_sprinklers_commentary: 'Sprinkler system has not been installed. Assessed as warranted given fryer fire risk, flammable oil loading, insulated panel construction, and production-line BI dependency.',
                    localised_required: 'Yes',
                    localised_present: 'Yes',
                    localised_type: 'Wet chemical suppression',
                    localised_protected_asset: 'Fryer extraction hood (3 units)',
                    detection_installed: 'Yes',
                    detection_types: ['Heat', 'Smoke'],
                    alarm_monitoring: 'ARC',
                  },
                },
                'building-cold-store': {
                  sprinklerData: {
                    sprinklers_installed: 'No',
                    sprinklers_warranted: 'Yes',
                    sprinkler_coverage_installed_pct: null,
                    sprinkler_coverage_required_pct: null,
                    no_sprinklers_commentary: 'Cold-store block not sprinklered. Insulated panel construction warrants suppression to limit panel fire spread.',
                    localised_required: 'No',
                    localised_present: 'No',
                    detection_installed: 'Yes',
                    detection_types: ['Heat'],
                    alarm_monitoring: 'ARC',
                  },
                },
              },
              site: {
                water: {
                  water_reliability: 'Adequate',
                  supply_type: 'Town main with site storage tank',
                  pumps_present: false,
                  testing_regime: 'Annual only',
                  key_weaknesses: 'No dedicated fire-pump arrangement; town main pressure may be insufficient for full site demand if sprinklers are installed',
                },
              },
              supplementary_assessment: {
                overall_score: 1.5,
                questions: [
                  { key: 'design_basis', label: 'Design basis verified', score_1_5: 1 },
                  { key: 'itm_quality', label: 'ITM quality', score_1_5: 2 },
                  { key: 'impairment_governance', label: 'Impairment governance', score_1_5: 2 },
                ],
              },
            },
            ratings: { site_rating_1_5: 1 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're07',
          module_key: 'RE_07_NATURAL_HAZARDS',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Exposure: the site is mapped in Flood Zone 2 with recorded surface-water pooling around the delivery yard during intense rainfall. Flood event would compound ammonia refrigeration shutdown and cold-chain loss simultaneously.`,
          data: {
            exposures: {
              environmental: {
                perils: {
                  flood: {
                    rating: 2,
                    notes: 'Site in Flood Zone 2 — surface-water pooling recorded at delivery yard; ground-floor electrical switchgear at risk',
                  },
                  wind: {
                    rating: 3,
                    notes: 'Large uninterrupted cold-store roof span; rooftop refrigeration plant creates wind-load concentration points',
                  },
                  wildfire: {
                    rating: 4,
                    notes: 'Industrial estate with limited vegetation; low wildfire exposure',
                  },
                },
              },
              human_exposure: {
                rating: 3,
                notes: 'Adjacent frozen-food distribution depot; occasional night-time congestion on shared access road',
              },
              adjoining_risk: 'Adjacent distribution depot creates potential access-route congestion during major incidents; shared boundary with chemical storage operator requires coordinated emergency planning',
            },
            ratings: { site_rating_1_5: 2.5 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're08',
          module_key: 'RE_08_UTILITIES',
          outcome: 'high',
          assessor_notes: `${longNarrative} Utilities: the ammonia refrigeration system is the critical single point of failure for the whole site — loss of refrigeration results in immediate production halt, frozen product deterioration, and a restart window of 48–72 hours minimum. No backup refrigeration capacity exists.`,
          data: {
            power_resilience: {
              backup_power_present: false,
              generator_capacity_notes: 'No standby generator. Mains power failure would halt all production, refrigeration, and extraction systems simultaneously.',
            },
            critical_services: [
              {
                custom_label: 'Ammonia refrigeration system (blast-freezers and cold-store)',
                criticality: 'High',
                backup_available: false,
                notes: 'Single ammonia circuit serves all blast-freezers and cold-store. No backup refrigeration. Failure = immediate production halt and frozen product deterioration.',
              },
              {
                custom_label: 'Fryer oil heating system',
                criticality: 'High',
                backup_available: false,
                notes: 'Three industrial fryers on single gas header. Gas supply disruption halts primary production line.',
              },
              {
                custom_label: 'Spiral-freezer conveyor lines (x2)',
                criticality: 'High',
                backup_available: false,
                notes: 'Both spiral-freezer lines are single-point dependencies for the primary fried-fish product stream. Extended outage causes customer contract penalties.',
              },
            ],
            critical_equipment: [
              {
                equipment_name: 'Ammonia compressor skid',
                criticality: 'high',
                redundancy: 'N+0',
                lead_time_weeks: 14,
                notes: 'Single compressor skid; no installed standby. OEM lead time 12–16 weeks. Failure = full cold-chain loss.',
              },
              {
                equipment_name: 'Main electrical intake switchboard',
                criticality: 'high',
                redundancy: 'N+0',
                lead_time_weeks: 10,
              },
            ],
            ratings: { site_rating_1_5: 1.5 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're09',
          module_key: 'RE_09_MANAGEMENT',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Management: governance framework is documented and leadership engagement is visible. Hot-work controls are inconsistently applied between day and night shifts; impairment permits for ammonia refrigeration maintenance are not always closed within the agreed window.`,
          data: {
            management: {
              categories: [
                { key: 'hot_work', label: 'Hot Work Controls', rating_1_5: 2, notes: 'Permit-to-work implemented; fire watch applied during day shift. Night-shift close-out records inconsistently completed — unclosed permits observed on three occasions in the past 12 months.' },
                { key: 'housekeeping', label: 'Housekeeping & Waste Management', rating_1_5: 3, notes: 'Generally acceptable. Fryer-area oil spillage cleaned to schedule. Cardboard compactor serviced monthly.' },
                { key: 'impairment_management', label: 'Impairment Management', rating_1_5: 2, notes: 'Ammonia refrigeration impairment permits are raised but closure timestamps are missing in several recent records. Overnight monitoring of impaired systems is not always confirmed in writing.' },
                { key: 'contractor_control', label: 'Contractor Management', rating_1_5: 3, notes: 'Contractor induction process is documented. Insulated panel interface works require specialist supervision; this is not consistently enforced.' },
                { key: 'emergency_response', label: 'Emergency Response & BCP', rating_1_5: 2, notes: 'Emergency response plan is current and references ammonia response procedures. Off-site evacuation muster point and mutual-aid with adjacent depot agreed in principle but not formally documented.' },
              ],
              formal_risk_management_system: 'Yes — formal framework with monthly governance and weekly safety walkthroughs',
              emergency_response_plan: 'Documented; ammonia response section updated 2025-11. Off-site coordination with adjacent operator not yet formalised.',
            },
            ratings: { site_rating_1_5: 2 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're12',
          module_key: 'RE_12_LOSS_VALUES',
          outcome: 'high',
          assessor_notes: `${longNarrative} Loss values: the BI exposure is the dominant financial risk. A total-loss fire event would require specialist insulated panel demolition and reinstatement, ammonia system decommissioning and recommissioning, and cold-chain re-establishment — the aggregate recovery timeline exceeds 18 months on most scenarios.`,
          data: {
            currency: 'GBP',
            sums_insured: {
              property_damage: {
                buildings_improvements: 9800000,
                plant_machinery_contents: 6400000,
                stock_wip: 2100000,
                computers: 180000,
                other: null,
              },
              business_interruption: {
                gross_profit_annual: 22500000,
                indemnity_period_months: 18,
              },
              additional_comments: 'BI indemnity period of 18 months may be insufficient given insulated panel reinstatement lead times and ammonia system recommissioning. Valuations based on 2025 desktop reinstatement assessment.',
            },
            wle: {
              scenario_summary: 'Fryer fire — total facility loss',
              scenario_description: 'Fire originates in the fryer extraction corridor. Auto-extinguishing system activates but fryer fire extends to adjacent PUR panel wall before suppression. Insulated panel fire spreads to cold-store block. Ammonia release from damaged refrigeration plant forces extended evacuation. Total loss of production facility and cold-store.',
              property_damage: {
                buildings_improvements_pct: 100,
                plant_machinery_contents_pct: 90,
                stock_wip_pct: 100,
                computers_pct: 70,
                other_pct: null,
              },
              business_interruption: {
                outage_duration_months: 24,
                gross_profit_pct: 100,
              },
            },
            nle: {
              scenario_summary: 'Fryer fire — controlled by auto-extinguishing, partial damage',
              scenario_description: 'Fryer auto-extinguishing system activates successfully. Smoke contamination requires 4-week production shutdown for fryer-area decontamination and panel inspection. Cold-store and spiral-freezer lines unaffected.',
              property_damage: {
                buildings_improvements_pct: 5,
                plant_machinery_contents_pct: 15,
                stock_wip_pct: 30,
                computers_pct: 5,
                other_pct: null,
              },
              business_interruption: {
                outage_duration_months: 2,
                gross_profit_pct: 60,
              },
            },
            eml: {
              scenario_summary: 'Fryer fire — auto-extinguishing delayed, panel fire involvement',
              scenario_description: 'Auto-extinguishing system activation delayed. Fryer fire spreads to PUR panel wall. Cold-store block partially involved. Spiral-freezer lines damaged. Partial operational capability retained in non-affected bays.',
              property_damage: {
                buildings_improvements_pct: 55,
                plant_machinery_contents_pct: 60,
                stock_wip_pct: 70,
                computers_pct: 30,
                other_pct: null,
              },
              business_interruption: {
                outage_duration_months: 12,
                gross_profit_pct: 95,
              },
            },
            ratings: { site_rating_1_5: 1.5 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're14',
          module_key: 'RE_14_DRAFT_OUTPUTS',
          outcome: 'informational',
          assessor_notes: appendixNarrative,
          data: {
            site_plans_available: 'Yes — evacuation plans, compartment boundaries, and insulated panel layout drawings. Ammonia P&ID extracts included.',
            fire_system_test_evidence: 'Available — fryer auto-extinguishing service records, heat-detector test certificates, and ARC monitoring agreement. No sprinkler certificates (system not installed).',
            bcp_documents_available: 'Available — business continuity strategy with cold-chain recovery section. Mutual-aid with adjacent depot noted as in progress.',
            evidence_pack_attached: 'Yes — 38 geo-tagged photographs including fryer extraction ducting, panel joint conditions, and cold-store interfaces',
            ratings: { site_rating_1_5: 2 },
          },
          completed_at: now,
          updated_at: now,
        },
      ],
      renderMode: 'preview' as const,
    },
  };
}
