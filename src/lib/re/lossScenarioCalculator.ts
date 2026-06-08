/**
 * Loss Scenario Calculator — RE-12 (Loss & Values)
 *
 * Pure calculation functions shared between the RE-12 form UI and the PDF builder.
 * No React, no PDF-lib dependencies.
 *
 * Formula (per user specification):
 *   Property damage = sum over each asset category of (base_value × damage_pct / 100)
 *   BI loss         = gross_profit_annual × (bi_severity_pct / 100) × outage_duration_months / 12
 *   Total loss      = Property damage + BI loss
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SumsInsuredPropertyDamage {
  buildings_improvements?: number | null;
  plant_machinery_contents?: number | null;
  stock_wip?: number | null;
  computers?: number | null;
  other?: number | null;
  other_label?: string | null;
}

export interface SumsInsuredBusinessInterruption {
  gross_profit_annual?: number | null;
}

export interface SumsInsuredData {
  property_damage?: SumsInsuredPropertyDamage;
  business_interruption?: SumsInsuredBusinessInterruption;
}

export interface ScenarioPropertyDamage {
  buildings_improvements_pct?: number | null;
  plant_machinery_contents_pct?: number | null;
  stock_wip_pct?: number | null;
  computers_pct?: number | null;
  other_pct?: number | null;
}

export interface ScenarioBusinessInterruption {
  outage_duration_months?: number | null;
  gross_profit_pct?: number | null;
}

export interface ScenarioData {
  scenario_summary?: string | null;
  scenario_description?: string | null;
  property_damage?: ScenarioPropertyDamage;
  business_interruption?: ScenarioBusinessInterruption;
  /** If true, this scenario is explicitly equal to NLE (EML = NLE shorthand). */
  eml_equals_nle?: boolean;
}

export interface PdComponent {
  label: string;
  baseValue: number | null;
  damagePercent: number | null;
  /** Calculated loss value, or null if missing a required input. */
  loss: number | null;
  /** True when the base value is null but a non-zero pct was entered. */
  missingBaseValue: boolean;
}

export interface ScenarioLossResult {
  /** Individual property-damage component breakdowns. */
  pdComponents: PdComponent[];
  /** Sum of all PD component losses (0 if nothing calculable). */
  pdTotal: number;
  pdTotalCanCalculate: boolean;

  biGrossProfit: number | null;
  biDurationMonths: number | null;
  biSeverityPct: number | null;
  /** Calculated BI loss, or null if required BI inputs are absent. */
  biLoss: number | null;
  biMissingFields: string[];

  /** Total scenario loss (PD + BI), or null if both are fully uncalculable. */
  totalLoss: number | null;
  /** Any field names that prevented calculation. */
  missingFields: string[];
  /** True when at least a partial calculation was possible. */
  canCalculate: boolean;
}

// ─── Asset category descriptors ──────────────────────────────────────────────

const PD_CATEGORIES: Array<{
  key: keyof SumsInsuredPropertyDamage;
  pctKey: keyof ScenarioPropertyDamage;
  label: string;
}> = [
  { key: 'buildings_improvements',   pctKey: 'buildings_improvements_pct',   label: 'Buildings & Improvements' },
  { key: 'plant_machinery_contents', pctKey: 'plant_machinery_contents_pct', label: 'Plant & Machinery' },
  { key: 'stock_wip',                pctKey: 'stock_wip_pct',                label: 'Stock & WIP' },
  { key: 'computers',                pctKey: 'computers_pct',                label: 'Computers & Equipment' },
  { key: 'other',                    pctKey: 'other_pct',                    label: 'Other' },
];

// ─── Core calculation ─────────────────────────────────────────────────────────

/**
 * Calculate WLE / NLE / EML scenario totals from raw module data.
 *
 * @param sumsInsured  The `data.sums_insured` block from the RE-12 module instance.
 * @param scenario     The `data.wle` / `data.nle` / `data.eml` block.
 * @param otherLabel   Optional custom label for the "other" PD category.
 */
export function calculateScenarioLoss(
  sumsInsured: SumsInsuredData | null | undefined,
  scenario: ScenarioData | null | undefined,
  otherLabel?: string | null,
): ScenarioLossResult {
  const pd = sumsInsured?.property_damage ?? {};
  const bi = sumsInsured?.business_interruption ?? {};
  const sPd = scenario?.property_damage ?? {};
  const sBi = scenario?.business_interruption ?? {};

  const missingFields: string[] = [];

  // ── Property damage components ──────────────────────────────────────────────
  const pdComponents: PdComponent[] = PD_CATEGORIES.map((cat) => {
    const resolvedLabel =
      cat.key === 'other' && otherLabel ? otherLabel : cat.label;
    const baseValue = toNum(pd[cat.key]);
    const damagePercent = toNum(sPd[cat.pctKey]);

    // If both are 0/null, this category contributes 0 — not an error.
    if (baseValue === null && (damagePercent === null || damagePercent === 0)) {
      return { label: resolvedLabel, baseValue: null, damagePercent: null, loss: 0, missingBaseValue: false };
    }

    // Damage % entered but no base value → cannot calculate this component.
    if (baseValue === null && damagePercent !== null && damagePercent > 0) {
      missingFields.push(`${resolvedLabel} value`);
      return { label: resolvedLabel, baseValue: null, damagePercent, loss: null, missingBaseValue: true };
    }

    const loss = ((baseValue ?? 0) * (damagePercent ?? 0)) / 100;
    return { label: resolvedLabel, baseValue, damagePercent, loss, missingBaseValue: false };
  });

  const pdTotal = pdComponents.reduce(
    (sum, c) => sum + (c.loss !== null ? c.loss : 0),
    0,
  );
  const pdTotalCanCalculate = pdComponents.every((c) => !c.missingBaseValue);

  // ── Business interruption ──────────────────────────────────────────────────
  const biGrossProfit = toNum(bi.gross_profit_annual);
  const biDurationMonths = toNum(sBi.outage_duration_months);
  const biSeverityPct = toNum(sBi.gross_profit_pct);
  const biMissingFields: string[] = [];

  if (biGrossProfit === null) biMissingFields.push('BI gross profit (annual)');
  if (biDurationMonths === null) biMissingFields.push('BI outage duration (months)');
  if (biSeverityPct === null) biMissingFields.push('BI severity %');

  // "BI entered" means the SCENARIO has duration or severity inputs — not just
  // that gross_profit_annual exists in sums insured (which is always there when
  // declared values are entered).
  const anyBiScenarioEntered = biDurationMonths !== null || biSeverityPct !== null;

  let biLoss: number | null = null;
  if (!anyBiScenarioEntered) {
    // No scenario BI inputs at all → treat BI as not applicable (contributes 0).
    biLoss = 0;
    biMissingFields.length = 0; // clear; BI not missing, just not entered
  } else if (biMissingFields.length === 0) {
    biLoss = (biGrossProfit! * (biSeverityPct! / 100) * biDurationMonths!) / 12;
  } else {
    missingFields.push(...biMissingFields);
    // biLoss stays null — incomplete BI inputs
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  const effectiveBi = biLoss ?? 0;
  const totalLoss =
    (pdTotalCanCalculate || pdTotal > 0) && biLoss !== null
      ? pdTotal + effectiveBi
      : null;

  // canCalculate = true only when something meaningful was actually computed or
  // when missing-field errors indicate the user started entering scenario data.
  const canCalculate =
    pdTotal > 0 ||
    (biLoss !== null && biLoss > 0) ||
    missingFields.length > 0;

  return {
    pdComponents,
    pdTotal,
    pdTotalCanCalculate,
    biGrossProfit,
    biDurationMonths,
    biSeverityPct,
    biLoss,
    biMissingFields,
    totalLoss,
    missingFields: [...new Set(missingFields)],
    canCalculate,
  };
}

// ─── EML helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true when the EML scenario block contains no entered inputs
 * (all damage % and BI fields are null/zero) and eml_equals_nle is not set.
 */
export function isScenarioBlank(scenario: ScenarioData | null | undefined): boolean {
  if (!scenario) return true;
  if (scenario.eml_equals_nle) return false;
  if (scenario.scenario_summary?.trim()) return false;
  if (scenario.scenario_description?.trim()) return false;

  const pd = scenario.property_damage ?? {};
  const hasAnyPct = [
    pd.buildings_improvements_pct,
    pd.plant_machinery_contents_pct,
    pd.stock_wip_pct,
    pd.computers_pct,
    pd.other_pct,
  ].some((v) => v !== null && v !== undefined && Number(v) !== 0);
  if (hasAnyPct) return false;

  const bi = scenario.business_interruption ?? {};
  if (bi.outage_duration_months || bi.gross_profit_pct) return false;

  return true;
}

// ─── Currency formatting ──────────────────────────────────────────────────────

const CURRENCY_LOCALES: Record<string, string> = {
  GBP: 'en-GB', USD: 'en-US', EUR: 'de-DE', CAD: 'en-CA',
  AUD: 'en-AU', NZD: 'en-NZ', CHF: 'de-CH', NOK: 'nb-NO',
  SEK: 'sv-SE', DKK: 'da-DK', CNY: 'zh-CN', INR: 'en-IN',
};

/**
 * Format a numeric amount as a currency string using Intl.NumberFormat.
 * Falls back to GBP locale if the currency code is unrecognised.
 */
export function formatLossCurrency(
  amount: number,
  currencyCode: string = 'GBP',
): string {
  const locale = CURRENCY_LOCALES[currencyCode] ?? 'en-GB';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Fallback for unknown currency codes
    return `${currencyCode} ${amount.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Parse a value to a finite number, returning null if absent or non-finite. */
function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
