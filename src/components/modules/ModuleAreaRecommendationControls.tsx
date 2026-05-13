import DetailedFindingActionLink from '../actions/DetailedFindingActionLink';
import type { DetailedFindingAssessment } from '../../lib/actions/actionSourceLinks';

interface ModuleAreaRecommendationControlsProps {
  documentId: string;
  moduleInstanceId: string;
  moduleKey: string;
  areaKey: string;
  areaLabel: string;
  sourceAssessmentType?: string;
  defaultCategory?: string;
  defaultObservation?: string;
  defaultRiskImplication?: string;
  defaultRecommendation?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | 'unknown' | string;
  evidenceContext?: string;
  assessment?: DetailedFindingAssessment & Record<string, unknown>;
  legacyLinkedActionReference?: string;
  onLinked?: () => void;
}

export default function ModuleAreaRecommendationControls({
  documentId,
  moduleInstanceId,
  moduleKey,
  areaKey,
  areaLabel,
  sourceAssessmentType = 'module_area',
  defaultObservation = '',
  defaultRiskImplication = '',
  defaultRecommendation = '',
  severity = 'unknown',
  evidenceContext = '',
  assessment,
  legacyLinkedActionReference,
  onLinked,
}: ModuleAreaRecommendationControlsProps) {
  const mergedAssessment: DetailedFindingAssessment & Record<string, unknown> = {
    status: assessment?.status,
    observations: assessment?.observations || defaultObservation,
    deficiencies: assessment?.deficiencies || defaultRecommendation,
    existing_controls: assessment?.existing_controls,
    assessor_commentary: assessment?.assessor_commentary,
    risk_significance: assessment?.risk_significance || severity,
    evidence_references: assessment?.evidence_references || evidenceContext,
    action_trigger: assessment?.action_trigger,
    recommended_action_trigger: assessment?.recommended_action_trigger,
    condition_adequacy: assessment?.condition_adequacy,
    presence: assessment?.presence,
    risk_implication: defaultRiskImplication,
    ...assessment,
  };

  return (
    <DetailedFindingActionLink
      documentId={documentId}
      moduleInstanceId={moduleInstanceId}
      moduleKey={moduleKey}
      sourceAssessmentType={sourceAssessmentType}
      sourceAssessmentKey={areaKey}
      sourceAssessmentLabel={areaLabel}
      assessment={mergedAssessment}
      legacyLinkedActionReference={legacyLinkedActionReference}
      onLinked={onLinked}
    />
  );
}
