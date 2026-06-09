import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

import { resolveFactorFallback } from './recommendationPipeline';

// Phrases from the OLD generic wording that must no longer appear in any fallback
const BANNED_PHRASES = [
  'Review and implement improvements',
  'bring',
  'up to acceptable standards',
  'Address identified deficiencies',
  'Inadequate controls increase the likelihood',
];

function assertNoGenericPhrases(content: ReturnType<typeof resolveFactorFallback>, key: string) {
  if (!content) return; // null means no fallback — tested separately
  const allText = [content.title, content.observation_text, content.action_required_text, content.hazard_text].join('\n');
  for (const phrase of BANNED_PHRASES) {
    expect(allText, `Key "${key}" fallback contains banned phrase: "${phrase}"`).not.toContain(phrase);
  }
}

describe('Non-RE06 recommendation fallbacks — no generic phrases', () => {
  const nonRe06Keys = [
    // Module-level
    'RE_02_CONSTRUCTION',
    'RE_03_OCCUPANCY',
    'RE_07_NATURAL_HAZARDS',
    'RE_08_UTILITIES',
    'RE_09_MANAGEMENT',
    // HRG occupancy driver canonical keys
    'natural_hazard_exposure_and_controls',
    'electrical_and_utilities_reliability',
    'process_control_and_stability',
    'safety_and_control_systems',
    'process_safety_management',
    'flammable_liquids_and_fire_risk',
    'critical_equipment_reliability',
    'high_energy_materials_control',
    'high_energy_process_equipment',
    'emergency_response_and_bcp',
    // RE03 factor keys
    're03_occ_fire_load_density',
  ];

  for (const key of nonRe06Keys) {
    it(`"${key}" has a specific fallback entry (not null)`, () => {
      const result = resolveFactorFallback(key);
      expect(result).not.toBeNull();
    });

    it(`"${key}" fallback contains no banned generic phrases`, () => {
      const result = resolveFactorFallback(key);
      assertNoGenericPhrases(result, key);
    });

    it(`"${key}" fallback has non-empty title, observation, action, and hazard text`, () => {
      const result = resolveFactorFallback(key);
      expect(result).not.toBeNull();
      expect(result!.title.length).toBeGreaterThan(10);
      expect(result!.observation_text.length).toBeGreaterThan(20);
      expect(result!.action_required_text.length).toBeGreaterThan(20);
      expect(result!.hazard_text.length).toBeGreaterThan(20);
    });
  }
});

describe('Non-RE06 recommendation fallbacks — content quality checks', () => {
  it('RE_07_NATURAL_HAZARDS mentions natural hazard or resilience', () => {
    const result = resolveFactorFallback('RE_07_NATURAL_HAZARDS');
    const text = [result!.title, result!.observation_text].join(' ').toLowerCase();
    expect(text).toMatch(/natural hazard|resilience|flood|seismic/);
  });

  it('RE_08_UTILITIES mentions utility or backup', () => {
    const result = resolveFactorFallback('RE_08_UTILITIES');
    const text = [result!.title, result!.observation_text].join(' ').toLowerCase();
    expect(text).toMatch(/utilit|backup|electrical/);
  });

  it('RE_09_MANAGEMENT mentions management controls or loss-prevention', () => {
    const result = resolveFactorFallback('RE_09_MANAGEMENT');
    const text = [result!.title, result!.observation_text].join(' ').toLowerCase();
    expect(text).toMatch(/management|loss-prevention|controls/);
  });

  it('re03_occ_fire_load_density mentions fire load', () => {
    const result = resolveFactorFallback('re03_occ_fire_load_density');
    const text = [result!.title, result!.observation_text].join(' ').toLowerCase();
    expect(text).toMatch(/fire load/);
  });

  it('natural_hazard_exposure_and_controls mentions natural hazard', () => {
    const result = resolveFactorFallback('natural_hazard_exposure_and_controls');
    const text = [result!.title, result!.observation_text].join(' ').toLowerCase();
    expect(text).toMatch(/natural hazard/);
  });
});
