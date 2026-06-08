import { describe, expect, it } from 'vitest';
import {
  calculateScenarioLoss,
  isScenarioBlank,
  formatLossCurrency,
  type SumsInsuredData,
  type ScenarioData,
} from './lossScenarioCalculator';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_SUMS: SumsInsuredData = {
  property_damage: {
    buildings_improvements: 10_000_000,
    plant_machinery_contents: 5_000_000,
    stock_wip: 2_000_000,
    computers: 500_000,
    other: null,
  },
  business_interruption: {
    gross_profit_annual: 3_000_000,
  },
};

const WLE_SCENARIO: ScenarioData = {
  scenario_summary: 'Full building fire',
  scenario_description: 'Uncontrolled fire destroys entire facility',
  property_damage: {
    buildings_improvements_pct: 100,
    plant_machinery_contents_pct: 80,
    stock_wip_pct: 100,
    computers_pct: 50,
    other_pct: null,
  },
  business_interruption: {
    outage_duration_months: 12,
    gross_profit_pct: 100,
  },
};

// ─── calculateScenarioLoss ─────────────────────────────────────────────────────

describe('calculateScenarioLoss', () => {
  it('computes correct PD components for complete inputs', () => {
    const result = calculateScenarioLoss(FULL_SUMS, WLE_SCENARIO);

    const buildings = result.pdComponents.find((c) => c.label === 'Buildings & Improvements');
    expect(buildings?.loss).toBe(10_000_000); // 10M × 100%

    const pm = result.pdComponents.find((c) => c.label === 'Plant & Machinery');
    expect(pm?.loss).toBe(4_000_000); // 5M × 80%

    const stock = result.pdComponents.find((c) => c.label === 'Stock & WIP');
    expect(stock?.loss).toBe(2_000_000); // 2M × 100%

    const computers = result.pdComponents.find((c) => c.label === 'Computers & Equipment');
    expect(computers?.loss).toBe(250_000); // 500K × 50%
  });

  it('computes correct PD total', () => {
    const result = calculateScenarioLoss(FULL_SUMS, WLE_SCENARIO);
    // 10M + 4M + 2M + 250K = 16,250,000
    expect(result.pdTotal).toBe(16_250_000);
  });

  it('computes correct BI loss: GP × severity% × duration / 12', () => {
    const result = calculateScenarioLoss(FULL_SUMS, WLE_SCENARIO);
    // 3M × 100% × 12 / 12 = 3,000,000
    expect(result.biLoss).toBe(3_000_000);
  });

  it('computes correct total loss = PD + BI', () => {
    const result = calculateScenarioLoss(FULL_SUMS, WLE_SCENARIO);
    // 16,250,000 + 3,000,000 = 19,250,000
    expect(result.totalLoss).toBe(19_250_000);
  });

  it('handles 24-month BI interruption', () => {
    const scenario: ScenarioData = {
      ...WLE_SCENARIO,
      business_interruption: { outage_duration_months: 24, gross_profit_pct: 100 },
    };
    const result = calculateScenarioLoss(FULL_SUMS, scenario);
    // 3M × 100% × 24 / 12 = 6,000,000
    expect(result.biLoss).toBe(6_000_000);
  });

  it('handles zero stock correctly (contributes 0 without error)', () => {
    const sums: SumsInsuredData = {
      ...FULL_SUMS,
      property_damage: { ...FULL_SUMS.property_damage, stock_wip: 0 },
    };
    const result = calculateScenarioLoss(sums, WLE_SCENARIO);
    const stock = result.pdComponents.find((c) => c.label === 'Stock & WIP');
    expect(stock?.loss).toBe(0);
    expect(result.missingFields).not.toContain('Stock & WIP value');
  });

  it('returns null BI loss and reports missing field when outage_duration_months is absent', () => {
    const scenario: ScenarioData = {
      ...WLE_SCENARIO,
      business_interruption: { outage_duration_months: null, gross_profit_pct: 100 },
    };
    const result = calculateScenarioLoss(FULL_SUMS, scenario);
    expect(result.biLoss).toBeNull();
    expect(result.missingFields).toContain('BI outage duration (months)');
  });

  it('returns null BI loss and reports missing field when gross_profit_annual is absent', () => {
    const sums: SumsInsuredData = {
      ...FULL_SUMS,
      business_interruption: { gross_profit_annual: null },
    };
    const result = calculateScenarioLoss(sums, WLE_SCENARIO);
    expect(result.biLoss).toBeNull();
    expect(result.missingFields).toContain('BI gross profit (annual)');
  });

  it('treats BI as 0 (not missing) when NO BI inputs are entered at all', () => {
    const scenario: ScenarioData = {
      property_damage: { buildings_improvements_pct: 50 },
      business_interruption: { outage_duration_months: null, gross_profit_pct: null },
    };
    const result = calculateScenarioLoss(FULL_SUMS, scenario);
    expect(result.biLoss).toBe(0);
    expect(result.biMissingFields.length).toBe(0);
    expect(result.missingFields).not.toContain('BI gross profit (annual)');
  });

  it('reports missingBaseValue when pct is entered but base value is null', () => {
    const sums: SumsInsuredData = {
      property_damage: {
        buildings_improvements: null,
        plant_machinery_contents: null,
        stock_wip: null,
      },
      business_interruption: { gross_profit_annual: null },
    };
    const scenario: ScenarioData = {
      property_damage: {
        buildings_improvements_pct: 100,
        plant_machinery_contents_pct: null,
        stock_wip_pct: null,
      },
    };
    const result = calculateScenarioLoss(sums, scenario);
    const buildings = result.pdComponents.find((c) => c.label === 'Buildings & Improvements');
    expect(buildings?.missingBaseValue).toBe(true);
    expect(buildings?.loss).toBeNull();
    expect(result.missingFields).toContain('Buildings & Improvements value');
  });

  it('uses custom otherLabel for "Other" category', () => {
    const sums: SumsInsuredData = {
      property_damage: { other: 1_000_000 },
    };
    const scenario: ScenarioData = {
      property_damage: { other_pct: 50 },
    };
    const result = calculateScenarioLoss(sums, scenario, 'Tenant Improvements');
    const other = result.pdComponents.find((c) => c.label === 'Tenant Improvements');
    expect(other).toBeDefined();
    expect(other?.loss).toBe(500_000);
  });

  it('handles null/undefined sumsInsured gracefully', () => {
    const result = calculateScenarioLoss(null, WLE_SCENARIO);
    expect(result.pdTotal).toBe(0);
    expect(result.totalLoss).toBeNull();
  });

  it('handles null/undefined scenario gracefully', () => {
    const result = calculateScenarioLoss(FULL_SUMS, null);
    expect(result.pdTotal).toBe(0);
    expect(result.biLoss).toBe(0); // no BI inputs entered → treated as 0
  });

  it('EML blank scenario yields canCalculate = false', () => {
    const result = calculateScenarioLoss(FULL_SUMS, {});
    expect(result.canCalculate).toBe(false);
  });

  it('partial scenario with only PD (no BI) still calculates PD total', () => {
    const scenario: ScenarioData = {
      property_damage: { buildings_improvements_pct: 30 },
    };
    const result = calculateScenarioLoss(FULL_SUMS, scenario);
    expect(result.pdTotal).toBe(3_000_000); // 10M × 30%
    expect(result.biLoss).toBe(0);
    expect(result.totalLoss).toBe(3_000_000);
  });
});

// ─── isScenarioBlank ─────────────────────────────────────────────────────────

describe('isScenarioBlank', () => {
  it('returns true for completely empty scenario', () => {
    expect(isScenarioBlank({})).toBe(true);
  });

  it('returns true for null scenario', () => {
    expect(isScenarioBlank(null)).toBe(true);
  });

  it('returns false when scenario_summary is non-empty', () => {
    expect(isScenarioBlank({ scenario_summary: 'Fire' })).toBe(false);
  });

  it('returns false when any PD pct is non-zero', () => {
    expect(isScenarioBlank({ property_damage: { buildings_improvements_pct: 50 } })).toBe(false);
  });

  it('returns false when BI outage_duration_months is non-zero', () => {
    expect(isScenarioBlank({ business_interruption: { outage_duration_months: 6 } })).toBe(false);
  });

  it('returns false when eml_equals_nle is true', () => {
    expect(isScenarioBlank({ eml_equals_nle: true })).toBe(false);
  });
});

// ─── formatLossCurrency ──────────────────────────────────────────────────────

describe('formatLossCurrency', () => {
  it('formats GBP correctly', () => {
    const result = formatLossCurrency(1_500_000, 'GBP');
    expect(result).toContain('1,500,000');
    expect(result).toMatch(/£/);
  });

  it('formats USD correctly', () => {
    const result = formatLossCurrency(2_000_000, 'USD');
    expect(result).toContain('2,000,000');
    expect(result).toMatch(/\$/);
  });

  it('handles zero amount', () => {
    const result = formatLossCurrency(0, 'GBP');
    expect(result).toContain('0');
  });

  it('falls back gracefully for unknown currency code', () => {
    const result = formatLossCurrency(100_000, 'XYZ');
    expect(result).toContain('100,000');
  });
});
