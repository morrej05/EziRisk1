import { type Jurisdiction, normalizeJurisdiction } from '../../jurisdictions';

/**
 * FsdJurisdiction is the canonical 4-jurisdiction model.
 * England and Wales are treated as a single combined jurisdiction.
 * No standalone England or Wales branches exist.
 */
export type FsdJurisdiction = Jurisdiction;

/**
 * Normalize a raw jurisdiction string for FSD use.
 * Delegates directly to the central normalizeJurisdiction function.
 * Default: 'england_wales'.
 */
export function normalizeFsdJurisdiction(jurisdiction: string | null | undefined): FsdJurisdiction {
  return normalizeJurisdiction(jurisdiction);
}

