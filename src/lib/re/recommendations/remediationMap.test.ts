/**
 * remediationMap.test.ts
 *
 * Tests for the generic-recommendation detection and wording-resolution logic
 * used by scripts/remediate-generic-recommendations.mjs.
 */

import { describe, expect, it, vi } from 'vitest';

// Supabase is imported transitively through recommendationPipeline.ts.
// Mock it before any other import so the module initialises cleanly.
vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  },
}));

import {
  OLD_GENERIC_HAZARD_TEXT,
  OLD_GENERIC_ACTION_PREFIX,
  OLD_GENERIC_OBSERVATION_SUFFIX,
  isOldGenericWording,
  resolveRemediationWording,
  humanizeForRemediation,
  improvedGenericWording,
} from './remediationMap';

// ─── Shared fixture helpers ───────────────────────────────────────────────────

function makeOldGenericRec(overrides: Partial<{
  hazard_text: string;
  action_required_text: string;
  observation_text: string;
}> = {}) {
  const factorLabel = 'Natural Hazard Exposure And Controls';
  return {
    hazard_text: OLD_GENERIC_HAZARD_TEXT,
    action_required_text:
      `${OLD_GENERIC_ACTION_PREFIX}${factorLabel} up to acceptable standards. ` +
      'Address identified deficiencies through documented corrective actions with clear ownership and target dates.',
    observation_text:
      `${factorLabel} ${OLD_GENERIC_OBSERVATION_SUFFIX}`,
    ...overrides,
  };
}

// ─── isOldGenericWording ──────────────────────────────────────────────────────

describe('isOldGenericWording — detection', () => {
  it('detects a record with the constant old hazard_text', () => {
    expect(isOldGenericWording(makeOldGenericRec())).toBe(true);
  });

  it('detects by action_required_text prefix alone (hazard_text replaced)', () => {
    const rec = makeOldGenericRec({ hazard_text: 'Some custom hazard text' });
    expect(isOldGenericWording(rec)).toBe(true);
  });

  it('returns false for a rec with new specific wording', () => {
    expect(
      isOldGenericWording({
        hazard_text: 'Sub-standard natural hazard controls create unmitigated pathways...',
        action_required_text: 'Conduct a focused natural hazard exposure review...',
      }),
    ).toBe(false);
  });

  it('returns false for a rec with manually edited wording', () => {
    expect(
      isOldGenericWording({
        hazard_text: 'The site is in a flood zone and historical events have caused damage.',
        action_required_text: 'Install flood barriers and review drainage capacity.',
      }),
    ).toBe(false);
  });

  it('returns false for the improved generic "Strengthen" wording introduced during the audit', () => {
    expect(
      isOldGenericWording({
        hazard_text:
          'Sub-standard performance in Natural Hazard Exposure And Controls creates a pathway ' +
          'for incident escalation that current defences may not interrupt reliably. A foreseeable event could ' +
          'develop faster and with greater severity than planning assumptions allow, increasing physical damage, ' +
          'restoration complexity and interruption duration.',
        action_required_text:
          'Define and implement specific corrective measures for Natural Hazard Exposure And Controls...',
      }),
    ).toBe(false);
  });

  it('returns false when both fields are empty strings', () => {
    expect(isOldGenericWording({ hazard_text: '', action_required_text: '' })).toBe(false);
  });
});

// ─── resolveRemediationWording ────────────────────────────────────────────────

describe('resolveRemediationWording — factor key resolution', () => {
  it('resolves a specific HRG canonical key to its specific fallback', () => {
    const wording = resolveRemediationWording('natural_hazard_exposure_and_controls', 'RE_07_NATURAL_HAZARDS');
    expect(wording.title).toBe('Strengthen natural hazard exposure controls to engineering standard');
  });

  it('resolves a module-level key when no factor key is given', () => {
    const wording = resolveRemediationWording(null, 'RE_07_NATURAL_HAZARDS');
    expect(wording.title).toBe('Strengthen natural hazard resilience and exposure controls');
  });

  it('prefers factor key over module key when both are present', () => {
    // factor key has a specific entry; module key also has a (different) entry
    const wording = resolveRemediationWording('natural_hazard_exposure_and_controls', 'RE_07_NATURAL_HAZARDS');
    // Should use factor key entry, not module key entry
    expect(wording.title).toBe('Strengthen natural hazard exposure controls to engineering standard');
    expect(wording.title).not.toBe('Strengthen natural hazard resilience and exposure controls');
  });

  it('resolves electrical_and_utilities_reliability', () => {
    const wording = resolveRemediationWording('electrical_and_utilities_reliability', 'RE_08_UTILITIES');
    expect(wording.title).toBe('Improve electrical and utilities reliability to engineering standard');
  });

  it('resolves RE_09_MANAGEMENT via module key when no factor key', () => {
    const wording = resolveRemediationWording(null, 'RE_09_MANAGEMENT');
    expect(wording.title).toBe('Strengthen risk management systems and loss-prevention controls');
  });

  it('resolves re03_occ_fire_load_density', () => {
    const wording = resolveRemediationWording('re03_occ_fire_load_density', 'RE_03_OCCUPANCY');
    expect(wording.title).toBe('Reduce fire load density to an acceptable level');
  });

  it('resolves a building-scoped synthetic RE06 key via prefix strip', () => {
    const wording = resolveRemediationWording(
      're06_fp_sprinklers_warranted_absent:building-123',
      'RE_06_FIRE_PROTECTION',
    );
    expect(wording.title).toBe('Review need for building-wide automatic sprinkler or engineered fire-control measures');
  });

  it('falls back to improved generic for an unknown factor key', () => {
    const wording = resolveRemediationWording('some_unknown_factor', null);
    expect(wording.title).toContain('Strengthen');
    expect(wording.title).toContain('Some Unknown Factor');
    // Must not contain the old banned phrases
    const all = [wording.title, wording.observation_text, wording.action_required_text, wording.hazard_text].join('\n');
    expect(all).not.toContain('Review and implement improvements');
    expect(all).not.toContain('up to acceptable standards');
    expect(all).not.toContain('Inadequate controls increase the likelihood');
  });

  it('falls back to improved generic when both keys are null', () => {
    const wording = resolveRemediationWording(null, null);
    expect(wording.title).toBeTruthy();
    expect(wording.hazard_text).not.toBe(OLD_GENERIC_HAZARD_TEXT);
  });
});

// ─── resolveRemediationWording — wording quality ─────────────────────────────

describe('resolveRemediationWording — new wording never contains old banned phrases', () => {
  const cases: Array<[string | null, string | null]> = [
    ['natural_hazard_exposure_and_controls', 'RE_07_NATURAL_HAZARDS'],
    ['electrical_and_utilities_reliability', 'RE_08_UTILITIES'],
    ['process_safety_management', null],
    ['flammable_liquids_and_fire_risk', null],
    ['emergency_response_and_bcp', null],
    [null, 'RE_02_CONSTRUCTION'],
    [null, 'RE_09_MANAGEMENT'],
    ['re03_occ_fire_load_density', 'RE_03_OCCUPANCY'],
    ['re06_fp_reliability_itm_standard', 'RE_06_FIRE_PROTECTION'],
  ];

  const BANNED = [
    'Review and implement improvements',
    'up to acceptable standards',
    'Address identified deficiencies',
    'Inadequate controls increase the likelihood',
    'has been identified as requiring attention based on current site conditions',
  ];

  for (const [factorKey, moduleKey] of cases) {
    it(`no banned phrases — factor=${factorKey ?? '(none)'} module=${moduleKey ?? '(none)'}`, () => {
      const w = resolveRemediationWording(factorKey, moduleKey);
      const all = [w.title, w.observation_text, w.action_required_text, w.hazard_text].join('\n');
      for (const phrase of BANNED) {
        expect(all, `contains banned phrase: "${phrase}"`).not.toContain(phrase);
      }
    });
  }
});

// ─── humanizeForRemediation ───────────────────────────────────────────────────

describe('humanizeForRemediation', () => {
  it('converts snake_case to Title Case words', () => {
    expect(humanizeForRemediation('natural_hazard_exposure_and_controls')).toBe(
      'Natural Hazard Exposure And Controls',
    );
  });

  it('strips Re-number prefix', () => {
    expect(humanizeForRemediation('RE_09_MANAGEMENT')).toBe('Management');
  });

  it('strips re-number-fp prefix', () => {
    expect(humanizeForRemediation('re06_fp_reliability_itm_standard')).toBe('Reliability Itm Standard');
  });
});

// ─── improvedGenericWording ───────────────────────────────────────────────────

describe('improvedGenericWording', () => {
  it('produces non-empty four-field object', () => {
    const w = improvedGenericWording('some_factor');
    expect(w.title.length).toBeGreaterThan(10);
    expect(w.observation_text.length).toBeGreaterThan(20);
    expect(w.action_required_text.length).toBeGreaterThan(20);
    expect(w.hazard_text.length).toBeGreaterThan(20);
  });

  it('hazard_text is not the old constant text', () => {
    const w = improvedGenericWording('natural_hazard_exposure_and_controls');
    expect(w.hazard_text).not.toBe(OLD_GENERIC_HAZARD_TEXT);
  });

  it('title does not start with "Improve" (old pattern)', () => {
    const w = improvedGenericWording('some_factor');
    expect(w.title).not.toMatch(/^Improve\s+\w/);
  });
});

// ─── Round-trip check ─────────────────────────────────────────────────────────

describe('round-trip: old wording detected → new wording is clean', () => {
  const keyPairs: Array<[string | null, string | null, string]> = [
    ['natural_hazard_exposure_and_controls', 'RE_07_NATURAL_HAZARDS', 'Natural Hazard Exposure And Controls'],
    ['electrical_and_utilities_reliability', 'RE_08_UTILITIES', 'Electrical And Utilities Reliability'],
    [null, 'RE_09_MANAGEMENT', 'Management'],
    [null, 'RE_02_CONSTRUCTION', 'Construction'],
    ['re03_occ_fire_load_density', 'RE_03_OCCUPANCY', 'Fire Load Density'],
  ];

  for (const [factorKey, moduleKey, label] of keyPairs) {
    it(`${label}: old wording is detected, new wording is not detected`, () => {
      // Simulate a DB row with old wording for this key
      const factorLabelForOld = label;
      const oldRec = {
        hazard_text: OLD_GENERIC_HAZARD_TEXT,
        action_required_text:
          `${OLD_GENERIC_ACTION_PREFIX}${factorLabelForOld} up to acceptable standards. ` +
          'Address identified deficiencies through documented corrective actions with clear ownership and target dates.',
      };

      // Step 1: detect
      expect(isOldGenericWording(oldRec)).toBe(true);

      // Step 2: resolve new wording
      const newWording = resolveRemediationWording(factorKey, moduleKey);

      // Step 3: new wording is not detected as old
      expect(isOldGenericWording({
        hazard_text: newWording.hazard_text,
        action_required_text: newWording.action_required_text,
      })).toBe(false);
    });
  }
});
