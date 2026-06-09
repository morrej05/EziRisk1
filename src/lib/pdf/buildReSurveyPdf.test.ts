import { beforeAll, describe, expect, it, vi } from 'vitest';

const breakdown = {
  industryLabel: 'Warehouse',
  totalScore: 55,
  maxScore: 100,
  globalPillars: [
    { key: 'construction_and_combustibility', label: 'Construction', rating: 2, score: 8, maxScore: 20 },
    { key: 'management_systems', label: 'Management', rating: 2, score: 6, maxScore: 15 },
    { key: 'electrical_and_utilities_reliability', label: 'Utilities', rating: 3, score: 9, maxScore: 15 },
  ],
  occupancyDrivers: [],
  topContributors: [],
} as any;

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
  },
}));

let helpers: typeof import('./buildReSurveyPdf');

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  helpers = await import('./buildReSurveyPdf');
});

describe('RE survey PDF professional narrative helpers', () => {
  it('maps RE-02 construction narrative/commentary from module data into the report narrative', () => {
    const module = {
      id: 'm1',
      module_key: 'RE_02_CONSTRUCTION',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        construction: {
          site_notes: 'Legacy masonry adjoins a combustible insulated-panel extension.',
          buildings: [{ ref: 'B1', roof_area_m2: 1000, mezzanine_area_m2: 0, frame_type: 'steel', compartmentation_minutes: 60 }],
          completion: { site_score: 2 },
        },
      },
    } as any;

    // Narrative commentary for RE_02 now returns only assessor notes.
    // The auto-generated engineering interpretation (with 'Construction score')
    // is rendered separately by buildSectionInterpretation.
    const narrative = helpers.getNarrativeCommentaryWithBreakdown(module, breakdown);
    expect(narrative).toContain('Legacy masonry adjoins a combustible insulated-panel extension.');
    const interpretation = helpers.buildSectionInterpretation(module, breakdown);
    expect(interpretation).toContain('Site construction score');
  });

  it('generates insurer-facing construction interpretation instead of repeating raw inputs', () => {
    const module = {
      id: 'm1',
      module_key: 'RE_02_CONSTRUCTION',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        construction: {
          site_combustible_percent: 35,
          buildings: [{ ref: 'B1', roof_area_m2: 1000, total_floor_area_m2: 1200, mezzanine_area_m2: 200, cladding_present: 'Yes' }],
          completion: { site_score: 2 },
        },
      },
    } as any;

    const interpretation = helpers.buildSectionInterpretation(module, breakdown);
    expect(interpretation).toContain('Site construction score');
    expect(interpretation).toContain('underwriting');
    expect(interpretation).not.toContain('No additional inferred values are applied');
  });

  it('generates management interpretation as a risk-control view rather than boilerplate', () => {
    const module = {
      id: 'm2',
      module_key: 'RE_09_MANAGEMENT',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: { categories: [{ key: 'hot_work', rating_1_5: 2, notes: 'Permit audits inconsistent' }] },
    } as any;

    const interpretation = helpers.buildSectionInterpretation(module, breakdown);
    // Weak category → should name it and explain its UW consequence
    expect(interpretation).toContain('Hot Work');
    expect(interpretation).toContain('frequency and severity');
  });
});

// ─── Management Systems — three-state regression ──────────────────────────────

describe('Management Systems — three-state rendering', () => {
  const baseModule = {
    id: 'mgmt',
    module_key: 'RE_09_MANAGEMENT',
    outcome: null,
    assessor_notes: '',
    completed_at: null,
    updated_at: '',
  } as any;

  it('categories present + rating present: shows scored interpretation with weak-category list', () => {
    const module = {
      ...baseModule,
      data: {
        ratings: { site_rating_1_5: 3 },
        management: {
          categories: [
            { key: 'hot_work', label: 'Hot Work', rating_1_5: 2, notes: 'Inconsistent' },
            { key: 'housekeeping', label: 'Housekeeping', rating_1_5: 4, notes: '' },
          ],
        },
      },
    };
    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('Management systems score is');
    expect(interp).toContain('Hot Work');
    expect(interp).not.toContain('site-level management judgement');
    expect(interp).not.toContain('not been assessed');
  });

  it('categories empty + site rating present: shows site-level judgement, no score derived message', () => {
    const module = {
      ...baseModule,
      data: {
        ratings: { site_rating_1_5: 3 },
        management: { categories: [] },
      },
    };
    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('site-level management judgement');
    expect(interp).toContain('3/5');
    expect(interp).not.toContain('cannot be derived');
    expect(interp).not.toContain('No management category assessments');
    // Risk Significance must not be suppressed — sectionSignificance should return non-null
    const sig = helpers.sectionSignificance(module, breakdown);
    expect(sig).not.toBeNull();
    expect(sig?.narrative).toContain('site-level management judgement');
  });

  it('categories empty + no rating: shows "not been assessed" with no numerical score', () => {
    const module = {
      ...baseModule,
      data: { management: {} },
    };
    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('not been assessed');
    expect(interp).not.toMatch(/\d\/5/);
    // Risk Significance should still render (not null) — returns a Moderate default
    const sig = helpers.sectionSignificance(module, breakdown);
    expect(sig).not.toBeNull();
    expect(sig?.narrative).toContain('not been assessed');
  });
});

// ─── RE06 Fire Protection — three sprinkler scenarios ────────────────────────

function makeRe06Module(buildings: Record<string, unknown>): any {
  return {
    id: 're06',
    module_key: 'RE_06_FIRE_PROTECTION',
    outcome: null,
    assessor_notes: '',
    completed_at: null,
    updated_at: '',
    data: { fire_protection: { buildings } },
  };
}

describe('RE06 Fire Protection — sprinkler scenario rendering', () => {
  // ── Scenario A: No sprinklers, warranted = Yes ─────────────────────────────
  it('Scenario A — absent + warranted: Section Snapshot status = "Sprinklers absent; protection warranted"', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'Yes', sprinkler_coverage_installed_pct: null, sprinkler_coverage_required_pct: null } },
    });
    const rows = helpers.getSectionTableRows(module, {});
    const statusRow = rows.find((r: string[]) => r[0] === 'Sprinkler status');
    expect(statusRow).toBeDefined();
    expect(statusRow![1]).toContain('Sprinklers absent');
    expect(statusRow![1]).toContain('warranted');
    const coverageRow = rows.find((r: string[]) => r[0] === 'Sprinkler coverage');
    expect(coverageRow![1]).toBe('Not applicable - system absent');
    expect(coverageRow![1]).not.toMatch(/\b0%/);
  });

  it('Scenario A — absent + warranted: Engineering Interpretation mentions warranted deficiency', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'Yes', sprinkler_coverage_installed_pct: null, sprinkler_coverage_required_pct: null } },
    });
    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('warranted');
    expect(interp).toContain('deficiency');
    expect(interp).not.toContain('0 building(s) with installed');
  });

  // ── Scenario B: No sprinklers, warranted = No ───────────────────────────────
  it('Scenario B — absent + not warranted: status = "Sprinklers absent; not considered warranted"', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'No', sprinkler_coverage_installed_pct: null, sprinkler_coverage_required_pct: null } },
    });
    const rows = helpers.getSectionTableRows(module, {});
    const statusRow = rows.find((r: string[]) => r[0] === 'Sprinkler status');
    expect(statusRow![1]).toBe('Sprinklers absent; not considered warranted');
    const coverageRow = rows.find((r: string[]) => r[0] === 'Sprinkler coverage');
    expect(coverageRow![1]).toBe('Not applicable');
    expect(coverageRow![1]).not.toMatch(/\b0%/);

    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).not.toContain('protection deficiency');
    expect(interp).not.toContain('material protection deficiency');
    expect(interp).toContain('not considered warranted');
  });

  // ── Scenario Unknown ────────────────────────────────────────────────────────
  it('Scenario Unknown — sprinkler status not recorded: shows "Sprinkler status unknown"', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'Unknown' } },
    });
    const rows = helpers.getSectionTableRows(module, {});
    const statusRow = rows.find((r: string[]) => r[0] === 'Sprinkler status');
    expect(statusRow![1]).toBe('Sprinkler status unknown');
    const coverageRow = rows.find((r: string[]) => r[0] === 'Sprinkler coverage');
    expect(coverageRow![1]).toBe('Not assessed');
  });

  // ── Scenario C: Sprinklers installed ───────────────────────────────────────
  it('Scenario C — sprinklers installed: shows actual required/installed percentages', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'Yes', sprinkler_coverage_required_pct: 100, sprinkler_coverage_installed_pct: 80 } },
    });
    const rows = helpers.getSectionTableRows(module, {});
    const coverageRow = rows.find((r: string[]) => r[0]?.includes('avg'));
    expect(coverageRow![1]).toContain('100%');
    expect(coverageRow![1]).toContain('80%');

    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('installed');
    expect(interp).not.toContain('warranted based on the assessed hazard');
  });

  // ── Scenario C mixed: some installed, some absent+warranted ────────────────
  it('Scenario C — mixed: installed building coverage + warranted-absent deficiency both surfaced', () => {
    const module = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'Yes', sprinkler_coverage_required_pct: 100, sprinkler_coverage_installed_pct: 90 } },
      b2: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'Yes', sprinkler_coverage_required_pct: null, sprinkler_coverage_installed_pct: null } },
    });
    const rows = helpers.getSectionTableRows(module, {});
    const statusRow = rows.find((r: string[]) => r[0] === 'Sprinkler status');
    expect(statusRow![1]).toContain('absent (warranted)');
    const coverageRow = rows.find((r: string[]) => r[0]?.includes('avg'));
    expect(coverageRow![1]).toContain('90%');
    const buildingRow = rows.find((r: string[]) => r[0]?.toLowerCase().includes('buildings'));
    expect(buildingRow![1]).toBe('2');

    const interp = helpers.buildSectionInterpretation(module, breakdown);
    expect(interp).toContain('installed');
    expect(interp).toContain('warranted');
    expect(interp).toContain('deficiency');
  });
});

// ─── Engineering Interpretation quality — fish-processing scenario ────────────
//
// Test case: fish-processing site with fryers, ammonia refrigeration,
// PUR/phenolic panels, no sprinklers, freezer dependency, high BI exposure.

describe('Engineering Interpretation — fish-processing scenario quality', () => {
  const fishProcessingOccupancy = {
    id: 'fp-occ',
    module_key: 'RE_03_OCCUPANCY',
    outcome: null,
    assessor_notes: '',
    completed_at: null,
    updated_at: '',
    data: {
      occupancy: {
        occupancy_type: 'Fish processing',
        industry_special_hazards_notes: 'Industrial fryers for battered fish, ammonia refrigeration plant, large cold-store freezers',
        hazards: [
          { hazard_key: 'fryers', hazard_label: 'Industrial fryers' },
          { hazard_key: 'ammonia', hazard_label: 'Ammonia refrigeration' },
        ],
        hazards_free_text: 'High oil fire load from fryers. Ammonia system serves chilled and frozen production lines.',
      },
    },
  } as any;

  const fishBreakdown = {
    ...breakdown,
    occupancyDrivers: [
      { key: 'fire_load_density', label: 'Fire Load Density', rating: 2, score: 4, maxScore: 10, weight: 3 },
      { key: 'process_control', label: 'Process Control', rating: 3, score: 6, maxScore: 10, weight: 2 },
    ],
  } as any;

  it('occupancy interpretation mentions ammonia refrigeration', () => {
    const interp = helpers.buildSectionInterpretation(fishProcessingOccupancy, fishBreakdown);
    expect(interp).toContain('mmonia');
  });

  it('occupancy interpretation mentions cold-chain / product contamination risk', () => {
    const interp = helpers.buildSectionInterpretation(fishProcessingOccupancy, fishBreakdown);
    expect(interp.toLowerCase()).toMatch(/cold.chain|contamination|disruption/);
  });

  it('occupancy interpretation mentions fryers as ignition source', () => {
    const interp = helpers.buildSectionInterpretation(fishProcessingOccupancy, fishBreakdown);
    expect(interp.toLowerCase()).toContain('fryer');
  });

  it('occupancy interpretation names high process-BI sensitivity', () => {
    const interp = helpers.buildSectionInterpretation(fishProcessingOccupancy, fishBreakdown);
    expect(interp).toContain('high process-BI sensitivity');
  });

  it('construction interpretation names sandwich/composite panel systems when PUR mentioned', () => {
    const constructionModule = {
      id: 'fp-con',
      module_key: 'RE_02_CONSTRUCTION',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        construction: {
          cladding_description: 'PUR insulated panels throughout roof and walls',
          buildings: [{ ref: 'B1', roof_area_m2: 2000, mezzanine_area_m2: 0, combustible_cladding: { present: 'Yes' } }],
          completion: { site_score: 2 },
        },
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(constructionModule, breakdown);
    expect(interp.toLowerCase()).toMatch(/sandwich|composite|insulated panel/);
  });

  it('construction interpretation uses scoreBand.constructionImplication (not generic phrase)', () => {
    const constructionModule = {
      id: 'fp-con',
      module_key: 'RE_02_CONSTRUCTION',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        construction: {
          buildings: [{ ref: 'B1', roof_area_m2: 1500 }],
          completion: { site_score: 2 },
        },
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(constructionModule, breakdown);
    // Should contain score-band implication text, not the old generic closing.
    // Rating 2 → "Below Average" band → constructionImplication mentions escalation pathways.
    expect(interp).not.toContain('The underwriting relevance is potential fire spread, smoke-remediation scope, reinstatement complexity and business interruption duration.');
    expect(interp).toMatch(/combustib|escalation pathway|construction vulnerabilit/i);
  });

  it('fire protection interpretation — absent+warranted mentions total-loss/full involvement', () => {
    const noSprinklerModule = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'No', sprinklers_warranted: 'Yes' } },
    });
    const interp = helpers.buildSectionInterpretation(noSprinklerModule, breakdown);
    expect(interp.toLowerCase()).toMatch(/full.*involvement|maximum foreseeable|absent.*suppression|warranted.*suppression/);
  });

  it('fire protection interpretation — installed systems shift focus to reliability', () => {
    const installedModule = makeRe06Module({
      b1: { sprinklerData: { sprinklers_installed: 'Yes', sprinkler_coverage_required_pct: 100, sprinkler_coverage_installed_pct: 100 } },
    });
    const interp = helpers.buildSectionInterpretation(installedModule, breakdown);
    expect(interp.toLowerCase()).toMatch(/reliability|itm|performance/);
    expect(interp).not.toContain('absence of warranted suppression');
  });

  it('utilities interpretation detects refrigeration/cold-chain dependency', () => {
    const utilitiesModule = {
      id: 'fp-util',
      module_key: 'RE_08_UTILITIES',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        power_resilience: { backup_power_present: false },
        critical_services: [
          { custom_label: 'Ammonia refrigeration plant', criticality: 'High', backup_available: false },
          { custom_label: 'Freezer cold store', criticality: 'High', backup_available: false },
        ],
        critical_equipment: [],
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(utilitiesModule, breakdown);
    expect(interp.toLowerCase()).toMatch(/refrigerat|cold.chain|freezer/);
    expect(interp.toLowerCase()).toContain('backup power');
  });

  it('loss values interpretation flags short indemnity period', () => {
    const lossModule = {
      id: 'fp-loss',
      module_key: 'RE_12_LOSS_VALUES',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        currency: 'GBP',
        sums_insured: {
          buildings: 4000000,
          plant_machinery: 2000000,
          stock: 500000,
          business_interruption: { gross_profit_annual: 8000000, indemnity_period_months: 12 },
        },
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(lossModule, breakdown);
    // Short indemnity period flag
    expect(interp).toContain('12 months');
    expect(interp.toLowerCase()).toMatch(/indemnity.*review|under.insurance|18 months/);
  });

  it('loss values interpretation flags dominant BI relative to PD', () => {
    const lossModule = {
      id: 'fp-loss-bi',
      module_key: 'RE_12_LOSS_VALUES',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        currency: 'GBP',
        sums_insured: {
          buildings: 1000000,
          plant_machinery: 500000,
          business_interruption: { gross_profit_annual: 6000000, indemnity_period_months: 24 },
        },
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(lossModule, breakdown);
    // BI (£6m GP) >> PD (£1.5m) → process-sensitivity flag expected
    expect(interp.toLowerCase()).toMatch(/process.sensitiv|larger than.*property|business interruption.*mater/i);
  });

  it('natural hazards interpretation — no banned generic closing phrase', () => {
    const hazModule = {
      id: 'fp-haz',
      module_key: 'RE_07_NATURAL_HAZARDS',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: { exposures: { environmental: { perils: { flood: { rating: 2, notes: 'Site in flood zone 2' } } } } },
    } as any;
    const interp = helpers.buildSectionInterpretation(hazModule, breakdown);
    expect(interp).not.toContain('site-specific exposure evidence should still be validated against flood, wind, wildfire and human-threat data');
    expect(interp.toLowerCase()).toContain('flood');
  });

  it('management interpretation — weak categories produce UW-focused suffix not generic one', () => {
    const mgmtModule = {
      id: 'fp-mgmt',
      module_key: 'RE_09_MANAGEMENT',
      outcome: null,
      assessor_notes: '',
      completed_at: null,
      updated_at: '',
      data: {
        ratings: { site_rating_1_5: 2 },
        management: {
          categories: [
            { key: 'hot_work', label: 'Hot Work', rating_1_5: 2 },
            { key: 'impairment_management', label: 'Impairment Management', rating_1_5: 1 },
          ],
        },
      },
    } as any;
    const interp = helpers.buildSectionInterpretation(mgmtModule, breakdown);
    expect(interp).toContain('Hot Work');
    expect(interp).toContain('Impairment Management');
    expect(interp.toLowerCase()).toMatch(/hot work|permit|impairment/);
    expect(interp).not.toContain('loss-frequency and loss-severity modifiers');
  });
});
