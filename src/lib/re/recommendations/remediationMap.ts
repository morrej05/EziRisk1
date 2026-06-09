/**
 * remediationMap.ts
 *
 * Pure detection and wording-lookup logic for the one-off generic-recommendation
 * remediation script (scripts/remediate-generic-recommendations.mjs).
 *
 * No Supabase I/O — safe to import in tests without mocking the DB.
 *
 * Two concerns live here:
 *   1. Detection  — isOldGenericWording() identifies rows that still hold
 *                   the old constant generic wording.
 *   2. Resolution — resolveRemediationWording() returns the correct new wording
 *                   for a given sourceFactorKey / sourceModuleKey pair, in the
 *                   same resolution order as the live pipeline.
 */

import { resolveFactorFallback } from './recommendationPipeline';

// ─── Old wording signatures ───────────────────────────────────────────────────
//
// The old buildFallbackContent() (before the 2026-06-09 wording audit) produced
// a constant hazard_text for every generic recommendation, regardless of factor
// key.  It also produced a predictable action_required_text prefix.  Either
// pattern is sufficient for detection; we check both as belt-and-braces.

/** Constant hazard_text emitted by the old generic fallback (2026-06-09 and earlier). */
export const OLD_GENERIC_HAZARD_TEXT =
  'Inadequate controls increase the likelihood of loss events escalating beyond planned defenses. ' +
  'A foreseeable incident could develop faster than current safeguards allow, increasing damage extent and recovery time. ' +
  'Strengthening this control reduces overall facility risk profile.';

/** Prefix shared by every old action_required_text for the generic path. */
export const OLD_GENERIC_ACTION_PREFIX =
  'Review and implement improvements to bring ';

/** Suffix shared by every old observation_text for the generic path. */
export const OLD_GENERIC_OBSERVATION_SUFFIX =
  'has been identified as requiring attention based on current site conditions. ' +
  'Control effectiveness is below acceptable standards and requires corrective action.';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimum shape of a recommendation row needed for detection and resolution. */
export interface RemediationCandidate {
  id: string;
  document_id: string;
  source_type: string;
  source_module_key: string | null;
  source_factor_key: string | null;
  title: string;
  observation_text: string;
  action_required_text: string;
  hazard_text: string;
}

/** The four wording fields that the remediation updates. */
export interface RemediationWording {
  title: string;
  observation_text: string;
  action_required_text: string;
  hazard_text: string;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true when this recommendation still holds old generic fallback
 * wording from before the 2026-06-09 wording audit.
 *
 * Primary signal  : hazard_text is the constant old text (identical for every
 *                   old generic rec, regardless of factor key).
 * Secondary signal: action_required_text starts with the old generic prefix
 *                   (cross-check — catches any edge case where hazard_text was
 *                   manually updated but action text was not).
 *
 * Manually edited recommendations will never contain either pattern because the
 * old constant hazard text is unique to the old code path and assessors would
 * replace it with site-specific wording.
 */
export function isOldGenericWording(
  rec: Pick<RemediationCandidate, 'hazard_text' | 'action_required_text'>,
): boolean {
  if (rec.hazard_text === OLD_GENERIC_HAZARD_TEXT) return true;
  if (rec.action_required_text?.startsWith(OLD_GENERIC_ACTION_PREFIX)) return true;
  return false;
}

// ─── Wording resolution ───────────────────────────────────────────────────────

/**
 * Humanise a canonical/module key into a readable label, stripping RE-module
 * prefixes that would produce ugly text like "Re02 Construction" or "Re06 Fp …".
 *
 * Prefix stripping is applied to the raw snake_case key before word-splitting
 * so the regex patterns work on underscored input, not on the joined result.
 */
export function humanizeForRemediation(key: string): string {
  const stripped = key
    .replace(/^re\d+_fp_/i, '')   // re06_fp_reliability_itm → reliability_itm
    .replace(/^RE_\d+_/i, '')     // RE_09_MANAGEMENT → MANAGEMENT
    .toLowerCase();
  return stripped
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

/**
 * Improved generic fallback for any factor key that has no specific entry.
 * This is the current pipeline's generic path — already better than the old
 * "Review and implement improvements" wording.
 */
export function improvedGenericWording(key: string): RemediationWording {
  const label = humanizeForRemediation(key);
  return {
    title: `Strengthen ${label} to engineering standard`,
    observation_text:
      `${label} has been assessed below the acceptable engineering standard. ` +
      `Current control effectiveness is insufficient to reliably limit loss severity under foreseeable incident conditions.`,
    action_required_text:
      `Define and implement specific corrective measures for ${label} with a named accountable owner and a target completion date. ` +
      `Evidence completion through documented inspection or test records. ` +
      `Interim risk management measures should be applied until permanent remediation is confirmed.`,
    hazard_text:
      `Sub-standard performance in ${label} creates a pathway for incident escalation that current defences may not interrupt reliably. ` +
      `A foreseeable event could develop faster and with greater severity than planning assumptions allow, ` +
      `increasing physical damage, restoration complexity and interruption duration.`,
  };
}

/**
 * Resolve the correct new wording for a remediated recommendation.
 *
 * Resolution order (mirrors the live pipeline's buildFallbackContent):
 *   1. Specific FACTOR_SPECIFIC_FALLBACKS entry for sourceFactorKey
 *      (including building-scoped synthetic keys like `re06_fp_x:building-id`)
 *   2. Specific FACTOR_SPECIFIC_FALLBACKS entry for sourceModuleKey
 *      (module-level fallback — RE_07_NATURAL_HAZARDS, RE_09_MANAGEMENT, etc.)
 *   3. Improved generic (parameterised by the best available key label)
 *
 * This function is pure — no I/O, safe to call in tests.
 */
export function resolveRemediationWording(
  sourceFactorKey: string | null | undefined,
  sourceModuleKey: string | null | undefined,
): RemediationWording {
  // 1. Specific factor key
  if (sourceFactorKey) {
    const specific = resolveFactorFallback(sourceFactorKey);
    if (specific) return specific;
  }

  // 2. Module-level key
  if (sourceModuleKey) {
    const moduleLevel = resolveFactorFallback(sourceModuleKey);
    if (moduleLevel) return moduleLevel;
  }

  // 3. Improved generic
  const key = sourceFactorKey ?? sourceModuleKey ?? 'unknown_factor';
  return improvedGenericWording(key);
}
