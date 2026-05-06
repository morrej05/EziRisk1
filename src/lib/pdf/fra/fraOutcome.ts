import { getFraOutcomeLabel } from '../../modules/moduleCatalog';
import type { ModuleInstance } from './fraTypes';

const FRA_REPORT_OUTCOME_LABELS = new Set([
  'Compliant',
  'Minor Deficiency',
  'Moderate Deficiency',
  'Significant Deficiency',
]);

function cleanOutcome(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function deriveFra1HazardsOutcome(data: Record<string, any>): string {
  const electricalSafety = data?.electrical_safety || {};
  const oxygenEnrichment = cleanOutcome(data?.oxygen_enrichment).toLowerCase();
  const arsonRisk = cleanOutcome(data?.arson_risk).toLowerCase();
  const housekeepingFireLoad = cleanOutcome(data?.housekeeping_fire_load).toLowerCase();
  const eicrSatisfactory = cleanOutcome(electricalSafety?.eicr_satisfactory).toLowerCase();
  const eicrEvidenceSeen = cleanOutcome(electricalSafety?.eicr_evidence_seen).toLowerCase();
  const eicrOutstandingC1C2 = cleanOutcome(electricalSafety?.eicr_outstanding_c1_c2).toLowerCase();

  const ignitionSources = Array.isArray(data?.ignition_sources) ? data.ignition_sources : [];
  const fuelSources = Array.isArray(data?.fuel_sources) ? data.fuel_sources : [];

  if (eicrOutstandingC1C2 === 'yes' || eicrSatisfactory === 'no' || arsonRisk === 'high') {
    return 'material_def';
  }

  if (
    oxygenEnrichment === 'known' &&
    (ignitionSources.length > 2 || fuelSources.length > 2)
  ) {
    return 'material_def';
  }

  const unknowns = [
    arsonRisk === 'unknown',
    housekeepingFireLoad === 'unknown',
    oxygenEnrichment === 'unknown',
    eicrSatisfactory === 'unknown',
    eicrEvidenceSeen === 'no' || eicrEvidenceSeen === 'unknown',
    eicrOutstandingC1C2 === 'unknown',
  ].filter(Boolean).length;

  const hasModerateConcern =
    housekeepingFireLoad === 'high' ||
    arsonRisk === 'medium' ||
    ignitionSources.includes('smoking') ||
    unknowns >= 2;

  if (hasModerateConcern) return 'minor_def';

  const hasEnoughPositiveEvidence =
    arsonRisk && arsonRisk !== 'unknown' &&
    housekeepingFireLoad && housekeepingFireLoad !== 'unknown' &&
    oxygenEnrichment && oxygenEnrichment !== 'unknown' &&
    (eicrSatisfactory === 'yes' || eicrSatisfactory === 'satisfactory') &&
    (eicrOutstandingC1C2 === 'no' || eicrOutstandingC1C2 === 'none');

  return hasEnoughPositiveEvidence ? 'compliant' : '';
}

export function resolveFraOutcomeValue(module: ModuleInstance): string {
  const directOutcome =
    cleanOutcome(module.data?.section_assessment_outcome) ||
    cleanOutcome(module.data?.outcome) ||
    cleanOutcome(module.outcome) ||
    cleanOutcome((module as any).section_assessment_outcome);

  if (directOutcome) return directOutcome;

  if (module.module_key === 'FRA_1_HAZARDS') {
    return deriveFra1HazardsOutcome(module.data || {});
  }

  return '';
}

export function getFraReportOutcomeLabel(outcome: string | null | undefined): string {
  const label = getFraOutcomeLabel(outcome);
  return FRA_REPORT_OUTCOME_LABELS.has(label) ? label : '';
}
