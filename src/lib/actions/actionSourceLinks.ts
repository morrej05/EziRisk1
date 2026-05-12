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

export function priorityFromDetailedFinding(assessment: DetailedFindingAssessment): { priority: string; severity: string; timescale: string } {
  const risk = String(assessment.risk_significance || '').toLowerCase();
  const trigger = String(assessment.recommended_action_trigger || '').toLowerCase();
  if (risk === 'critical' || trigger === 'urgent') return { priority: 'P1', severity: 'T4', timescale: 'immediate' };
  if (risk === 'high' || trigger === 'action_required') return { priority: 'P2', severity: 'T3', timescale: '30d' };
  if (risk === 'medium' || assessment.status === 'inadequate') return { priority: 'P3', severity: 'T2', timescale: '90d' };
  return { priority: 'P4', severity: 'T1', timescale: 'next_review' };
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
  const consequence = String(assessment.risk_significance || '').trim()
    ? `Risk significance: ${assessment.risk_significance}`
    : '';

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
    timeframe_guidance: priority.timescale,
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
