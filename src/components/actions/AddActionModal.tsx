import { useState, useRef, useEffect } from 'react';
import { X, AlertTriangle, Upload, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { uploadAttachment } from '../../utils/evidenceManagement';
import {
  deriveSeverity,
  type FraFindingCategory,
  type FraActionInput,
  type FraContext,
} from '../../lib/modules/fra/severityEngine';
import { bumpActionsVersion } from '../../lib/actions/actionsInvalidation';
import { compactRecommendationDetail, type RecommendationDetail } from '../../lib/actions/recommendationDetail';
import { areActionTextsNearDuplicate } from '../../lib/actions/actionSourceLinks';
import { getModuleOutcomeCategory } from '../../lib/modules/moduleCatalog';
import { deriveFsdProfessionalActionText } from '../../lib/fsd/fsdActionWording';
import { getPriorityExplanation } from '../recommendations/RecommendationWorkflow';
import { buildRecommendationContext } from '../../lib/re/recommendations/sectionRecommendationContext';

interface AddActionModalProps {
  documentId: string;
  moduleInstanceId: string;
  onClose: () => void;
  onActionCreated?: (actionId?: string) => void;
  defaultAction?: string;
  defaultLikelihood?: number;
  defaultImpact?: number;
  source?: 'manual' | 'info_gap' | 'recommendation' | 'system';
  sourceModuleKey?: string;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  defaultCategory?: string | null;
}

const TIMESCALE_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: '7d', label: 'Within 7 days' },
  { value: '30d', label: 'Within 30 days' },
  { value: '90d', label: 'Within 90 days' },
  { value: 'next_review', label: 'Next Review' },
  { value: 'custom', label: 'Custom' },
];


function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatSuggestedCompletion(value: string): string {
  switch (value) {
    case 'immediate':
      return 'Suggested completion: Immediately';
    case '7d':
      return 'Suggested completion: Within 7 days';
    case '30d':
      return 'Suggested completion: Within 30 days';
    case '90d':
      return 'Suggested completion: Within 90 days';
    case 'next_review':
      return 'Suggested completion: By the next scheduled review';
    default:
      return 'Suggested completion: To be agreed';
  }
}

function targetDateFromTimescale(timescale: string, baseDate = new Date()): string {
  const dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  switch (timescale) {
    case 'immediate':
      return toLocalIsoDate(dueDate);
    case '7d':
      dueDate.setDate(dueDate.getDate() + 7);
      return toLocalIsoDate(dueDate);
    case '30d':
      dueDate.setDate(dueDate.getDate() + 30);
      return toLocalIsoDate(dueDate);
    case '90d':
      dueDate.setDate(dueDate.getDate() + 90);
      return toLocalIsoDate(dueDate);
    default:
      return '';
  }
}

const DSEAR_TRIGGERS = [
  { id: 'noHac', label: 'Hazardous area classification not completed / not available', category: 'HAC' },
  { id: 'zone0_20Present', label: 'Zone 0 / Zone 20 present', category: 'HAC' },
  { id: 'zone1_21Present', label: 'Zone 1 / Zone 21 present', category: 'HAC' },
  { id: 'exEquipNotConfirmed', label: 'Ex equipment suitability/certification not confirmed for zone/group/temp class', category: 'Equipment' },
  { id: 'hotWorkControlsWeak', label: 'Hot work controls inadequate for classified areas', category: 'Controls' },
  { id: 'staticBondingMissing', label: 'Bonding/earthing/static control not confirmed', category: 'Controls' },
  { id: 'ventilationInadequate', label: 'Ventilation adequacy not assessed / likely inadequate for releases', category: 'Controls' },
  { id: 'dsrIncomplete', label: 'Dangerous substances register/SDS incomplete', category: 'Management' },
  { id: 'dustHousekeeping', label: 'Combustible dust accumulation / housekeeping inadequate', category: 'Management' },
];



type FsdFindingCategory =
  | 'RegulatoryBasis'
  | 'BuildingProfileOccupancy'
  | 'FireStrategy'
  | 'EscapeDesign'
  | 'EvacuationStrategy'
  | 'PassiveFireProtection'
  | 'ActiveFireSystems'
  | 'SmokeControl'
  | 'FireRescueServiceAccess'
  | 'DrawingsSchedules'
  | 'ConstructionPhaseFireSafety'
  | 'DeviationsAlternativeApproach'
  | 'InformationGap'
  | 'Other';

type ActionCategory = FraFindingCategory | FsdFindingCategory;

const FSD_CATEGORY_OPTIONS: Array<{ value: FsdFindingCategory; label: string }> = [
  { value: 'RegulatoryBasis', label: 'Regulatory Basis' },
  { value: 'BuildingProfileOccupancy', label: 'Building Profile / Occupancy' },
  { value: 'FireStrategy', label: 'Fire Strategy' },
  { value: 'EscapeDesign', label: 'Escape Design' },
  { value: 'EvacuationStrategy', label: 'Evacuation Strategy' },
  { value: 'PassiveFireProtection', label: 'Passive Fire Protection' },
  { value: 'ActiveFireSystems', label: 'Active Fire Systems' },
  { value: 'SmokeControl', label: 'Smoke Control' },
  { value: 'FireRescueServiceAccess', label: 'Fire & Rescue Service Access' },
  { value: 'DrawingsSchedules', label: 'Drawings & Schedules' },
  { value: 'ConstructionPhaseFireSafety', label: 'Construction Phase Fire Safety' },
  { value: 'DeviationsAlternativeApproach', label: 'Deviations / Alternative Approach' },
  { value: 'InformationGap', label: 'Information Gap' },
  { value: 'Other', label: 'Other' },
];

function getDefaultFsdCategory(sourceModuleKey?: string): FsdFindingCategory {
  switch (sourceModuleKey) {
    case 'FSD_1_REG_BASIS':
      return 'RegulatoryBasis';
    case 'A2_BUILDING_PROFILE':
    case 'A3_PERSONS_AT_RISK':
      return 'BuildingProfileOccupancy';
    case 'FSD_2_EVAC_STRATEGY':
      return 'EvacuationStrategy';
    case 'FSD_3_ESCAPE_DESIGN':
      return 'EscapeDesign';
    case 'FSD_4_PASSIVE_PROTECTION':
      return 'PassiveFireProtection';
    case 'FSD_5_ACTIVE_SYSTEMS':
      return 'ActiveFireSystems';
    case 'FSD_6_FRS_ACCESS':
      return 'FireRescueServiceAccess';
    case 'FSD_7_DRAWINGS':
      return 'DrawingsSchedules';
    case 'FSD_8_SMOKE_CONTROL':
      return 'SmokeControl';
    case 'FSD_9_CONSTRUCTION_PHASE':
      return 'ConstructionPhaseFireSafety';
    default:
      return 'FireStrategy';
  }
}


const FRA_CATEGORY_VALUES: FraFindingCategory[] = [
  'MeansOfEscape',
  'DetectionAlarm',
  'EmergencyLighting',
  'Compartmentation',
  'FireDoors',
  'FireFighting',
  'Management',
  'Housekeeping',
  'Other',
];

function toFraActionCategory(category?: string | null): FraFindingCategory | null {
  if (!category) return null;
  const compact = category.trim().replace(/[^a-z0-9]/gi, '').toLowerCase();
  const direct = FRA_CATEGORY_VALUES.find((value) => value.toLowerCase() === compact);
  if (direct) return direct;
  if (compact.includes('meansofescape') || compact.includes('evacuation')) return 'MeansOfEscape';
  if (compact.includes('detection') || compact.includes('alarm')) return 'DetectionAlarm';
  if (compact.includes('emergencylighting')) return 'EmergencyLighting';
  if (compact.includes('compartment')) return 'Compartmentation';
  if (compact.includes('firedoor')) return 'FireDoors';
  if (compact.includes('firefighting') || compact.includes('extinguisher')) return 'FireFighting';
  if (compact.includes('management') || compact.includes('procedure') || compact.includes('permit') || compact.includes('contractor')) return 'Management';
  if (compact.includes('hotwork') || compact.includes('kitchen') || compact.includes('cooking') || compact.includes('laundry') || compact.includes('charging') || compact.includes('ignition')) return 'Management';
  if (compact.includes('electricalinstallation') || compact.includes('electricalsafety') || compact.includes('fixedwiring') || compact.includes('eicr')) return 'Management';
  if (compact.includes('generalfireriskrecommendation')) return 'Management';
  if (compact.includes('housekeeping')) return 'Housekeeping';
  return null;
}

function getDefaultFraCategory(sourceModuleKey?: string): FraFindingCategory {
  switch (sourceModuleKey) {
    case 'FRA_2_ESCAPE_ASIS':
      return 'MeansOfEscape';
    case 'FRA_3_ACTIVE_SYSTEMS':
      return 'DetectionAlarm';
    case 'FRA_4_PASSIVE_PROTECTION':
      return 'Compartmentation';
    case 'FRA_8_FIREFIGHTING_EQUIPMENT':
      return 'FireFighting';
    case 'FRA_6_MANAGEMENT_SYSTEMS':
    case 'FRA_7_EMERGENCY_ARRANGEMENTS':
      return 'Management';
    case 'FRA_1_HAZARDS':
      return 'Management';
    default:
      return 'Other';
  }
}

function categoryLabel(category: ActionCategory): string {
  const fsd = FSD_CATEGORY_OPTIONS.find((option) => option.value === category);
  if (fsd) return fsd.label;
  const labels: Record<string, string> = {
    MeansOfEscape: 'Means of Escape',
    DetectionAlarm: 'Detection & Alarm',
    EmergencyLighting: 'Emergency Lighting',
    Compartmentation: 'Compartmentation',
    FireDoors: 'Fire Doors',
    FireFighting: 'Fire Fighting Equipment',
    Management: 'Management & Procedures',
    Housekeeping: 'Housekeeping',
    Other: 'General fire risk recommendation',
  };
  return labels[String(category)] || String(category);
}

export default function AddActionModal({
  documentId,
  moduleInstanceId,
  onClose,
  onActionCreated,
  defaultAction = '',
  source,
  sourceModuleKey,
  sectionKey,
  sectionLabel,
  sourceKey,
  sourceLabel,
  defaultCategory,
}: AddActionModalProps) {
  const { organisation, user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAttachmentPrompt, setShowAttachmentPrompt] = useState(false);
  const [showConsultancyDetail, setShowConsultancyDetail] = useState(false);
  const [showCategoryOverride, setShowCategoryOverride] = useState(false);
  const [showRuleInputs, setShowRuleInputs] = useState(false);
  const [createdActionId, setCreatedActionId] = useState<string | null>(null);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [uploadedFilesCount, setUploadedFilesCount] = useState(0);
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [userEditedActionText, setUserEditedActionText] = useState(false);
  const [userEditedTimescale, setUserEditedTimescale] = useState(false);
  const [userEditedTargetDate, setUserEditedTargetDate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recommendationContext = buildRecommendationContext({
    documentId,
    moduleInstanceId,
    moduleKey: sourceModuleKey || 'OTHER',
    sectionKey,
    sectionLabel,
    sourceKey,
    sourceLabel,
    defaultCategory,
    warnOnMissingContext: false,
  });

  const [formData, setFormData] = useState({
    recommendedAction: defaultAction,
    recommendationDetail: {
      observation: '',
      consequence: '',
      recommendation: defaultAction,
      rationale: '',
      standards_reference: '',
      timeframe_guidance: '',
      existing_controls: '',
      evidence_notes: '',
      linked_module: sourceModuleKey || '',
      assessor_commentary: '',
      management_response: '',
      status_notes: '',
    } as RecommendationDetail,
    category: 'Other' as ActionCategory,
    // FRA triggers
    finalExitLocked: false,
    finalExitObstructed: false,
    noFireDetection: false,
    detectionInadequateCoverage: false,
    noEmergencyLighting: false,
    seriousCompartmentationFailure: false,
    singleStairCompromised: false,
    highRiskRoomToEscapeRoute: false,
    noFraEvidenceOrReview: false,
    // DSEAR triggers
    noHac: false,
    zone0_20Present: false,
    zone1_21Present: false,
    exEquipNotConfirmed: false,
    hotWorkControlsWeak: false,
    staticBondingMissing: false,
    ventilationInadequate: false,
    dsrIncomplete: false,
    dustHousekeeping: false,
    // Common fields
    timescale: '',
    overrideJustification: '',
    targetDate: '',
    escalateToP1: false,
    escalationJustification: '',
  });

  // Reset edit tracking when modal opens with new props
  useEffect(() => {
    setUserEditedActionText(false);
    setFormData((prev) => ({
      ...prev,
      recommendedAction: defaultAction,
      recommendationDetail: {
        ...prev.recommendationDetail,
        recommendation: defaultAction,
        linked_module: recommendationContext.displayLabel || prev.recommendationDetail.linked_module || '',
        sectionKey: recommendationContext.sectionKey,
        sectionLabel: recommendationContext.sectionLabel,
        sourceKey: recommendationContext.sourceKey,
        sourceLabel: recommendationContext.sourceLabel,
        category: recommendationContext.defaultCategory,
        metadata: recommendationContext.metadata,
      },
    }));
  }, [defaultAction, documentId, moduleInstanceId, sourceModuleKey, recommendationContext.sectionKey, recommendationContext.sourceKey]);

  useEffect(() => {
    if (documentType === 'FSD') {
      setFormData((prev) => ({ ...prev, category: getDefaultFsdCategory(sourceModuleKey) }));
      return;
    }

    const contextCategory = toFraActionCategory(recommendationContext.defaultCategory);
    setFormData((prev) => ({
      ...prev,
      category: contextCategory || getDefaultFraCategory(sourceModuleKey),
    }));
  }, [documentType, sourceModuleKey, recommendationContext.defaultCategory]);

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const { data: doc, error: docError } = await supabase
          .from('documents')
          .select('document_type, enabled_modules')
          .eq('id', documentId)
          .single();

        if (docError) throw docError;
        setDocumentType(doc.document_type);
        setEnabledModules(doc.enabled_modules || [doc.document_type]);

      } catch (error) {
        console.error('Error fetching context:', error);
      } finally {
        setIsLoadingContext(false);
      }
    };

    fetchContext();
  }, [documentId]);

  // Build FRA context - for now, default to NonSleeping with 2 storeys
  // In a real implementation, fetch this from document/building profile
  const fraContext: FraContext = {
    occupancyRisk: 'NonSleeping',
    storeys: 2,
  };

  // Helper: Compute explosion trigger severity from state
  const computeExplosionTriggerSeverity = (): 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'NONE' => {
    const hasCritical = formData.noHac || formData.zone0_20Present;
    const hasHigh = formData.zone1_21Present || formData.exEquipNotConfirmed ||
                    formData.hotWorkControlsWeak || formData.staticBondingMissing;
    const hasModerate = formData.ventilationInadequate || formData.dsrIncomplete;
    const hasLow = formData.dustHousekeeping;

    if (hasCritical) return 'CRITICAL';
    if (hasHigh) return 'HIGH';
    if (hasModerate) return 'MODERATE';
    if (hasLow) return 'LOW';
    return 'NONE';
  };

  // Helper: Build human-readable trigger text
  const buildTriggerText = (): string => {
    const fireLabels: string[] = [];
    const explosionLabels: string[] = [];

    // Collect selected FRA triggers
    const FRA_TRIGGER_MAP = [
      { key: 'finalExitLocked', label: 'Final exit locked/secured' },
      { key: 'finalExitObstructed', label: 'Final exit obstructed' },
      { key: 'noFireDetection', label: 'No fire detection system' },
      { key: 'detectionInadequateCoverage', label: 'Detection coverage inadequate' },
      { key: 'noEmergencyLighting', label: 'No emergency lighting' },
      { key: 'seriousCompartmentationFailure', label: 'Serious compartmentation failure' },
      { key: 'singleStairCompromised', label: 'Single stair compromised' },
      { key: 'highRiskRoomToEscapeRoute', label: 'High-risk room to escape route' },
      { key: 'noFraEvidenceOrReview', label: 'No FRA evidence/overdue review' },
    ];

    for (const trigger of FRA_TRIGGER_MAP) {
      if (formData[trigger.key as keyof typeof formData]) {
        fireLabels.push(trigger.label);
      }
    }

    // Collect selected DSEAR triggers
    for (const trigger of DSEAR_TRIGGERS) {
      if (formData[trigger.id as keyof typeof formData]) {
        explosionLabels.push(trigger.label);
      }
    }

    // Build combined text
    const parts: string[] = [];
    if (fireLabels.length > 0) {
      parts.push(`Fire triggers: ${fireLabels.join(', ')}`);
    }
    if (explosionLabels.length > 0) {
      parts.push(`Explosion triggers: ${explosionLabels.join(', ')}`);
    }

    return parts.join('; ');
  };

  // Build action input for severity engine
  const actionInput: FraActionInput = {
    category: (formData.category as FraFindingCategory),
    finalExitLocked: formData.finalExitLocked,
    finalExitObstructed: formData.finalExitObstructed,
    noFireDetection: formData.noFireDetection,
    detectionInadequateCoverage: formData.detectionInadequateCoverage,
    noEmergencyLighting: formData.noEmergencyLighting,
    seriousCompartmentationFailure: formData.seriousCompartmentationFailure,
    singleStairCompromised: formData.singleStairCompromised,
    highRiskRoomToEscapeRoute: formData.highRiskRoomToEscapeRoute,
    noFraEvidenceOrReview: formData.noFraEvidenceOrReview,
    assessorMarkedCritical: formData.escalateToP1,
  };

  // Derive priority from appropriate severity engine(s) - deterministic combined logic
  let priorityBand: string;
  let severityTier: string;
  let triggerId: string;
  let triggerText: string;

  // Helper: Map severity to priority band
  const severityToPriority = (severity: string): { priority: string; tier: string } => {
    switch (severity) {
      case 'CRITICAL':
        return { priority: 'P1', tier: 'T4' };
      case 'HIGH':
        return { priority: 'P2', tier: 'T3' };
      case 'MODERATE':
        return { priority: 'P3', tier: 'T2' };
      case 'LOW':
        return { priority: 'P4', tier: 'T1' };
      default:
        return { priority: 'P4', tier: 'T1' };
    }
  };

  // Helper: Compare severities and return highest
  const getHighestSeverity = (sev1: string, sev2: string): string => {
    const rank = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, NONE: 0 };
    return (rank[sev1 as keyof typeof rank] || 0) >= (rank[sev2 as keyof typeof rank] || 0) ? sev1 : sev2;
  };

  // Determine which frameworks are enabled
  const hasFra = enabledModules.includes('FRA');
  const hasDsear = enabledModules.includes('DSEAR');

  // Compute severity from both engines if applicable
  let fraSeverity = 'NONE';
  let dsearSeverity = 'NONE';

  if (hasFra) {
    const severityResult = deriveSeverity(actionInput, fraContext);
    // Map FRA tier to severity name
    fraSeverity = severityResult.tier === 'T4' ? 'CRITICAL'
                : severityResult.tier === 'T3' ? 'HIGH'
                : severityResult.tier === 'T2' ? 'MODERATE'
                : 'LOW';
  }

  if (hasDsear) {
    dsearSeverity = computeExplosionTriggerSeverity();
  }

  // Choose final severity as highest of both
  const finalSeverity = getHighestSeverity(fraSeverity, dsearSeverity);
  const severityMapping = severityToPriority(finalSeverity);
  priorityBand = severityMapping.priority;
  severityTier = severityMapping.tier;

  // Build trigger_id and trigger_text
  const customTriggerText = buildTriggerText();

  if (customTriggerText) {
    // Use custom trigger text with selected labels
    triggerText = customTriggerText;
    // Set trigger_id based on final severity and source
    if (finalSeverity === dsearSeverity && dsearSeverity !== 'NONE') {
      triggerId = `EX-MANUAL-${finalSeverity}`;
    } else if (finalSeverity === fraSeverity && fraSeverity !== 'NONE') {
      triggerId = `FRA-MANUAL-${finalSeverity}`;
    } else {
      triggerId = `MANUAL-${finalSeverity}`;
    }
  } else {
    // No triggers selected - use defaults
    triggerId = 'MANUAL-LOW';
    triggerText = '';
  }

  // Allow manual escalation to P1 with justification
  if (formData.escalateToP1) {
    priorityBand = 'P1';
    severityTier = 'T4';
    triggerId = 'MANUAL-P1';
    triggerText = 'Manually escalated to P1 by assessor.';
  }

  // FRA-only: Apply critical module floor (P2/T3 minimum for critical modules)
  // If source module is 'critical' and derived priority is too low, clamp to P2/T3
  const isCriticalModule = sourceModuleKey && getModuleOutcomeCategory(sourceModuleKey) === 'critical';
  if (isCriticalModule && documentType === 'FRA') {
    // Floor priority: P3/P4 → P2 (don't downgrade P1)
    if (priorityBand === 'P3' || priorityBand === 'P4') {
      priorityBand = 'P2';
    }
    // Floor severity: T1/T2 → T3 (don't downgrade T4)
    if (severityTier === 'T1' || severityTier === 'T2') {
      severityTier = 'T3';
    }
  }

  const getSuggestedTimescale = (priorityBand: string): string => {
    switch (priorityBand) {
      case 'P1':
        return 'immediate';
      case 'P2':
        return '30d';
      case 'P3':
        return '90d';
      case 'P4':
        return 'next_review';
      default:
        return 'next_review';
    }
  };

  const suggestedTimescale = getSuggestedTimescale(priorityBand);
  const effectiveTimescale = formData.timescale || suggestedTimescale;
  const displayRecommendationCategory = recommendationContext.defaultCategory || categoryLabel(formData.category);
  const isTimescaleOverride = effectiveTimescale !== suggestedTimescale;
  const timescaleRank: Record<string, number> = { immediate: 0, '7d': 1, '30d': 2, '90d': 3, next_review: 4, custom: 5 };
  const isTimescaleRelaxation = isTimescaleOverride && (timescaleRank[effectiveTimescale] ?? 99) > (timescaleRank[suggestedTimescale] ?? 99);

  useEffect(() => {
    setFormData((prev) => {
      const nextTimescale = userEditedTimescale ? (prev.timescale || suggestedTimescale) : suggestedTimescale;
      const nextTargetDate = userEditedTargetDate ? prev.targetDate : targetDateFromTimescale(nextTimescale);

      if (prev.timescale === nextTimescale && prev.targetDate === nextTargetDate) {
        return prev;
      }

      return { ...prev, timescale: nextTimescale, targetDate: nextTargetDate };
    });
  }, [suggestedTimescale, userEditedTargetDate, userEditedTimescale]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P1':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'P2':
        return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'P3':
        return 'bg-amber-100 text-amber-700 border-amber-300';
      case 'P4':
        return 'bg-blue-100 text-blue-700 border-blue-300';
      default:
        return 'bg-neutral-100 text-neutral-600 border-neutral-300';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organisation?.id || !user?.id) {
      alert('User or organisation not found. Please refresh and try again.');
      return;
    }

    if (!formData.recommendedAction.trim()) {
      alert('Please enter a recommended action.');
      return;
    }

    if (formData.escalateToP1 && !formData.escalationJustification.trim()) {
      alert('Please provide a justification for escalating this action to P1.');
      return;
    }

    if (isTimescaleRelaxation && !formData.overrideJustification.trim()) {
      alert('Please provide a justification for overriding the suggested timescale.');
      return;
    }

    setIsSubmitting(true);

    try {
      const normalizedActionText = (documentType === 'FSD'
        ? deriveFsdProfessionalActionText({
            recommendedAction: formData.recommendedAction,
            moduleKey: sourceModuleKey,
          })
        : formData.recommendedAction).trim();
      const trimmedAction = normalizedActionText.toLowerCase();

      const { data: existingActions, error: checkError } = await supabase
        .from('actions')
        .select('id, recommended_action')
        .eq('document_id', documentId)
        .eq('module_instance_id', moduleInstanceId)
        .is('deleted_at', null);

      if (checkError) throw checkError;

      const duplicate = existingActions?.find(
        (action) => action.recommended_action.trim().toLowerCase() === trimmedAction
      );

      if (duplicate) {
        setIsSubmitting(false);
        alert('This action already exists in this module.');
        return;
      }

      const nearDuplicate = existingActions?.find(
        (action) => areActionTextsNearDuplicate(normalizedActionText, action.recommended_action)
      );

      if (nearDuplicate && !window.confirm('A very similar action already exists in this module. Create this additional recommendation anyway?')) {
        setIsSubmitting(false);
        return;
      }

      const targetDate = formData.targetDate || targetDateFromTimescale(effectiveTimescale) || null;

      // Resolve source based on whether user edited the text
      const resolvedSource: 'manual' | 'system' =
        source === 'system' || source === 'info_gap' || source === 'recommendation'
          ? 'system'
          : userEditedActionText
            ? 'manual'
            : defaultAction.trim()
              ? 'system'
              : 'manual';

      const recommendationDetail = compactRecommendationDetail({
        ...formData.recommendationDetail,
        recommendation: formData.recommendationDetail.recommendation || normalizedActionText,
        timeframe_guidance: formData.recommendationDetail.timeframe_guidance || formatSuggestedCompletion(effectiveTimescale),
        linked_module: formData.recommendationDetail.linked_module || recommendationContext.displayLabel || '',
        sectionKey: recommendationContext.sectionKey,
        sectionLabel: recommendationContext.sectionLabel,
        sourceKey: recommendationContext.sourceKey,
        sourceLabel: recommendationContext.sourceLabel,
        category: recommendationContext.defaultCategory,
        metadata: {
          ...(typeof formData.recommendationDetail.metadata === 'object' && formData.recommendationDetail.metadata !== null
            ? formData.recommendationDetail.metadata
            : {}),
          ...recommendationContext.metadata,
        },
      });

      const actionData = {
        organisation_id: organisation.id,
        document_id: documentId,
        source_document_id: documentId,
        module_instance_id: moduleInstanceId,
        recommended_action: normalizedActionText,
        status: 'open',
        priority_band: priorityBand,
        severity_tier: severityTier,
        trigger_id: triggerId,
        trigger_text: triggerText,
        finding_category: formData.category,
        timescale: effectiveTimescale,
        target_date: targetDate,
        override_justification: isTimescaleOverride
          ? formData.overrideJustification.trim()
          : null,
        escalation_justification: formData.escalateToP1
          ? formData.escalationJustification.trim()
          : null,
        source: resolvedSource,
        recommendation_detail: recommendationDetail,
      };

      const { data: action, error: actionError } = await supabase
        .from('actions')
        .insert([actionData])
        .select()
        .single();

      if (actionError) throw actionError;

      bumpActionsVersion();
      setCreatedActionId(action.id);
      setShowAttachmentPrompt(true);
      // DO NOT call onActionCreated() here - it will be called when user finishes with attachments
    } catch (error) {
      console.error('Error creating action:', error);
      alert('Failed to create action. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !organisation?.id || !createdActionId) return;

    setIsUploadingAttachments(true);
    try {
      // Fetch document to get base_document_id
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .select('base_document_id')
        .eq('id', documentId)
        .single();

      if (docError || !docData) {
        throw new Error('Failed to fetch document information');
      }

      // Upload files using the clean uploader (no organisations quota update)
      let successCount = 0;
      for (const file of Array.from(files)) {
        const result = await uploadAttachment(
          organisation.id,
          documentId,
          docData.base_document_id,
          file,
          undefined, // caption
          moduleInstanceId,
          createdActionId
        );

        if (result.success) {
          successCount++;
        } else {
          console.error('Upload failed:', result.error);
          throw new Error(result.error || 'Upload failed');
        }
      }

      setUploadedFilesCount(prev => prev + successCount);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      alert(`${successCount} file(s) attached successfully!`);
    } catch (error) {
      console.error('Error uploading attachments:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to upload attachments: ${errorMessage}`);
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleFinish = () => {
    onActionCreated?.(createdActionId || undefined);
    onClose();
  };

  if (showAttachmentPrompt) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
          <div className="bg-green-50 border-b border-green-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <h2 className="text-xl font-bold text-green-900">Recommendation Created!</h2>
            </div>
          </div>

          <div className="p-6">
            <p className="text-neutral-700 mb-4">
              No evidence added yet. Add photos, documents or notes to support this recommendation.
            </p>

            {uploadedFilesCount > 0 && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">
                  {uploadedFilesCount} evidence item{uploadedFilesCount !== 1 ? 's' : ''} linked to this recommendation.
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
              onChange={handleAttachmentUpload}
              className="hidden"
            />

            <div className="space-y-3">
              {uploadedFilesCount > 0 ? (
                <>
                  <button
                    onClick={handleFinish}
                    disabled={isUploadingAttachments}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-neutral-900 text-white rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Done
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingAttachments}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    {isUploadingAttachments ? 'Uploading...' : 'Attach More Files'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingAttachments}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-neutral-900 text-white rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    {isUploadingAttachments ? 'Uploading...' : 'Attach Files'}
                  </button>

                  <button
                    onClick={handleFinish}
                    disabled={isUploadingAttachments}
                    className="w-full px-4 py-3 border-2 border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors disabled:opacity-50"
                  >
                    Skip for Now
                  </button>
                </>
              )}
            </div>

            <p className="text-xs text-neutral-500 mt-4 text-center">
              You can also attach files later from the Evidence tab
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingContext) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900"></div>
            <p className="text-neutral-600">Loading context...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex-shrink-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900">Add Recommendation</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form id="add-action-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Recommendation / action required <span className="text-red-600">*</span>
            </label>
            <textarea
              value={formData.recommendedAction}
              onChange={(e) => {
                setFormData({ ...formData, recommendedAction: e.target.value });
                setUserEditedActionText(true);
              }}
              placeholder="Describe the recommended action to address the identified deficiency or risk..."
              rows={4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Observation / finding</label>
              <textarea
                value={formData.recommendationDetail.observation || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  recommendationDetail: { ...formData.recommendationDetail, observation: e.target.value },
                })}
                placeholder="What was found or observed?"
                rows={2}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Risk implication / consequence</label>
              <textarea
                value={formData.recommendationDetail.consequence || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  recommendationDetail: { ...formData.recommendationDetail, consequence: e.target.value },
                })}
                placeholder="Why does this matter from a fire safety perspective?"
                rows={2}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none"
              />
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-700">Evidence</p>
                  <p className="mt-1 text-sm text-neutral-500">No evidence added yet.</p>
                </div>
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-500 disabled:cursor-not-allowed"
                  title="Create the recommendation first, then add files in the evidence step."
                >
                  <Upload className="h-4 w-4" />
                  + Add evidence after save
                </button>
              </div>
            </div>
          </div>

          <div className="border border-neutral-200 rounded-lg bg-neutral-50">
            <button
              type="button"
              onClick={() => setShowConsultancyDetail(!showConsultancyDetail)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-semibold text-neutral-900">Advanced</div>
                <div className="text-xs text-neutral-600">Standards, existing controls, assurance commentary, management response and advanced details.</div>
              </div>
              <span className="text-sm font-medium text-blue-700">{showConsultancyDetail ? 'Hide' : 'Expand'}</span>
            </button>

            {showConsultancyDetail && (
              <div className="px-4 pb-4 grid grid-cols-1 gap-3">
                {[
                  ['rationale', 'Recommendation rationale', 'Explain why the recommendation is proportionate and defensible.'],
                  ['standards_reference', 'Standards / guidance reference', 'e.g. Fire Safety Order, PAS 79, BS 9999, BS 5839, BS 5266, Approved Document B...'],
                  ['existing_controls', 'Existing controls noted', 'Record relevant existing controls or interim measures.'],
                  ['assessor_commentary', 'Assessor commentary', 'Professional judgement, limitations or client-specific context.'],
                  ['management_response', 'Management response / status notes', 'Optional client response, agreed action or deferral note.'],
                ].map(([key, label, placeholder]) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">{label}</label>
                    <textarea
                      value={String(formData.recommendationDetail[key as keyof RecommendationDetail] || '')}
                      onChange={(e) => setFormData({
                        ...formData,
                        recommendationDetail: { ...formData.recommendationDetail, [key]: e.target.value },
                      })}
                      placeholder={placeholder}
                      rows={key === 'rationale' || key === 'consequence' ? 3 : 2}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none text-sm bg-white"
                    />
                  </div>
                ))}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Suggested completion</label>
                    <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800">
                      {formData.recommendationDetail.timeframe_guidance || formatSuggestedCompletion(effectiveTimescale)}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">Adjust the editable target completion date below if assessor judgement requires a different date.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Linked assessment area</label>
                    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
                      {recommendationContext.displayLabel || 'Assessment area'}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">This is set by the section where the recommendation was opened.</p>
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <button
                    type="button"
                    onClick={() => setShowCategoryOverride(!showCategoryOverride)}
                    className="flex w-full items-center justify-between text-left text-sm font-medium text-neutral-800"
                  >
                    <span>Change recommendation category</span>
                    <span className="text-blue-700">{showCategoryOverride ? 'Hide' : 'Show'}</span>
                  </button>
                  {showCategoryOverride && (
                    <select
                      value={formData.category}
                      onChange={(e) =>
                        setFormData({ ...formData, category: e.target.value as ActionCategory })
                      }
                      className="mt-3 w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent bg-white"
                      required
                    >
                      {documentType === 'FSD' ? (
                        FSD_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.value === 'Other' ? 'General fire risk recommendation' : option.label}</option>
                        ))
                      ) : (
                        <>
                          <option value="MeansOfEscape">Means of escape</option>
                          <option value="DetectionAlarm">Detection & alarm</option>
                          <option value="EmergencyLighting">Emergency lighting</option>
                          <option value="Compartmentation">Compartmentation</option>
                          <option value="FireDoors">Fire doors</option>
                          <option value="FireFighting">Firefighting equipment</option>
                          <option value="Management">Fire safety management</option>
                          <option value="Housekeeping">Housekeeping / fire load</option>
                          <option value="Other">General fire risk recommendation</option>
                        </>
                      )}
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Recommendation category</span>
            <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-800">
              {displayRecommendationCategory || 'General fire risk recommendation'}
            </span>
          </div>

          {documentType !== 'FSD' && <div className="border border-neutral-200 rounded-lg p-4">
            <button
              type="button"
              onClick={() => setShowRuleInputs(!showRuleInputs)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <span className="block text-sm font-medium text-neutral-700">Advanced priority details</span>
                <span className="block text-xs text-neutral-500 mt-1">Hidden by default. Use only when observed conditions should change the suggested priority.</span>
              </div>
              <span className="text-sm font-medium text-blue-700">{showRuleInputs ? 'Hide' : 'Show'}</span>
            </button>
            <div className={showRuleInputs ? 'mt-4' : 'hidden'}>
                <label className="block text-sm font-medium text-neutral-700 mb-3">
                  Priority conditions (check if applicable)
                </label>
            <div className="space-y-2">
              {/* Show FRA triggers if FRA is enabled */}
              {hasFra && (
                <>
                  {hasDsear && (
                    <div className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2 mt-2">
                      Fire Safety Triggers
                    </div>
                  )}
                  {/* FRA Triggers */}
                  {(formData.category === 'MeansOfEscape' || formData.category === 'Other') && (
                    <>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.finalExitLocked}
                          onChange={(e) => setFormData({ ...formData, finalExitLocked: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">Final exit locked / secured</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.finalExitObstructed}
                          onChange={(e) => setFormData({ ...formData, finalExitObstructed: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">Final exit obstructed</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.singleStairCompromised}
                          onChange={(e) => setFormData({ ...formData, singleStairCompromised: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">Single stair compromised (multi-storey)</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.highRiskRoomToEscapeRoute}
                          onChange={(e) => setFormData({ ...formData, highRiskRoomToEscapeRoute: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">High-risk room opens onto escape route</span>
                      </label>
                    </>
                  )}
                  {(formData.category === 'DetectionAlarm' || formData.category === 'Other') && (
                    <>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.noFireDetection}
                          onChange={(e) => setFormData({ ...formData, noFireDetection: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">No fire detection system present</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.detectionInadequateCoverage}
                          onChange={(e) => setFormData({ ...formData, detectionInadequateCoverage: e.target.checked })}
                          className="mt-1"
                        />
                        <span className="text-sm text-neutral-700">Detection coverage inadequate</span>
                      </label>
                    </>
                  )}
                  {(formData.category === 'EmergencyLighting' || formData.category === 'Other') && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.noEmergencyLighting}
                        onChange={(e) => setFormData({ ...formData, noEmergencyLighting: e.target.checked })}
                        className="mt-1"
                      />
                      <span className="text-sm text-neutral-700">No emergency lighting present (multi-storey)</span>
                    </label>
                  )}
                  {(formData.category === 'Compartmentation' || formData.category === 'Other') && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.seriousCompartmentationFailure}
                        onChange={(e) => setFormData({ ...formData, seriousCompartmentationFailure: e.target.checked })}
                        className="mt-1"
                      />
                      <span className="text-sm text-neutral-700">Serious compartmentation failure</span>
                    </label>
                  )}
                  {(formData.category === 'Management' || formData.category === 'Other') && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.noFraEvidenceOrReview}
                        onChange={(e) => setFormData({ ...formData, noFraEvidenceOrReview: e.target.checked })}
                        className="mt-1"
                      />
                      <span className="text-sm text-neutral-700">No FRA evidence / overdue review</span>
                    </label>
                  )}
                </>
              )}

              {/* Show DSEAR triggers if DSEAR is enabled */}
              {hasDsear && (
                <>
                  {hasFra && (
                    <div className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2 mt-4">
                      Explosion Hazard Triggers
                    </div>
                  )}
                  {/* DSEAR Triggers */}
                  {DSEAR_TRIGGERS.map((trigger) => (
                    <label key={trigger.id} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData[trigger.id as keyof typeof formData] as boolean}
                        onChange={(e) => setFormData({ ...formData, [trigger.id]: e.target.checked })}
                        className="mt-1"
                      />
                      <span className="text-sm text-neutral-700">{trigger.label}</span>
                    </label>
                  ))}
                </>
              )}
              </div>
            </div>
          </div>}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-neutral-700">Derived severity:</span>
              <span className="text-lg font-bold text-neutral-900">{severityTier}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-700">Suggested priority:</span>
              <span
                className={`inline-flex px-3 py-1 text-sm font-bold rounded border ${getPriorityColor(
                  priorityBand
                )}`}
              >
                {priorityBand}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              Why this priority? {getPriorityExplanation(priorityBand)}
            </p>
          </div>

          {priorityBand !== 'P1' && (
            <div className="border border-neutral-200 rounded-lg p-4 bg-neutral-50">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.escalateToP1}
                  onChange={(e) => setFormData({ ...formData, escalateToP1: e.target.checked })}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-neutral-700">Escalate to P1 (requires justification)</span>
                  {formData.escalateToP1 && (
                    <textarea
                      value={formData.escalationJustification}
                      onChange={(e) => setFormData({ ...formData, escalationJustification: e.target.value })}
                      placeholder="Explain why this action should be escalated to P1..."
                      rows={2}
                      className="w-full mt-2 px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none text-sm"
                      required={formData.escalateToP1}
                    />
                  )}
                </div>
              </label>
            </div>
          )}

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Suggested completion <span className="text-red-600">*</span>
            </label>
            <select
              value={effectiveTimescale}
              onChange={(e) => {
                const nextTimescale = e.target.value;
                setUserEditedTimescale(true);
                setFormData({
                  ...formData,
                  timescale: nextTimescale,
                  targetDate: userEditedTargetDate ? formData.targetDate : targetDateFromTimescale(nextTimescale),
                });
              }}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              required
            >
              {TIMESCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.value === suggestedTimescale && ' (suggested)'}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-600 mt-2">
              <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-800">{formatSuggestedCompletion(suggestedTimescale)}</span>
            </p>
            {isTimescaleRelaxation && (
              <div className="mt-2 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  The selected target timeframe is later than the priority-derived suggestion for {priorityBand}.
                  Please provide a justification below.
                </p>
              </div>
            )}
          </div>

          {isTimescaleRelaxation && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Later target date justification <span className="text-red-600">*</span>
              </label>
              <textarea
                value={formData.overrideJustification}
                onChange={(e) =>
                  setFormData({ ...formData, overrideJustification: e.target.value })
                }
                placeholder="Explain why a later target completion date is appropriate..."
                rows={3}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
                required
              />
            </div>
          )}

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
            <label className="block text-sm font-semibold text-neutral-800 mb-2">
              Target completion date
            </label>
            <input
              type="date"
              value={formData.targetDate}
              onChange={(e) => {
                setUserEditedTargetDate(true);
                setFormData({ ...formData, targetDate: e.target.value });
              }}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent bg-white"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Auto-populated from the selected priority. You can change it manually; a later target requires justification.
            </p>
          </div>

        </form>
        <div className="flex-shrink-0 flex items-center gap-3 justify-end px-6 py-4 border-t border-neutral-200 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-action-form"
            disabled={isSubmitting || !formData.recommendedAction.trim()}
            className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${
              isSubmitting || !formData.recommendedAction.trim()
                ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            {isSubmitting ? 'Creating...' : 'Create Recommendation'}
          </button>
        </div>
      </div>
    </div>
  );
}
