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
    expect(interpretation).toContain('loss-frequency and loss-severity modifiers');
    expect(interpretation).toContain('Hot Work');
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
