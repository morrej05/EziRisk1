import { supabase } from '../supabase';
import { compactRecommendationDetail, type RecommendationDetail } from './recommendationDetail';

export const ACTIVE_ACTION_STATUSES = ['open', 'in_progress'] as const;

export interface DetailedFindingAssessment {
  status?: string;
  observations?: string;
  deficiencies?: string;
  existing_controls?: string;
  assessor_commentary?: string;
  risk_significance?: string;
  evidence_references?: string;
  action_trigger?: boolean;
  recommended_action_trigger?: string;
  condition_adequacy?: string;
  presence?: string;
}

export interface ActionSourceLink {
  id: string;
  organisation_id: string;
  document_id: string;
  module_instance_id: string;
  action_id: string;
  source_assessment_type: string;
  source_assessment_key: string;
  source_assessment_label: string | null;
  source_finding_hash: string | null;
  carried_from_link_id: string | null;
  deleted_at: string | null;
  actions?: LinkedAction | null;
}

export interface LinkedAction {
  id: string;
  recommended_action: string;
  status: string;
  priority_band: string | null;
  reference_number: string | null;
  title?: string | null;
  deleted_at?: string | null;
}

export interface ExistingActionOption extends LinkedAction {
  module_instance_id: string | null;
}


export function normalizeActionText(text: string | null | undefined): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

export function areActionTextsNearDuplicate(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = normalizeActionText(a);
  const normalizedB = normalizeActionText(b);

  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  const shorterLength = Math.min(normalizedA.length, normalizedB.length);
  const longerLength = Math.max(normalizedA.length, normalizedB.length);
  if (shorterLength < 24) return false;

  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    return shorterLength / longerLength >= 0.82;
  }

  const distance = levenshteinDistance(normalizedA, normalizedB);
  const similarity = 1 - distance / longerLength;
  return similarity >= 0.9;
}

export function detailedFindingNeedsRecommendation(assessment: DetailedFindingAssessment): boolean {
  const risk = String(assessment.risk_significance || '').toLowerCase();
  const trigger = String(assessment.recommended_action_trigger || '').toLowerCase();
  return Boolean(
    String(assessment.deficiencies || '').trim() ||
    assessment.status === 'inadequate' ||
    assessment.action_trigger ||
    ['high', 'critical', 'urgent'].includes(risk) ||
    ['action_required', 'urgent'].includes(trigger)
  );
}

export function targetDateFromTimescale(timescale: string, baseDate = new Date()): string | null {
  const dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  switch (timescale) {
    case 'immediate':
      break;
    case '7d':
      dueDate.setDate(dueDate.getDate() + 7);
      break;
    case '30d':
      dueDate.setDate(dueDate.getDate() + 30);
      break;
    case '90d':
      dueDate.setDate(dueDate.getDate() + 90);
      break;
    default:
      return null;
  }
  const year = dueDate.getFullYear();
  const month = String(dueDate.getMonth() + 1).padStart(2, '0');
  const day = String(dueDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function priorityFromDetailedFinding(assessment: DetailedFindingAssessment): { priority: string; severity: string; timescale: string } {
  const risk = String(assessment.risk_significance || '').toLowerCase();
  const trigger = String(assessment.recommended_action_trigger || '').toLowerCase();
  if (risk === 'critical' || trigger === 'urgent') return { priority: 'P1', severity: 'T4', timescale: 'immediate' };
  if (risk === 'high' || trigger === 'action_required') return { priority: 'P2', severity: 'T3', timescale: '30d' };
  if (risk === 'medium' || assessment.status === 'inadequate') return { priority: 'P3', severity: 'T2', timescale: '90d' };
  return { priority: 'P4', severity: 'T1', timescale: 'next_review' };
}


function buildProfessionalConsequence(assessment: DetailedFindingAssessment, sourceAssessmentLabel: string, moduleKey: string): string {
  const explicit = String((assessment as Record<string, unknown>).risk_implication || (assessment as Record<string, unknown>).consequence || '').trim();
  if (explicit) return explicit;

  const label = sourceAssessmentLabel.toLowerCase();
  if (label.includes('electrical') || label.includes('fixed wiring')) {
    return 'Deficiencies in electrical ignition source control can increase the likelihood of fire starting and may compromise the effectiveness of existing fire precautions.';
  }
  if (label.includes('lightning')) {
    return 'Unverified lightning exposure or protection arrangements can leave the premises vulnerable to ignition, damage to safety-critical systems and avoidable interruption following storm activity.';
  }
  if (label.includes('smoking')) {
    return 'Weak smoking controls can increase the likelihood of accidental ignition in or near combustible materials and undermine day-to-day fire prevention arrangements.';
  }
  if (label.includes('hot work')) {
    return 'Inadequate hot work control can introduce high-energy ignition sources and allow smouldering or concealed fire spread after work has finished.';
  }
  if (label.includes('cooking') || label.includes('kitchen') || label.includes('duct')) {
    return 'Deficiencies in cooking, extract or duct-cleaning controls can allow grease or combustible deposits to accumulate and increase the likelihood and severity of a kitchen-related fire.';
  }
  if (label.includes('management') || moduleKey.includes('MANAGEMENT')) {
    return 'Weaknesses in fire safety management arrangements can reduce assurance that precautions are maintained, responsibilities are understood and deficiencies are corrected in a timely manner.';
  }
  if (moduleKey === 'FRA_2_ESCAPE_ASIS') {
    return 'Deficiencies affecting means of escape can compromise safe evacuation and may increase risk to occupants during a fire event.';
  }
  if (moduleKey === 'FRA_3_ACTIVE_SYSTEMS') {
    return 'Deficiencies in active fire protection can delay warning, reduce intervention effectiveness and compromise the overall fire strategy.';
  }

  const risk = String(assessment.risk_significance || '').trim().toLowerCase();
  const qualifier = risk && risk !== 'unknown' ? ` The assessor has identified this as a ${risk}-significance matter.` : '';
  return `The recorded deficiency may reduce the reliability of the relevant fire precaution and should be addressed proportionately to maintain life safety and property protection.${qualifier}`;
}

export function buildFindingHash(assessment: DetailedFindingAssessment): string {
  const source = [
    assessment.status,
    assessment.observations,
    assessment.deficiencies,
    assessment.existing_controls,
    assessment.assessor_commentary,
    assessment.risk_significance,
    assessment.evidence_references,
    assessment.action_trigger,
    assessment.recommended_action_trigger,
    assessment.condition_adequacy,
  ].map((value) => String(value ?? '').trim()).join('|');

  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildRecommendationFromFinding(args: {
  assessment: DetailedFindingAssessment;
  sourceAssessmentLabel: string;
  moduleKey: string;
}): { recommendedAction: string; detail: RecommendationDetail | null; priority: string; severity: string; timescale: string } {
  const { assessment, sourceAssessmentLabel, moduleKey } = args;
  const priority = priorityFromDetailedFinding(assessment);
  const observation = String(assessment.observations || assessment.condition_adequacy || '').trim();
  const recommendation = String(assessment.deficiencies || '').trim() || `Review and address the finding recorded for ${sourceAssessmentLabel}.`;
  const consequence = buildProfessionalConsequence(assessment, sourceAssessmentLabel, moduleKey);

  const detail = compactRecommendationDetail({
    schema_version: 1,
    observation,
    consequence,
    recommendation,
    rationale: String(assessment.assessor_commentary || '').trim(),
    existing_controls: String(assessment.existing_controls || '').trim(),
    evidence_notes: String(assessment.evidence_references || '').trim(),
    linked_module: `${moduleKey} — ${sourceAssessmentLabel}`,
    assessor_commentary: String(assessment.assessor_commentary || '').trim(),
    timeframe_guidance: priority.timescale === 'immediate'
      ? 'Suggested: complete immediately'
      : priority.timescale === 'next_review'
        ? 'Suggested: complete by next scheduled review'
        : `Suggested: complete within ${priority.timescale.replace('d', ' days')}`,
  });

  return {
    recommendedAction: recommendation,
    detail,
    priority: priority.priority,
    severity: priority.severity,
    timescale: priority.timescale,
  };
}

export async function fetchFindingLinks(args: {
  documentId: string;
  moduleInstanceId: string;
  sourceAssessmentType: string;
  sourceAssessmentKey: string;
}): Promise<ActionSourceLink[]> {
  const { data, error } = await supabase
    .from('action_source_links')
    .select('*, actions(id, recommended_action, status, priority_band, reference_number, deleted_at)')
    .eq('document_id', args.documentId)
    .eq('module_instance_id', args.moduleInstanceId)
    .eq('source_assessment_type', args.sourceAssessmentType)
    .eq('source_assessment_key', args.sourceAssessmentKey)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as ActionSourceLink[];
}

export async function fetchExistingActionsForFinding(documentId: string, moduleInstanceId: string): Promise<ExistingActionOption[]> {
  const { data, error } = await supabase
    .from('actions')
    .select('id, recommended_action, status, priority_band, reference_number, module_instance_id, deleted_at')
    .eq('document_id', documentId)
    .is('deleted_at', null)
    .in('status', [...ACTIVE_ACTION_STATUSES])
    .or(`module_instance_id.eq.${moduleInstanceId},module_instance_id.is.null`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as ExistingActionOption[];
}
