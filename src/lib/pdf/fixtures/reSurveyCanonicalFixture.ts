import type { RiskEngineeringScoreBreakdown } from '../../re/scoring/riskEngineeringHelpers';

const longNarrative = [
  'The assessed location is a mixed-use industrial and warehousing campus operating continuously across three shifts, with seasonal throughput peaks that materially increase combustible loading and forklift movement in storage aisles.',
  'Construction transitions between legacy masonry and later insulated panel extensions, creating interfaces that require tighter impairment controls whenever envelope penetrations are opened or maintenance contractors are present.',
  'Site leadership has improved governance visibility, however inspection evidence remains unevenly standardised between departments and this causes variable confidence in close-out quality for recurring housekeeping and ignition-source controls.',
  'From an insurer perspective, resilience performance is directionally positive but still exposed to escalation pathways where fire growth, delayed detection, and utility dependency could jointly extend restoration timelines beyond target recovery windows.',
].join(' ');

const appendixNarrative = [
  'Appendix evidence includes annotated site plans, tested sprinkler certificates, hydrant flow and pressure records, emergency response drill observations, thermal imaging extracts for electrical distribution boards, and continuity plan revision logs.',
  'Evidence quality is generally sufficient for underwriting review, but several records include hand-amended fields and non-standard naming conventions. A harmonised document index is recommended to support repeatable annual validation and version traceability.',
  'Photo records include multiple close-ups of fire door defects, compromised compartment line penetrations, and temporary storage within egress corridors captured during peak-loading periods.',
].join(' ');

export function createCanonicalReSurveyFixture() {
  const now = new Date('2026-01-15T10:00:00.000Z').toISOString();

  const scoreBreakdownOverride: RiskEngineeringScoreBreakdown = {
    industryKey: 'warehousing_and_logistics',
    industryLabel: 'Warehousing & Logistics',
    globalPillars: [
      { key: 'construction_and_combustibility', label: 'Construction & Combustibility', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'fire_protection', label: 'Fire Protection', rating: 3, weight: 4, score: 12, maxScore: 20 },
      { key: 'exposure', label: 'Exposure', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'management_systems', label: 'Management Systems', rating: 3, weight: 3, score: 9, maxScore: 15 },
    ],
    occupancyDrivers: [
      { key: 'commodity_type', label: 'Commodity Type', rating: 2, weight: 5, score: 10, maxScore: 25 },
      { key: 'storage_height', label: 'Storage Height', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'rack_configuration', label: 'Rack Configuration', rating: 3, weight: 3, score: 9, maxScore: 15 },
      { key: 'separation_distances', label: 'Separation Distances', rating: 3, weight: 2, score: 6, maxScore: 10 },
      { key: 'ignition_controls', label: 'Ignition Controls', rating: 3, weight: 3, score: 9, maxScore: 15 },
      { key: 'critical_process_dependency', label: 'Critical Process Dependency', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'housekeeping_consistency', label: 'Housekeeping Consistency', rating: 3, weight: 3, score: 9, maxScore: 15 },
      { key: 'maintenance_assurance', label: 'Maintenance Assurance', rating: 3, weight: 2, score: 6, maxScore: 10 },
      { key: 'contractor_control', label: 'Contractor Control', rating: 2, weight: 2, score: 4, maxScore: 10 },
      { key: 'electrical_resilience', label: 'Electrical Resilience', rating: 2, weight: 3, score: 6, maxScore: 15 },
      { key: 'firewall_integrity', label: 'Firewall Integrity', rating: 2, weight: 4, score: 8, maxScore: 20 },
      { key: 'recovery_readiness', label: 'Recovery Readiness', rating: 3, weight: 2, score: 6, maxScore: 10 },
    ],
    totalScore: 109,
    maxScore: 210,
    topContributors: [
      { key: 'fire_protection', label: 'Fire Protection', rating: 3, weight: 4, score: 12, maxScore: 20 },
      { key: 'commodity_type', label: 'Commodity Type', rating: 2, weight: 5, score: 10, maxScore: 25 },
      { key: 'storage_height', label: 'Storage Height', rating: 2, weight: 4, score: 8, maxScore: 20 },
    ],
  };

  return {
    filename: 'RE_SURVEY_CANONICAL_FIXTURE.pdf',
    options: {
      document: {
        id: 're-fixture-doc-001',
        document_type: 'RE',
        title: 'Canonical RE Survey Fixture — Riverport Distribution Campus',
        status: 'draft',
        version: 1,
        version_number: 1,
        assessment_date: now,
        review_date: null,
        assessor_name: 'Alex Morgan',
        assessor_role: 'Senior Risk Engineer',
        responsible_person: 'Jordan Patel',
        scope_description: 'Riverport Distribution Campus',
        limitations_assumptions: 'This fixture is synthetic and intended for deterministic visual QA only.',
        created_at: now,
        updated_at: now,
        issue_date: now,
        issue_status: 'draft',
        meta: {
          client: { name: 'Northgate Consumer Logistics Ltd' },
          site: {
            name: 'Riverport Distribution Campus',
            address: 'Unit A-D, Riverport Industrial Estate, Trent Vale, Nottingham NG7 4AB, United Kingdom',
          },
        },
      },
      organisation: {
        id: 'org-fixture-001',
        name: 'EziRisk QA Fixture Org',
        branding_logo_path: null,
      },
      actions: [],
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
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Additional QA stress text: compartment boundaries are interrupted at multiple service risers and roof void transitions; visual checks identified mixed-quality fire stopping with legacy materials adjacent to modern intumescent systems.`,
          data: {
            construction: {
              primary_construction_type: 'Mixed — legacy steel portal frame with masonry infill and newer insulated composite panel extensions',
              wall_construction: 'Masonry perimeter to original bays; composite sandwich panels to extension bays with multiple cold-store interfaces and service penetrations',
              roof_construction: 'Metal deck over steel frame with PV arrays and localised waterproofing repairs recorded in maintenance logs',
              compartmentation_quality: 'Inconsistent; formal quarterly checks exist but defect closure evidence is lengthy and variably formatted across contractors',
            },
            ratings: { site_rating_1_5: 2 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're03',
          module_key: 'RE_03_OCCUPANCY',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Occupancy narrative extension for pagination: palletised aerosols, consumer goods, and seasonal gift lines produce alternating high-challenge storage profiles, while temporary overflow zones are used during Q4 peak throughput.`,
          data: {
            occupancy: {
              occupancy_type: 'High-bay logistics warehouse with light packaging, returns processing, battery charging, and transient value-added fulfilment activities',
              process_description: 'Inbound unloading, barcode sortation, mezzanine pick-and-pack operations, pallet wrapping, battery charging and dispatch marshalling occur continuously with variable congestion at crossover points between people and mobile plant.',
              shift_pattern: '24/7 with three shifts; additional agency labor during seasonal peak',
              combustible_loading: 'Moderate to High depending on commodity rotation and temporary overstocking pressures',
            },
            ratings: { site_rating_1_5: 2.5 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're06',
          module_key: 'RE_06_FIRE_PROTECTION',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Fire protection narrative extension: routine testing is generally timely, yet impairment handover quality is inconsistent during multi-contractor works and return-to-service sign-off occasionally lacks clear accountable owner confirmation.`,
          data: {
            fire_protection: {
              sprinklers_present: 'Yes — wet-pipe ESFR system in main storage halls with mixed-age branch upgrades in extension zones',
              automatic_detection: 'Addressable detection with aspirating points in selected high-value mezzanine zones',
              hydrants: 'On-site private ring main with external hydrants; latest flow tests indicate marginal pressure at furthest standpipe during peak demand',
            },
            management: {
              impairment_management: 'Documented impairment permit in place, but temporary bypass periods and overnight monitoring duties are not always evidenced with consistent timestamps',
            },
            ratings: { site_rating_1_5: 3 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're07',
          module_key: 'RE_07_NATURAL_HAZARDS',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Exposure extension: the site sits within a mixed industrial perimeter with constrained emergency vehicle approach on one flank and periodic surface water accumulation noted after intense rainfall events.`,
          data: {
            exposures: {
              flood_exposure_level: 'Moderate — mapped surface-water pooling around loading yard during cloudburst events',
              windstorm_exposure_level: 'Moderate — large uninterrupted roof spans with rooftop plant and PV arrays',
              wildfire_exposure_level: 'Low',
              adjoining_risk: 'Adjacent recycling operation and transport depot create potential external ignition and access congestion concerns during major incidents',
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
          assessor_notes: `${longNarrative} Utilities extension: extended dependence on central electrical switchgear and a single compressed-air header creates restart vulnerability if either asset is lost during a severe event.`,
          data: {
            power: {
              resilience_level: 'Partial resilience — standby generation supports life safety and selected critical IT controls only',
              backup_generation: 'Diesel generator with 8-hour nominal autonomy; refuelling contracts are in place but mobilisation time has not been stress-tested under regional disruption',
            },
            critical_dependencies: 'Core dependencies include central electrical intake substation, compressed air, chilled storage controls, warehouse management system connectivity, and a single high-capacity packaging line serving premium product dispatches. This intentionally long field is included to validate long table-cell wrapping and maintain readability under dense content conditions.',
            single_points_of_failure: [
              'Primary electrical intake switchboard with delayed replacement lead-time',
              'Single compressed-air header serving multiple packing lines',
              'Warehouse management network core switch located in one comms room',
            ],
            ratings: { site_rating_1_5: 2 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're09',
          module_key: 'RE_09_MANAGEMENT',
          outcome: 'moderate',
          assessor_notes: `${longNarrative} Management systems extension: governance meetings are regular and engaged, but KPI definition for quality-of-close-out and verification depth would benefit from clearer acceptance criteria and independent trend challenge.`,
          data: {
            management: {
              formal_risk_management_system: 'Yes — formal management framework with monthly governance, weekly safety walkthroughs, and periodic insurer-facing engineering reviews',
              hot_work_permit_process: 'Permit-to-work implemented with fire watch and cooldown periods; consistency of record completion varies between day and night shifts',
              housekeeping_standard: 'Generally acceptable with recurring congestion around outbound marshalling during seasonal peaks',
              emergency_response_plan: 'Documented and drilled biannually; mutual aid and off-site communication escalation workflows require further rehearsal',
            },
            ratings: { site_rating_1_5: 3 },
          },
          completed_at: now,
          updated_at: now,
        },
        {
          id: 're12',
          module_key: 'RE_12_LOSS_VALUES',
          outcome: 'high',
          assessor_notes: `${longNarrative} Loss and values extension: declared asset concentration and BI dependency indicate high materiality; prolonged outage of critical operations would likely drive significant secondary cost pressure through expedited logistics and customer service penalties.`,
          data: {
            sums_insured: {
              buildings: 26500000,
              plant_machinery: 14300000,
              stock: 11800000,
            },
            business_interruption: {
              gross_profit_annual: 32700000,
              indemnity_period_months: 18,
            },
            ratings: { site_rating_1_5: 2 },
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
            site_plans_available: 'Yes — latest evacuation and compartment plans, including revised extension boundaries and annotated high-value storage zones',
            fire_system_test_evidence: 'Available — sprinkler annual certification, quarterly valve inspections, and hydrant flow/pressure records with engineer signatures',
            bcp_documents_available: 'Available — continuity strategy, ICT recovery dependencies, and customer prioritisation matrix (revision controlled)',
            evidence_pack_attached: 'Yes — 46 geo-tagged photographs and maintenance close-out extracts included in appendix index',
            ratings: { site_rating_1_5: 3 },
          },
          completed_at: now,
          updated_at: now,
        },
      ],
      renderMode: 'preview' as const,
    },
  };
}
