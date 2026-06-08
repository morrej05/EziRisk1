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

    const narrative = helpers.getNarrativeCommentaryWithBreakdown(module, breakdown);
    expect(narrative).toContain('Legacy masonry adjoins a combustible insulated-panel extension.');
    expect(narrative).toContain('Construction score');
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
