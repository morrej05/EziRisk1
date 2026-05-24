export type DsearIgnitionPresence = 'present' | 'not_present' | 'unknown' | '';
export type DsearIgnitionControlAdequacy = 'adequate' | 'needs_review' | 'significant_issue' | 'critical' | 'unknown' | '';

export interface DsearIgnitionSourceDefinition {
  sourceKey: string;
  sourceLabel: string;
  category: string;
  riskImplication: string;
  defaultRecommendation: string;
  fraOverlap: boolean;
  isCore: boolean;
  legacyKeys?: string[];
}

export type DsearIgnitionData = Record<string, unknown>;

export interface DsearIgnitionSourceAssessment {
  presence?: DsearIgnitionPresence;
  control_adequacy?: DsearIgnitionControlAdequacy;
  observation?: string;
  finding?: string;
  legacy_evidence_reference?: string;
}

export const DSEAR_IGNITION_SECTION_KEY = 'dsear_4_ignition_sources';
export const DSEAR_IGNITION_SECTION_LABEL = 'DSEAR-4 ignition source control';

export const DSEAR_IGNITION_SOURCE_DEFINITIONS: DsearIgnitionSourceDefinition[] = [
  {
    sourceKey: 'mechanical_sparks_impact',
    sourceLabel: 'Mechanical sparks / impact',
    category: 'Mechanical ignition sources',
    riskImplication: 'Mechanical impact, friction or sparking could ignite flammable vapours, gases or dusts where explosive atmospheres may occur.',
    defaultRecommendation: 'Review mechanical impact, friction and spark controls for hazardous areas and implement suitable prevention, maintenance or exclusion measures.',
    fraOverlap: true,
    isCore: true,
    legacyKeys: ['mechanical'],
  },
  {
    sourceKey: 'electrical_equipment',
    sourceLabel: 'Electrical equipment',
    category: 'Electrical ignition sources',
    riskImplication: 'Unsuitable or unverified electrical equipment could provide an ignition source in a classified hazardous area.',
    defaultRecommendation: 'Verify that electrical equipment installed in hazardous areas is suitable for the relevant zone, gas or dust group and temperature class, and complete any required remedial works.',
    fraOverlap: true,
    isCore: true,
    legacyKeys: ['electrical'],
  },
  {
    sourceKey: 'static_electricity',
    sourceLabel: 'Static electricity',
    category: 'Static electricity control',
    riskImplication: 'Static discharge could provide an ignition source where flammable vapours, gases or dusts may be present.',
    defaultRecommendation: 'Confirm and improve static electricity controls, including bonding, earthing and operating procedures, where flammable atmospheres may occur.',
    fraOverlap: true,
    isCore: true,
    legacyKeys: ['static'],
  },
  {
    sourceKey: 'hot_surfaces',
    sourceLabel: 'Hot surfaces',
    category: 'Hot surfaces',
    riskImplication: 'Hot surfaces above the auto-ignition temperature of substances present could ignite an explosive atmosphere.',
    defaultRecommendation: 'Identify hot surfaces in hazardous areas and confirm they are controlled below relevant ignition temperatures or suitably protected.',
    fraOverlap: true,
    isCore: false,
  },
  {
    sourceKey: 'open_flames_smoking',
    sourceLabel: 'Open flames / smoking',
    category: 'Open flames / smoking controls',
    riskImplication: 'Open flames or smoking materials could ignite flammable vapours, gases or combustible dusts.',
    defaultRecommendation: 'Strengthen controls prohibiting open flames and smoking in or near hazardous areas, including signage, supervision and designated safe areas.',
    fraOverlap: true,
    isCore: false,
  },
  {
    sourceKey: 'hot_work',
    sourceLabel: 'Hot work',
    category: 'Hot works',
    riskImplication: 'Hot work can introduce high-energy ignition sources into areas where flammable atmospheres may be present or created by the work.',
    defaultRecommendation: 'Review hot work controls for hazardous areas and ensure permits, isolation, gas testing, fire watch and post-work checks are applied where required.',
    fraOverlap: true,
    isCore: true,
    legacyKeys: ['hot_work'],
  },
  {
    sourceKey: 'lightning',
    sourceLabel: 'Lightning',
    category: 'Lightning protection',
    riskImplication: 'Lightning strike or induced electrical effects could ignite flammable atmospheres or damage safety-critical equipment.',
    defaultRecommendation: 'Confirm lightning risk and protection arrangements for areas handling dangerous substances and complete inspection or remedial actions where required.',
    fraOverlap: true,
    isCore: false,
  },
  {
    sourceKey: 'exothermic_reaction_process_heat',
    sourceLabel: 'Exothermic reaction / process heat',
    category: 'Process ignition control',
    riskImplication: 'Uncontrolled process heat or exothermic reaction could create an ignition source or escalate a release involving dangerous substances.',
    defaultRecommendation: 'Review process heat and exothermic reaction controls, including monitoring, alarms, interlocks and emergency shutdown arrangements.',
    fraOverlap: false,
    isCore: false,
  },
  {
    sourceKey: 'battery_charging',
    sourceLabel: 'Battery charging',
    category: 'Battery charging',
    riskImplication: 'Battery charging can release flammable gases or introduce electrical ignition sources if ventilation, segregation and charging controls are inadequate.',
    defaultRecommendation: 'Review battery charging arrangements and provide suitable ventilation, segregation, equipment controls and operating procedures.',
    fraOverlap: true,
    isCore: false,
  },
  {
    sourceKey: 'other_ignition',
    sourceLabel: 'Unknown / other ignition',
    category: 'DSEAR ignition source control',
    riskImplication: 'Unresolved or unidentified ignition sources may undermine the basis of safety for dangerous substances and explosive atmospheres.',
    defaultRecommendation: 'Investigate and document other potential ignition sources and define suitable DSEAR controls before relying on the current basis of safety.',
    fraOverlap: false,
    isCore: false,
    legacyKeys: ['other'],
  },
];

export function findDsearIgnitionSource(sourceKey: string): DsearIgnitionSourceDefinition | undefined {
  return DSEAR_IGNITION_SOURCE_DEFINITIONS.find((source) => source.sourceKey === sourceKey);
}

function asRecord(value: unknown): Record<string, DsearIgnitionSourceAssessment> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, DsearIgnitionSourceAssessment>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normaliseDsearIgnitionAssessments(data: DsearIgnitionData): Record<string, DsearIgnitionSourceAssessment> {
  const stored = asRecord(data.dsear_ignition_source_assessments || data.ignition_source_assessments);
  const selectedLegacySources = Array.isArray(data.ignition_sources_assessed) ? data.ignition_sources_assessed : [];

  return DSEAR_IGNITION_SOURCE_DEFINITIONS.reduce<Record<string, DsearIgnitionSourceAssessment>>((acc, source) => {
    const current = stored[source.sourceKey] || {};
    const legacySelected = source.legacyKeys?.some((legacyKey) => selectedLegacySources.includes(legacyKey)) || false;

    acc[source.sourceKey] = {
      presence: current.presence || (legacySelected ? 'present' : ''),
      control_adequacy: current.control_adequacy || deriveLegacyControlAdequacy(source.sourceKey, data),
      observation: current.observation || deriveLegacyObservation(source.sourceKey, data),
      finding: current.finding || '',
      legacy_evidence_reference: current.legacy_evidence_reference || deriveLegacyEvidence(source.sourceKey, data),
    };

    return acc;
  }, {});
}

function deriveLegacyControlAdequacy(sourceKey: string, data: DsearIgnitionData): DsearIgnitionControlAdequacy {
  if (sourceKey === 'electrical_equipment') {
    if (asString(data.ATEX_equipment_required) === 'yes' && asString(data.ATEX_equipment_present) === 'no') return 'significant_issue';
    if (asString(data.ATEX_equipment_required) === 'yes' && asString(data.ATEX_equipment_present) === 'partial') return 'needs_review';
    if (asString(data.ATEX_equipment_required) === 'unknown' || asString(data.ATEX_equipment_present) === 'unknown') return 'unknown';
    if (asString(data.ATEX_equipment_required) === 'yes' && asString(data.ATEX_equipment_present) === 'yes') return 'adequate';
  }

  if (sourceKey === 'static_electricity' && asString(data.static_control_measures)) return 'needs_review';
  if (sourceKey === 'hot_work') {
    if (asString(data.hot_work_controls) === 'yes') return 'adequate';
    if (asString(data.hot_work_controls) === 'no') return 'significant_issue';
    if (asString(data.hot_work_controls) === 'unknown') return 'unknown';
  }

  return '';
}

function deriveLegacyObservation(sourceKey: string, data: DsearIgnitionData): string {
  if (sourceKey === 'electrical_equipment') {
    const parts = [
      asString(data.ATEX_equipment_required) ? `ATEX equipment required: ${asString(data.ATEX_equipment_required)}.` : '',
      asString(data.ATEX_equipment_present) ? `ATEX equipment present: ${asString(data.ATEX_equipment_present)}.` : '',
      asString(data.inspection_testing_regime) ? `Inspection/testing regime: ${asString(data.inspection_testing_regime)}` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  if (sourceKey === 'static_electricity') return asString(data.static_control_measures);
  if (sourceKey === 'hot_work' && asString(data.hot_work_controls)) return `Hot work controls: ${asString(data.hot_work_controls)}.`;
  return '';
}

function deriveLegacyEvidence(sourceKey: string, data: DsearIgnitionData): string {
  const legacyEvidence = asString(data.evidence_references) || asString(data.evidence_reference) || asString(data.photo_references);
  if (!legacyEvidence) return '';
  if (sourceKey === 'other_ignition') return legacyEvidence;
  return '';
}
