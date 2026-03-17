import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, Info, Droplet, Building as BuildingIcon, TrendingUp } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  generateFireProtectionRecommendations,
  getSiteRecommendations,
  getBuildingRecommendations,
} from '../../../lib/modules/re04FireProtectionRecommendations';
import {
  calculateSprinklerScore,
  calculateFinalActiveScore,
  generateAutoFlags,
  calculateWaterScore,
} from '../../../lib/re/fireProtectionModel';
import { syncAutoRecToRegister } from '../../../lib/re/recommendations/recommendationPipeline';
import type { AutoRecommendationLifecycleState } from '../../../lib/re/recommendations/recommendationPipeline';
import FireProtectionRecommendations from '../../re/FireProtectionRecommendations';
import ModuleActions from '../ModuleActions';
import RatingButtons from '../../re/RatingButtons';
import FloatingSaveBar from './FloatingSaveBar';
import { updateSectionGrade } from '../../../utils/sectionGrades';

interface Document {
  id: string;
  title: string;
  document_type: string;
}

interface ModuleInstance {
  id: string;
  document_id: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface RE06FireProtectionFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

type WaterReliability = 'Reliable' | 'Unreliable' | 'Unknown';
type PumpArrangement = 'None' | 'Single' | 'Duty+Standby' | 'Unknown';
type PowerResilience = 'Good' | 'Mixed' | 'Poor' | 'Unknown';
type TestingRegime = 'Documented' | 'Some evidence' | 'None' | 'Unknown';
type MaintenanceStatus = 'Good' | 'Mixed' | 'Poor' | 'Unknown';
type SprinklerAdequacy = 'Adequate' | 'Inadequate' | 'Unknown';
type SupplyType =
  | 'Town mains'
  | 'Single tank (on-site)'
  | 'Dual tank (on-site)'
  | 'Break tank + mains'
  | 'Open water (reservoir)'
  | 'River / canal / open source'
  | 'Private main / estate main'
  | 'Other';
type WaterSupports = 'Sprinklers' | 'Hydrants / fire main / hose reels' | 'Both' | 'Unknown';
type CoverageQuality = 'Good' | 'Partial' | 'Poor' | 'Unknown';
type ConditionQuality = 'Good' | 'Concerns' | 'Unknown';
type YesNoUnknown = 'Yes' | 'No' | 'Unknown';
type TestEvidence = 'Documented' | 'Not documented' | 'Unknown';

interface SiteWaterData {
  water_reliability?: WaterReliability;
  supply_type?: string; // Now stores SupplyType value or legacy string
  supply_type_other?: string;
  supports?: WaterSupports;
  pumps_present?: boolean;
  pump_arrangement?: PumpArrangement;
  power_resilience?: PowerResilience;
  testing_regime?: TestingRegime;
  key_weaknesses?: string;
  // New hydrant/hose fields (PASS 1 additive)
  hydrant_coverage?: CoverageQuality;
  fire_main_condition?: ConditionQuality;
  hose_reels_present?: YesNoUnknown;
  flow_test_evidence?: TestEvidence;
  flow_test_date?: string;
}

type SprinklersInstalled = 'Yes' | 'No' | 'Partial' | 'Unknown';
type SystemType = 'Wet pipe' | 'Dry pipe' | 'Pre-action' | 'Deluge' | 'Combination / Mixed' | 'Unknown';
type SprinklerStandard = 'EN 12845' | 'NFPA 13' | 'FM' | 'LPC Rules' | 'VdS' | 'AS 2118' | 'NZS 4541' | 'SANS 10287' | 'Other…';
type LocalisedRequired = 'Yes' | 'No' | 'Unknown';
type LocalisedPresent = 'Yes' | 'No' | 'Unknown';
type DetectionInstalled = 'Yes' | 'No' | 'Partial' | 'Unknown';
type AlarmMonitoring = 'Local only' | 'ARC' | 'Fire brigade connection' | 'Unknown';
type DetectionTestingRegime = 'Documented' | 'Not documented' | 'Unknown';
type DetectionMaintenanceStatus = 'Good' | 'Concerns' | 'Unknown';

interface BuildingSprinklerData {
  // New fields
  sprinklers_installed?: SprinklersInstalled;
  system_type?: SystemType;
  standard?: SprinklerStandard;
  standard_other?: string;
  localised_required?: LocalisedRequired;
  localised_present?: LocalisedPresent;
  localised_type?: string; // Predominant type for now (Gas suppression, Water mist, Foam, Other)
  localised_protected_asset?: string;
  localised_comments?: string;

  // Existing fields
  sprinkler_coverage_installed_pct?: number | null;
  sprinkler_coverage_required_pct?: number | null;
  sprinkler_standard?: string; // Legacy field - will migrate to 'standard'
  hazard_class?: string;
  maintenance_status?: MaintenanceStatus;
  sprinkler_adequacy?: SprinklerAdequacy;
  justification_if_required_lt_100?: string;
  sprinkler_score_1_5?: number | null;
  final_active_score_1_5?: number | null;

  // Fire Detection & Alarm fields
  detection_installed?: DetectionInstalled;
  detection_types?: string[]; // Multi-select: 'Automatic point detection (smoke/heat)', 'Manual call points', 'Aspirating (VESDA)', 'Beam', 'Flame', 'Linear heat', 'Other'
  detection_type_other?: string;
  alarm_monitoring?: AlarmMonitoring;
  detection_testing_regime?: DetectionTestingRegime;
  detection_maintenance_status?: DetectionMaintenanceStatus;
  detection_comments?: string;
  detection_score_1_5?: number | null;
}

interface Building {
  id: string;
  ref?: string;
  description?: string;
  footprint_m2?: number;
  floor_area_sqm?: number;
}

interface BuildingFireProtection {
  sprinklerData?: BuildingSprinklerData;
  comments?: string;
}

interface FireProtectionModuleData {
  buildings: Record<string, BuildingFireProtection>;
  site: {
    water: SiteWaterData;
    water_score_1_5?: number | null; // null = not rated
    comments?: string;
  };
  supplementary_assessment?: SupplementaryAssessmentData;
}

type SupplementaryQuestionGroup = 'adequacy' | 'reliability' | 'localised_special';

const AUTO_REC_STATE_LABELS: Record<AutoRecommendationLifecycleState, string> = {
  none: 'No recommendation created',
  created: 'Auto recommendation created',
  updated: 'Auto recommendation updated',
  restored: 'Auto recommendation restored',
  suppressed: 'Recommendation suppressed',
};

const focusRingClass = 'focus:ring-blue-500';

function getAutoRecStateStyles(state: AutoRecommendationLifecycleState): string {
  if (state === 'suppressed') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (state === 'none') return 'bg-slate-50 text-slate-600 border-slate-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

interface SupplementaryQuestionResponse {
  factor_key: string;
  group: SupplementaryQuestionGroup;
  prompt: string;
  score_1_5: number | null;
  notes: string;
}

interface SupplementaryAssessmentData {
  questions: SupplementaryQuestionResponse[];
  adequacy_subscore: number | null;
  reliability_subscore: number | null;
  localised_special_subscore: number | null;
  overall_score: number | null;
}

const SUPPLEMENTARY_FIRE_QUESTIONS: Array<Pick<SupplementaryQuestionResponse, 'factor_key' | 'group' | 'prompt'>> = [
  {
    factor_key: 're06_fp_adequacy_sprinkler_coverage',
    group: 'adequacy',
    prompt: 'Are sprinkler systems (where required) adequately matched to hazard, storage, and occupancy profile?',
  },
  {
    factor_key: 're06_fp_adequacy_hydrants_fire_main',
    group: 'adequacy',
    prompt: 'Are hydrants / ring main / hose reels sufficient in number, reach, and layout for firefighting access?',
  },
  {
    factor_key: 're06_fp_adequacy_water_capacity',
    group: 'adequacy',
    prompt: 'Is firewater supply capacity and duration adequate for expected design fire demand?',
  },
  {
    factor_key: 're06_fp_adequacy_detection_alarm',
    group: 'adequacy',
    prompt: 'Is detection and alarm coverage adequate for early warning across occupied and high-risk areas?',
  },
  {
    factor_key: 're06_fp_adequacy_passive_protection',
    group: 'adequacy',
    prompt: 'Is passive fire protection (compartmentation, fire stopping, structural protection) adequate for containment?',
  },
  {
    factor_key: 're06_fp_reliability_water_supply',
    group: 'reliability',
    prompt: 'How reliable is the primary and backup water supply under likely incident and utility-loss conditions?',
  },
  {
    factor_key: 're06_fp_reliability_pumps_power',
    group: 'reliability',
    prompt: 'How reliable are pumps, controls, and power resilience arrangements for sustained firefighting support?',
  },
  {
    factor_key: 're06_fp_reliability_system_condition',
    group: 'reliability',
    prompt: 'How reliable is current system condition based on maintenance, impairment control, and defect history?',
  },
  {
    factor_key: 're06_fp_reliability_testing',
    group: 'reliability',
    prompt: 'How reliable is performance evidence from routine inspection, testing, and flow / functional verification?',
  },
  {
    factor_key: 're06_fp_localised_systems_provided',
    group: 'localised_special',
    prompt: 'Are local application or process-specific suppression systems provided where needed?',
  },
  {
    factor_key: 're06_fp_localised_hazard_match',
    group: 'localised_special',
    prompt: 'Is the protection matched to the actual hazard/process?',
  },
  {
    factor_key: 're06_fp_localised_coverage_positioning',
    group: 'localised_special',
    prompt: 'Is coverage/positioning adequate to protect the hazard effectively?',
  },
  {
    factor_key: 're06_fp_localised_itm_reliability',
    group: 'localised_special',
    prompt: 'Is inspection, testing, and maintenance of localised systems reliable?',
  },
  {
    factor_key: 're06_fp_localised_shutdown_response',
    group: 'localised_special',
    prompt: 'Are shutdown, isolation, and operator response arrangements adequate for these protected hazards?',
  },
];

function createDefaultSupplementaryAssessment(): SupplementaryAssessmentData {
  return {
    questions: SUPPLEMENTARY_FIRE_QUESTIONS.map((question) => ({
      ...question,
      score_1_5: null,
      notes: '',
    })),
    adequacy_subscore: null,
    reliability_subscore: null,
    localised_special_subscore: null,
    overall_score: null,
  };
}

function normalizeSupplementaryAssessment(
  assessment?: SupplementaryAssessmentData
): SupplementaryAssessmentData {
  const defaultAssessment = createDefaultSupplementaryAssessment();
  const existingByFactor = new Map((assessment?.questions || []).map((q) => [q.factor_key, q]));

  return {
    ...defaultAssessment,
    ...assessment,
    questions: SUPPLEMENTARY_FIRE_QUESTIONS.map((question) => {
      const existing = existingByFactor.get(question.factor_key);
      return {
        ...question,
        score_1_5: existing?.score_1_5 ?? null,
        notes: existing?.notes || '',
      };
    }),
  };
}

function deriveSupplementaryScores(
  questions: SupplementaryQuestionResponse[],
  options?: { includeLocalisedGroup?: boolean }
) {
  const includeLocalisedGroup = options?.includeLocalisedGroup ?? true;
  const byGroup = {
    adequacy: questions.filter((q) => q.group === 'adequacy' && q.score_1_5 !== null),
    reliability: questions.filter((q) => q.group === 'reliability' && q.score_1_5 !== null),
    localised_special: includeLocalisedGroup
      ? questions.filter((q) => q.group === 'localised_special' && q.score_1_5 !== null)
      : [],
  };

  const average = (items: SupplementaryQuestionResponse[]) => {
    if (items.length === 0) return null;
    const sum = items.reduce((acc, item) => acc + Number(item.score_1_5), 0);
    return Math.round((sum / items.length) * 10) / 10;
  };

  const adequacy_subscore = average(byGroup.adequacy);
  const reliability_subscore = average(byGroup.reliability);
  const ratedQuestions = questions.filter(
    (q) => q.score_1_5 !== null && (includeLocalisedGroup || q.group !== 'localised_special')
  );
  const localised_special_subscore = average(byGroup.localised_special);
  const overall_score = average(ratedQuestions);

  return {
    adequacy_subscore,
    reliability_subscore,
    localised_special_subscore,
    overall_score,
  };
}



function initializeAutoRecStates(
  questions: SupplementaryQuestionResponse[]
): Record<string, AutoRecommendationLifecycleState> {
  return questions.reduce((acc, question) => {
    acc[question.factor_key] = 'none';
    return acc;
  }, {} as Record<string, AutoRecommendationLifecycleState>);
}

function parseAreaValue(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Remove commas and parse
    const cleaned = value.replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function calculateSiteRollup(
  fireProtectionData: FireProtectionModuleData,
  buildings: Building[]
): {
  averageScore: number;
  buildingsAssessed: number;
  requiredSprinklerArea: number;
  installedSprinklerArea: number;
  shortfallArea: number;
  compliancePct: number;
  someAreaMissing: boolean;
  totalArea_m2: number;
  installedCoverage_pct: number;
  requiredCoverage_pct: number;
  buildingsWithArea: number;
} {
  let totalWeightedScore = 0;
  let totalWeight = 0;
  let requiredSprinklerArea = 0;
  let installedSprinklerArea = 0;
  let buildingsAssessed = 0;
  let someAreaMissing = false;
  let totalArea_m2 = 0;
  let buildingsWithArea = 0;

  for (const building of buildings) {
    const buildingFP = fireProtectionData.buildings[building.id];
    if (!buildingFP?.sprinklerData) continue;

    // Include any building where sprinkler coverage is required, even if currently not installed
    const requiredPct = buildingFP.sprinklerData.sprinkler_coverage_required_pct ?? 0;
    if (requiredPct <= 0) continue;

    const finalScore = buildingFP.sprinklerData.final_active_score_1_5;
    if (finalScore === null || finalScore === undefined) continue;

    // Parse area robustly (handles strings like "1,200", nulls, etc.)
    const area = parseAreaValue(building.footprint_m2);

    if (area > 0) {
      const installedPct = buildingFP.sprinklerData.sprinkler_coverage_installed_pct ?? 0;
      requiredSprinklerArea += (area * requiredPct) / 100;
      installedSprinklerArea += (area * installedPct) / 100;
      totalArea_m2 += area;
      buildingsWithArea++;

      // Use area for weighted scoring
      totalWeightedScore += finalScore * area;
      totalWeight += area;
    } else {
      // Building has no area - still count for scoring with weight=1, but mark as missing
      totalWeightedScore += finalScore * 1;
      totalWeight += 1;
      someAreaMissing = true;
    }

    buildingsAssessed++;
  }

  const averageScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  const shortfallArea = Math.max(0, requiredSprinklerArea - installedSprinklerArea);
  const compliancePct = requiredSprinklerArea > 0 ? (installedSprinklerArea / requiredSprinklerArea) * 100 : 0;
  const installedCoverage_pct = totalArea_m2 > 0 ? (installedSprinklerArea / totalArea_m2) * 100 : 0;
  const requiredCoverage_pct = totalArea_m2 > 0 ? (requiredSprinklerArea / totalArea_m2) * 100 : 0;

  return {
    averageScore: buildingsAssessed > 0 ? Math.round(averageScore * 10) / 10 : 0,
    buildingsAssessed,
    requiredSprinklerArea: Math.round(requiredSprinklerArea),
    installedSprinklerArea: Math.round(installedSprinklerArea),
    shortfallArea: Math.round(shortfallArea),
    compliancePct: Math.round(compliancePct * 10) / 10,
    someAreaMissing,
    totalArea_m2: Math.round(totalArea_m2),
    installedCoverage_pct: Math.round(installedCoverage_pct * 10) / 10,
    requiredCoverage_pct: Math.round(requiredCoverage_pct * 10) / 10,
    buildingsWithArea,
  };
}

function createDefaultSiteWater(): SiteWaterData {
  return {
    water_reliability: 'Unknown',
    supply_type: '',
    supply_type_other: '',
    supports: 'Unknown',
    pumps_present: false,
    pump_arrangement: 'Unknown',
    power_resilience: 'Unknown',
    testing_regime: 'Unknown',
    key_weaknesses: '',
    hydrant_coverage: 'Unknown',
    fire_main_condition: 'Unknown',
    hose_reels_present: 'Unknown',
    flow_test_evidence: 'Unknown',
    flow_test_date: '',
  };
}

function createDefaultBuildingSprinkler(): BuildingSprinklerData {
  return {
    sprinklers_installed: 'Unknown',
    system_type: 'Unknown',
    standard: undefined,
    standard_other: '',
    localised_required: 'Unknown',
    localised_present: 'Unknown',
    localised_type: '',
    localised_protected_asset: '',
    localised_comments: '',
    sprinkler_coverage_installed_pct: null,
    sprinkler_coverage_required_pct: null,
    sprinkler_standard: '',
    hazard_class: '',
    maintenance_status: 'Unknown',
    sprinkler_adequacy: 'Unknown',
    justification_if_required_lt_100: '',
    sprinkler_score_1_5: null,
    final_active_score_1_5: null,
    // Detection defaults
    detection_installed: 'Unknown',
    detection_types: [],
    detection_type_other: '',
    alarm_monitoring: 'Unknown',
    detection_testing_regime: 'Unknown',
    detection_maintenance_status: 'Unknown',
    detection_comments: '',
    detection_score_1_5: null,
  };
}

export default function RE06FireProtectionForm({
  moduleInstance,
  document,
  onSaved,
}: RE06FireProtectionFormProps) {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);

  const initialData: FireProtectionModuleData = moduleInstance.data?.fire_protection || {
    buildings: {},
    site: {
      water: createDefaultSiteWater(),
      water_score_1_5: null, // Start as "Not rated"
      comments: '',
    },
    supplementary_assessment: createDefaultSupplementaryAssessment(),
  };

  // Data migration: Map sentinel value 0 or undefined to null for "Not rated"
  if (initialData.site.water_score_1_5 === 0 || initialData.site.water_score_1_5 === undefined) {
    initialData.site.water_score_1_5 = null;
  }

  initialData.supplementary_assessment = normalizeSupplementaryAssessment(initialData.supplementary_assessment);

  const [fireProtectionData, setFireProtectionData] = useState<FireProtectionModuleData>(initialData);

  const siteWaterData = fireProtectionData.site.water;
  const siteWaterComments = fireProtectionData.site.comments || '';

  const selectedSprinklerData = selectedBuildingId
    ? fireProtectionData.buildings[selectedBuildingId]?.sprinklerData || createDefaultBuildingSprinkler()
    : createDefaultBuildingSprinkler();
  const selectedComments = selectedBuildingId
    ? fireProtectionData.buildings[selectedBuildingId]?.comments || ''
    : '';
  const isLocalisedRequired = selectedSprinklerData.localised_required === 'Yes';
  const isLocalisedInstalled = selectedSprinklerData.localised_present === 'Yes';
  const isLocalisedKnockoutFailed = isLocalisedRequired && selectedSprinklerData.localised_present === 'No';
  const showLocalisedDetailedAssessment = isLocalisedRequired && isLocalisedInstalled;

  // Suggested score from inputs (always calculated, never null)
  const suggestedWaterScore = useMemo(() => {
    return calculateWaterScore(siteWaterData);
  }, [siteWaterData]);

  // Assessor-set score (can be null = "Not rated")
  const assessorWaterScore = fireProtectionData.site.water_score_1_5;

  const rawSprinklerScore = useMemo(() => {
    return calculateSprinklerScore(selectedSprinklerData);
  }, [selectedSprinklerData]);

  const selectedSprinklerScore = rawSprinklerScore; // Can be null
  const selectedDetectionScore = selectedSprinklerData.detection_score_1_5 ?? null;

  const selectedFinalScore = useMemo(() => {
    return calculateFinalActiveScore(rawSprinklerScore, assessorWaterScore, suggestedWaterScore, selectedDetectionScore);
  }, [rawSprinklerScore, assessorWaterScore, suggestedWaterScore, selectedDetectionScore]);

  // Use assessor score if set, otherwise suggested for flags/rollup
  const effectiveWaterScore = assessorWaterScore ?? suggestedWaterScore;
  const autoFlags = generateAutoFlags(selectedSprinklerData, rawSprinklerScore, effectiveWaterScore);
  const siteRollup = calculateSiteRollup(fireProtectionData, buildings);
  const supplementaryAssessment = normalizeSupplementaryAssessment(fireProtectionData.supplementary_assessment);
  const supplementaryScores = deriveSupplementaryScores(supplementaryAssessment.questions, {
    includeLocalisedGroup: showLocalisedDetailedAssessment || isLocalisedKnockoutFailed,
  });
  const [supplementaryAutoRecStates, setSupplementaryAutoRecStates] = useState<Record<string, AutoRecommendationLifecycleState>>(
    () => initializeAutoRecStates(supplementaryAssessment.questions)
  );


  useEffect(() => {
    setSupplementaryAutoRecStates((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const question of supplementaryAssessment.questions) {
        if (!(question.factor_key in next)) {
          next[question.factor_key] = 'none';
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!supplementaryAssessment.questions.some((question) => question.factor_key === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [supplementaryAssessment.questions]);

  const derivedRecommendations = useMemo(() => {
    const buildingsForRecs: Record<string, any> = {};

    Object.entries(fireProtectionData.buildings).forEach(([buildingId, buildingFP]) => {
      if (!buildingFP.sprinklerData) return;
      buildingsForRecs[buildingId] = {
        suppression: {
          sprinklers: {
            rating: buildingFP.sprinklerData.sprinkler_score_1_5,
            provided_pct: buildingFP.sprinklerData.sprinkler_coverage_installed_pct,
            required_pct: buildingFP.sprinklerData.sprinkler_coverage_required_pct,
            localised_required: buildingFP.sprinklerData.localised_required?.toLowerCase(),
            localised_present: buildingFP.sprinklerData.localised_present?.toLowerCase(),
          },
        },
      };
    });

    const fpModule = {
      buildings: buildingsForRecs,
      site: {
        water_supply_reliability: siteWaterData.water_reliability?.toLowerCase() as any,
      },
    };

    return generateFireProtectionRecommendations(fpModule);
  }, [fireProtectionData.buildings, siteWaterData.water_reliability]);

  useEffect(() => {
    async function loadBuildings() {
      try {
        const { data: buildingsData, error } = await supabase
          .from('re_buildings')
          .select('*')
          .eq('document_id', document.id)
          .order('created_at', { ascending: true });

        if (error) throw error;

        const loadedBuildings = (buildingsData || []) as Building[];
        setBuildings(loadedBuildings);

        if (loadedBuildings.length > 0 && !selectedBuildingId) {
          setSelectedBuildingId(loadedBuildings[0].id);
        }

        setFireProtectionData((prev) => {
          const updatedBuildings = { ...prev.buildings };
          for (const building of loadedBuildings) {
            if (!updatedBuildings[building.id]) {
              updatedBuildings[building.id] = {
                sprinklerData: createDefaultBuildingSprinkler(),
                comments: '',
              };
            }
          }
          return { ...prev, buildings: updatedBuildings };
        });
      } catch (error) {
        console.error('Failed to load buildings:', error);
      }
    }

    loadBuildings();
  }, [document.id]);




  const saveData = useCallback(async () => {
    if (saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const supplementaryToSave = normalizeSupplementaryAssessment(fireProtectionData.supplementary_assessment);
      const includeLocalisedGroupForSave =
        showLocalisedDetailedAssessment ||
        Object.values(fireProtectionData.buildings || {}).some((buildingData) => {
          const sprinklerData = buildingData?.sprinklerData;
          return sprinklerData?.localised_required === 'Yes' && sprinklerData?.localised_present === 'No';
        });
      const supplementaryScoresToSave = deriveSupplementaryScores(supplementaryToSave.questions, {
        includeLocalisedGroup: includeLocalisedGroupForSave,
      });
      const payload: FireProtectionModuleData = {
        ...fireProtectionData,
        supplementary_assessment: {
          ...supplementaryToSave,
          ...supplementaryScoresToSave,
        },
      };

      await supabase
        .from('module_instances')
        .update({
          data: { fire_protection: payload },
        })
        .eq('id', moduleInstance.id);

      const { data: riskEngInstance } = await supabase
        .from('module_instances')
        .select('data')
        .eq('document_id', moduleInstance.document_id)
        .eq('module_key', 'RISK_ENGINEERING')
        .maybeSingle();

      const industryKey = (riskEngInstance?.data as any)?.industry || null;
      const allSupplementaryQuestions = payload.supplementary_assessment?.questions || [];

      const supplementarySyncOps = allSupplementaryQuestions.map(async (question) => {
        const lifecycleState = await syncAutoRecToRegister({
          documentId: moduleInstance.document_id,
          moduleKey: 'RE_06_FIRE_PROTECTION',
          canonicalKey: question.factor_key,
          moduleInstanceId: moduleInstance.id,
          rating_1_5: question.score_1_5 === null ? 5 : Number(question.score_1_5),
          industryKey,
        });

        return { factorKey: question.factor_key, lifecycleState };
      });

      const localisedKnockoutSyncOps = Object.entries(payload.buildings || {}).map(([buildingId, buildingData]) => {
        const sprinklerData = buildingData?.sprinklerData;
        const knockoutFailed = sprinklerData?.localised_required === 'Yes' && sprinklerData?.localised_present === 'No';

        return syncAutoRecToRegister({
          documentId: moduleInstance.document_id,
          moduleKey: 'RE_06_FIRE_PROTECTION',
          canonicalKey: `re06_fp_localised_required_installation:${buildingId}`,
          moduleInstanceId: moduleInstance.id,
          rating_1_5: knockoutFailed ? 1 : 5,
          industryKey,
        });
      });

      const [supplementarySyncResults] = await Promise.all([
        Promise.allSettled(supplementarySyncOps),
        Promise.allSettled(localisedKnockoutSyncOps),
      ]);

      setSupplementaryAutoRecStates((prev) => {
        const next = { ...prev };

        for (const result of supplementarySyncResults) {
          if (result.status !== 'fulfilled') continue;
          next[result.value.factorKey] = result.value.lifecycleState;
        }

        return next;
      });

      setLastSavedAt(new Date());
      onSaved();

      const supplementaryOverall = payload.supplementary_assessment?.overall_score;
      if (supplementaryOverall !== null && supplementaryOverall !== undefined) {
        void updateSectionGrade(moduleInstance.document_id, 'fire_protection', supplementaryOverall)
          .then(({ error }) => {
            if (error) {
              console.error('[RE06FireProtection] Failed to persist fire_protection section grade:', error);
            }
          });
      }
    } catch (error) {
      console.error('Failed to save fire protection data:', error);
      setSaveError('Save failed');
    } finally {
      setSaving(false);
    }
  }, [saving, fireProtectionData, moduleInstance.id, moduleInstance.document_id, onSaved]);


  const updateSiteWater = (field: keyof SiteWaterData, value: any) => {
    setFireProtectionData((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        water: {
          ...prev.site.water,
          [field]: value,
        },
        // Don't auto-calculate score anymore - assessor must explicitly set it
      },
    }));
  };

  const setAssessorWaterScore = (score: number | null) => {
    setFireProtectionData((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        water_score_1_5: score,
      },
    }));
  };

  const applySuggestedScore = () => {
    setAssessorWaterScore(suggestedWaterScore);
  };

  const updateSiteComments = (comments: string) => {
    setFireProtectionData((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        comments,
      },
    }));
  };

  const updateBuildingSprinkler = (field: keyof BuildingSprinklerData, value: any) => {
    if (!selectedBuildingId) return;

    setFireProtectionData((prev) => {
      const building = prev.buildings[selectedBuildingId] || {
        sprinklerData: createDefaultBuildingSprinkler(),
        comments: '',
      };

      const updatedData = {
        ...building.sprinklerData,
        [field]: value,
      };

      const sprinklerScore = calculateSprinklerScore(updatedData);
      const waterScore = prev.site.water_score_1_5;
      const suggestedWater = calculateWaterScore(prev.site.water);
      const detectionScore = updatedData.detection_score_1_5 ?? null;

      updatedData.sprinkler_score_1_5 = sprinklerScore; // Can be null
      updatedData.final_active_score_1_5 = calculateFinalActiveScore(sprinklerScore, waterScore, suggestedWater, detectionScore);

      return {
        ...prev,
        buildings: {
          ...prev.buildings,
          [selectedBuildingId]: {
            ...building,
            sprinklerData: updatedData,
          },
        },
      };
    });
  };

  const updateLocalisedKnockout = (
    field: 'localised_required' | 'localised_present',
    value: LocalisedRequired | LocalisedPresent
  ) => {
    if (!selectedBuildingId) return;

    setFireProtectionData((prev) => {
      const building = prev.buildings[selectedBuildingId] || {
        sprinklerData: createDefaultBuildingSprinkler(),
        comments: '',
      };

      const sprinklerData = {
        ...building.sprinklerData,
        [field]: value,
      };

      if (field === 'localised_required' && value !== 'Yes') {
        sprinklerData.localised_present = 'Unknown';
      }

      const knockoutFailed =
        sprinklerData.localised_required === 'Yes' && sprinklerData.localised_present === 'No';
      const localisedQuestionFactor = 're06_fp_localised_systems_provided';

      const currentSupplementary = normalizeSupplementaryAssessment(prev.supplementary_assessment);
      const updatedQuestions = currentSupplementary.questions.map((question) => {
        if (question.factor_key !== localisedQuestionFactor) return question;
        return {
          ...question,
          score_1_5: knockoutFailed ? 1 : question.score_1_5,
        };
      });

      return {
        ...prev,
        buildings: {
          ...prev.buildings,
          [selectedBuildingId]: {
            ...building,
            sprinklerData,
          },
        },
        supplementary_assessment: {
          ...currentSupplementary,
          ...deriveSupplementaryScores(updatedQuestions),
          questions: updatedQuestions,
        },
      };
    });
  };

  const updateBuildingComments = (comments: string) => {
    if (!selectedBuildingId) return;

    setFireProtectionData((prev) => ({
      ...prev,
      buildings: {
        ...prev.buildings,
        [selectedBuildingId]: {
          ...(prev.buildings[selectedBuildingId] || {}),
          comments,
        },
      },
    }));
  };

  const updateSupplementaryQuestion = (
    factorKey: string,
    field: 'score_1_5' | 'notes',
    value: number | null | string
  ) => {
    setFireProtectionData((prev) => {
      const current = normalizeSupplementaryAssessment(prev.supplementary_assessment);
      const questions = current.questions.map((question) =>
        question.factor_key === factorKey ? { ...question, [field]: value } : question
      );

      return {
        ...prev,
        supplementary_assessment: {
          ...current,
          ...deriveSupplementaryScores(questions),
          questions,
        },
      };
    });
  };

  const handleBuildingSelect = (buildingId: string) => {
    setSelectedBuildingId(buildingId);
  };

  const selectedBuilding = buildings.find((b) => b.id === selectedBuildingId);




  if (buildings.length === 0) {
    return (
      <div className="p-8">
        <div className="bg-risk-info-bg border border-risk-info-border rounded-lg p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-risk-info-fg flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-risk-info-fg mb-2">No Buildings Found</h3>
            <p className="text-sm text-risk-info-fg">
              Complete RE-02 Construction module first to define buildings before assessing fire protection.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="pb-24">

      <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-risk-info-bg rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-risk-info-fg" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">Supplementary Engineering Assessment (Primary Fire Protection Score)</h3>
            <p className="text-sm text-slate-600">Primary module scoring driver. Factual table capture remains unchanged below as supporting evidence.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Adequacy Subscore</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.adequacy_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Reliability Subscore</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.reliability_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Localised / Special Subscore</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.localised_special_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-risk-info-bg rounded-lg p-4 border border-risk-info-border">
            <div className="text-sm text-risk-info-fg mb-1">Overall Engineering Score (drives RE-04 Fire Protection)</div>
            <div className="text-2xl font-bold text-risk-info-fg">{supplementaryScores.overall_score ?? 'Not rated'}</div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-6">
          Overall score is the average of all rated supplementary questions across adequacy, reliability, and localised/special protection.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {(['adequacy', 'reliability'] as const).map((group) => (
            <div key={group} className="border border-slate-200 rounded-lg p-4 space-y-4">
              <h4 className="font-semibold text-slate-900">{group.charAt(0).toUpperCase() + group.slice(1)}</h4>
              {supplementaryAssessment.questions
                .filter((question) => question.group === group)
                .map((question) => {
                  const autoRecState = supplementaryAutoRecStates[question.factor_key] || 'none';
                  return (
                    <div key={question.factor_key} className="rounded-md border border-slate-200 p-3">
                      <label className="block text-sm font-medium text-slate-700 mb-2">{question.prompt}</label>
                      <div className="mb-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${getAutoRecStateStyles(autoRecState)}`}>
                          {AUTO_REC_STATE_LABELS[autoRecState]}
                        </span>
                      </div>
                      <div className="space-y-3">
                        <RatingButtons
                          value={question.score_1_5}
                          onChange={(rating) => updateSupplementaryQuestion(question.factor_key, 'score_1_5', rating)}
                          labels={{
                            1: 'Inadequate',
                            2: 'Deficient',
                            3: 'Marginal',
                            4: 'Adequate',
                            5: 'Robust',
                          }}
                          size="sm"
                        />
                        <button
                          type="button"
                          onClick={() => updateSupplementaryQuestion(question.factor_key, 'score_1_5', null)}
                          className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                          Clear rating
                        </button>
                        <div>
                          <textarea
                            rows={2}
                            value={question.notes}
                            onChange={(e) => updateSupplementaryQuestion(question.factor_key, 'notes', e.target.value)}
                            placeholder="Optional assessor notes"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}

          <div className="xl:col-span-3 border border-risk-info-border bg-risk-info-bg rounded-lg p-4">
            <h4 className="font-semibold text-risk-info-fg mb-3">Localised / Special Protection Knockout (selected building)</h4>
            {!selectedBuildingId ? (
              <p className="text-sm text-risk-info-fg">Select a building to complete the knockout assessment.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Is localised/special protection required for the hazards/processes present?
                  </label>
                  <select
                    value={selectedSprinklerData.localised_required || 'Unknown'}
                    onChange={(e) => updateLocalisedKnockout('localised_required', e.target.value as LocalisedRequired)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Unknown">Unknown</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>

                {selectedSprinklerData.localised_required === 'Yes' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">If required, is it installed?</label>
                    <select
                      value={selectedSprinklerData.localised_present || 'Unknown'}
                      onChange={(e) => updateLocalisedKnockout('localised_present', e.target.value as LocalisedPresent)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    >
                      <option value="Unknown">Unknown</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                )}
              </div>
            )}
            {isLocalisedKnockoutFailed && (
              <p className="mt-3 text-sm text-risk-high-fg">
                Knockout failed. This automatically forces a low localised/special protection factor rating and triggers a factor-linked recommendation.
              </p>
            )}
            {!showLocalisedDetailedAssessment && (
              <p className="mt-3 text-sm text-risk-info-fg">
                Detailed localised/special protection assessment questions are only shown when protection is required and installed.
              </p>
            )}
          </div>

          {showLocalisedDetailedAssessment && (
            <div className="xl:col-span-3 border border-slate-200 rounded-lg p-4 space-y-4">
              <h4 className="font-semibold text-slate-900">Localised / Special Protection Assessment</h4>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {supplementaryAssessment.questions
                  .filter((question) => question.group === 'localised_special')
                  .map((question) => {
                    const autoRecState = supplementaryAutoRecStates[question.factor_key] || 'none';
                    return (
                      <div key={question.factor_key} className="rounded-md border border-slate-200 p-3">
                        <label className="block text-sm font-medium text-slate-700 mb-2">{question.prompt}</label>
                        <div className="mb-3">
                          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${getAutoRecStateStyles(autoRecState)}`}>
                            {AUTO_REC_STATE_LABELS[autoRecState]}
                          </span>
                        </div>
                        <div className="space-y-3">
                          <RatingButtons
                            value={question.score_1_5}
                            onChange={(rating) => updateSupplementaryQuestion(question.factor_key, 'score_1_5', rating)}
                            labels={{
                              1: 'Inadequate',
                              2: 'Deficient',
                              3: 'Marginal',
                              4: 'Adequate',
                              5: 'Robust',
                            }}
                            size="sm"
                          />
                          <button
                            type="button"
                            onClick={() => updateSupplementaryQuestion(question.factor_key, 'score_1_5', null)}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                          >
                            Clear rating
                          </button>
                          <div>
                            <textarea
                              rows={2}
                              value={question.notes}
                              onChange={(e) => updateSupplementaryQuestion(question.factor_key, 'notes', e.target.value)}
                              placeholder="Optional assessor notes"
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>


      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-risk-info-bg rounded-lg flex items-center justify-center">
            <Droplet className="w-5 h-5 text-risk-info-fg" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900">Site Water & Fire Pumps</h2>
            <p className="text-sm text-slate-600">Site-level water supply reliability assessment</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Water indicator:</span>
            {assessorWaterScore !== null && assessorWaterScore !== undefined ? (
              <>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`w-6 h-6 rounded ${i <= assessorWaterScore ? 'bg-risk-info-fg' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium text-slate-900">{assessorWaterScore}/5</span>
              </>
            ) : (
              <span className="text-sm font-medium text-slate-500">Not rated</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Water supply supports - New field at top */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Water supply supports</label>
            <select
              value={siteWaterData.supports || 'Unknown'}
              onChange={(e) => updateSiteWater('supports', e.target.value as WaterSupports)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="Unknown">Unknown</option>
              <option value="Sprinklers">Sprinklers</option>
              <option value="Hydrants / fire main / hose reels">Hydrants / fire main / hose reels</option>
              <option value="Both">Both</option>
            </select>
          </div>

          {/* Supply Type - Now dropdown with Other option */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Supply Type</label>
            <select
              value={siteWaterData.supply_type || ''}
              onChange={(e) => updateSiteWater('supply_type', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="">Select...</option>
              <option value="Town mains">Town mains</option>
              <option value="Single tank (on-site)">Single tank (on-site)</option>
              <option value="Dual tank (on-site)">Dual tank (on-site)</option>
              <option value="Break tank + mains">Break tank + mains</option>
              <option value="Open water (reservoir)">Open water (reservoir)</option>
              <option value="River / canal / open source">River / canal / open source</option>
              <option value="Private main / estate main">Private main / estate main</option>
              <option value="Other">Other...</option>
            </select>
          </div>

          {/* Supply Type Other - Conditional */}
          {siteWaterData.supply_type === 'Other' && (
            <div className="col-span-2 md:col-span-2 xl:col-span-3">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Supply Type Details (Other)
              </label>
              <input
                type="text"
                value={siteWaterData.supply_type_other || ''}
                onChange={(e) => updateSiteWater('supply_type_other', e.target.value)}
                placeholder="Describe the supply type..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
              />
            </div>
          )}

          {/* Conditional hydrant/hose fields */}
          {(siteWaterData.supports === 'Hydrants / fire main / hose reels' || siteWaterData.supports === 'Both') && (
            <>
              <div className="md:col-span-2 xl:col-span-3 pt-4 border-t border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-4">Hydrant / fire main / hose reels</h4>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">External hydrant coverage</label>
                <select
                  value={siteWaterData.hydrant_coverage || 'Unknown'}
                  onChange={(e) => updateSiteWater('hydrant_coverage', e.target.value as CoverageQuality)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                >
                  <option value="Unknown">Unknown</option>
                  <option value="Good">Good</option>
                  <option value="Partial">Partial</option>
                  <option value="Poor">Poor</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fire main / ring main condition</label>
                <select
                  value={siteWaterData.fire_main_condition || 'Unknown'}
                  onChange={(e) => updateSiteWater('fire_main_condition', e.target.value as ConditionQuality)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                >
                  <option value="Unknown">Unknown</option>
                  <option value="Good">Good</option>
                  <option value="Concerns">Concerns</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Hose reels present</label>
                <select
                  value={siteWaterData.hose_reels_present || 'Unknown'}
                  onChange={(e) => updateSiteWater('hose_reels_present', e.target.value as YesNoUnknown)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                >
                  <option value="Unknown">Unknown</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Flow/pressure test evidence</label>
                <select
                  value={siteWaterData.flow_test_evidence || 'Unknown'}
                  onChange={(e) => updateSiteWater('flow_test_evidence', e.target.value as TestEvidence)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                >
                  <option value="Unknown">Unknown</option>
                  <option value="Documented">Documented</option>
                  <option value="Not documented">Not documented</option>
                </select>
              </div>

              <div className="col-span-2 md:col-span-2 xl:col-span-3">
                <label className="block text-sm font-medium text-slate-700 mb-2">Last test date (optional)</label>
                <input
                  type="date"
                  value={siteWaterData.flow_test_date || ''}
                  onChange={(e) => updateSiteWater('flow_test_date', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                />
              </div>

              <div className="col-span-2 border-t border-slate-200 pt-4"></div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Pumps Present</label>
            <select
              value={siteWaterData.pumps_present ? 'true' : 'false'}
              onChange={(e) => updateSiteWater('pumps_present', e.target.value === 'true')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Pump Arrangement</label>
            <select
              value={siteWaterData.pump_arrangement || 'Unknown'}
              onChange={(e) => updateSiteWater('pump_arrangement', e.target.value as PumpArrangement)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="Unknown">Unknown</option>
              <option value="None">None</option>
              <option value="Single">Single</option>
              <option value="Duty+Standby">Duty + Standby</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Power Resilience</label>
            <select
              value={siteWaterData.power_resilience || 'Unknown'}
              onChange={(e) => updateSiteWater('power_resilience', e.target.value as PowerResilience)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="Unknown">Unknown</option>
              <option value="Good">Good</option>
              <option value="Mixed">Mixed</option>
              <option value="Poor">Poor</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Testing Regime</label>
            <select
              value={siteWaterData.testing_regime || 'Unknown'}
              onChange={(e) => updateSiteWater('testing_regime', e.target.value as TestingRegime)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="Unknown">Unknown</option>
              <option value="Documented">Documented</option>
              <option value="Some evidence">Some evidence</option>
              <option value="None">None</option>
            </select>
          </div>

          <div className="col-span-2 md:col-span-2 xl:col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-2">Key Weaknesses</label>
            <textarea
              value={siteWaterData.key_weaknesses || ''}
              onChange={(e) => updateSiteWater('key_weaknesses', e.target.value)}
              placeholder="Describe any key vulnerabilities or concerns..."
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
            />
          </div>

          <div className="col-span-2 md:col-span-2 xl:col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-2">Comments</label>
            <textarea
              value={siteWaterComments}
              onChange={(e) => updateSiteComments(e.target.value)}
              placeholder="Additional notes on water supply and pumps..."
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
            />
          </div>

          {/* Site water score - Assessor judgment */}
          <div className="md:col-span-2 xl:col-span-3 pt-4 border-t border-slate-200">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Site Water Score (assessor judgement)
                </label>
                <p className="text-xs text-slate-500">
                  Based on the inputs above, the suggested score is <strong>{suggestedWaterScore}/5</strong>
                </p>
              </div>
              <button
                onClick={applySuggestedScore}
                className="ml-3 px-3 py-1.5 text-sm bg-risk-info-bg text-risk-info-fg rounded-lg hover:bg-risk-info-border transition-colors"
              >
                Apply suggested score
              </button>
            </div>
            <select
              value={assessorWaterScore === null || assessorWaterScore === undefined ? '' : assessorWaterScore}
              onChange={(e) => setAssessorWaterScore(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
            >
              <option value="">Not rated</option>
              <option value="1">1 – Very Poor (Highly unreliable)</option>
              <option value="2">2 – Poor (Unreliable)</option>
              <option value="3">3 – Fair (Limited reliability)</option>
              <option value="4">4 – Good (Generally reliable)</option>
              <option value="5">5 – Excellent (Highly reliable)</option>
            </select>
          </div>
        </div>

        <div className="mt-4 p-3 bg-risk-info-bg rounded-lg">
          <p className="text-sm text-risk-info-fg">
            <strong>Guidance:</strong> A rating of 3 may be acceptable when evidence is limited, but please select a rating explicitly. The suggested score is calculated from your inputs above.
          </p>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-200">
          <FireProtectionRecommendations
            recommendations={getSiteRecommendations(derivedRecommendations)}
            title="Site Water Supply Recommendations"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-4">
            <BuildingIcon className="w-5 h-5 text-slate-600" />
            <h3 className="font-semibold text-slate-900">Buildings</h3>
          </div>

          <div className="space-y-2">
            {buildings.map((building) => {
              const buildingFP = fireProtectionData.buildings[building.id];
              const isSelected = selectedBuildingId === building.id;

              return (
                <button
                  key={building.id}
                  onClick={() => handleBuildingSelect(building.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'border-risk-info-border bg-risk-info-bg'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{building.ref || 'Building'}</div>
                      {building.description && (
                        <div className="text-xs text-slate-600 truncate">{building.description}</div>
                      )}
                      {building.footprint_m2 && (
                        <div className="text-xs text-slate-500 mt-1">
                          {building.footprint_m2.toLocaleString()} m²
                        </div>
                      )}
                    </div>
                    {buildingFP?.sprinklerData && (
                      <div className="ml-2">
                        <div className="text-xs text-slate-600">Final</div>
                        <div className="text-sm font-bold text-slate-900">
                          {buildingFP.sprinklerData.final_active_score_1_5 !== null &&
                          buildingFP.sprinklerData.final_active_score_1_5 !== undefined
                            ? `${buildingFP.sprinklerData.final_active_score_1_5}/5`
                            : '—'}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="col-span-2 bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          {!selectedBuilding ? (
            <div className="flex items-center justify-center h-full text-slate-600">
              Select a building to view sprinkler details
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {selectedBuilding.ref || 'Building'} - Sprinklers
                      </h3>
                      {selectedBuilding.description && (
                        <p className="text-sm text-slate-600">{selectedBuilding.description}</p>
                      )}
                      {selectedBuilding.footprint_m2 && (
                        <p className="text-xs text-slate-500 mt-1">
                          Area: {selectedBuilding.footprint_m2.toLocaleString()} m²
                        </p>
                      )}
                    </div>
                    {/* Save status indicator */}
                    {saving && (
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                        Saving…
                      </span>
                    )}
                    {!saving && lastSavedAt && (
                      <span className="text-xs text-risk-low-fg flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Saved {lastSavedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {saveError && (
                      <span className="text-xs text-risk-high-fg">{saveError}</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-600 flex items-center gap-1 justify-end">
                    Final Active Score
                    {(assessorWaterScore === null || assessorWaterScore === undefined) && (
                      <span className="text-xs bg-risk-medium-bg text-risk-medium-fg px-2 py-0.5 rounded">provisional</span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-slate-900">
                    {selectedFinalScore !== null && selectedFinalScore !== undefined ? `${selectedFinalScore}/5` : 'Not rated'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Sprinklers: {selectedSprinklerScore !== null && selectedSprinklerScore !== undefined ? `${selectedSprinklerScore}/5` : 'Not rated'} • Detection:{' '}
                    {selectedDetectionScore !== null && selectedDetectionScore !== undefined ? `${selectedDetectionScore}/5` : 'Not rated'} • Water:{' '}
                    {assessorWaterScore !== null && assessorWaterScore !== undefined ? (
                      `${assessorWaterScore}/5`
                    ) : (
                      <span className="text-risk-medium-fg">~{suggestedWaterScore}/5</span>
                    )}
                  </div>
                </div>
              </div>

              {autoFlags.length > 0 && (
                <div className="mb-4 space-y-2">
                  {autoFlags.map((flag, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-3 rounded-lg ${
                        flag.severity === 'warning'
                          ? 'bg-risk-medium-bg border border-risk-medium-border'
                          : 'bg-risk-info-bg border border-risk-info-border'
                      }`}
                    >
                      {flag.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-risk-medium-fg mt-0.5" />
                      ) : (
                        <Info className="w-4 h-4 text-risk-info-fg mt-0.5" />
                      )}
                      <p
                        className={`text-sm ${
                          flag.severity === 'warning' ? 'text-risk-medium-fg' : 'text-risk-info-fg'
                        }`}
                      >
                        {flag.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                {/* Sprinklers Installed? - Primary gate */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Sprinklers installed?</label>
                  <select
                    value={selectedSprinklerData.sprinklers_installed || 'Unknown'}
                    onChange={(e) =>
                      updateBuildingSprinkler('sprinklers_installed', e.target.value as SprinklersInstalled)
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                  >
                    <option value="Unknown">Unknown</option>
                    <option value="Yes">Yes</option>
                    <option value="Partial">Partial</option>
                    <option value="No">No</option>
                  </select>
                </div>

                {selectedSprinklerData.sprinklers_installed === 'No' ? (
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-sm text-slate-700">
                      <strong>No sprinklers installed.</strong> This building is excluded from sprinkler roll-up.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Coverage fields - Installed FIRST, Required SECOND, Gap auto */}
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Coverage Installed (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedSprinklerData.sprinkler_coverage_installed_pct ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateBuildingSprinkler(
                              'sprinkler_coverage_installed_pct',
                              val === '' ? undefined : Number(val)
                            );
                          }}
                          onFocus={(e) => {
                            if (e.target.value === '0') {
                              e.target.select();
                            }
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Coverage Required (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedSprinklerData.sprinkler_coverage_required_pct ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateBuildingSprinkler(
                              'sprinkler_coverage_required_pct',
                              val === '' ? undefined : Number(val)
                            );
                          }}
                          onFocus={(e) => {
                            if (e.target.value === '0') {
                              e.target.select();
                            }
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Shortfall (%)</label>
                        <input
                          type="text"
                          value={
                            selectedSprinklerData.sprinkler_coverage_required_pct != null &&
                            selectedSprinklerData.sprinkler_coverage_installed_pct != null
                              ? Math.max(
                                  0,
                                  selectedSprinklerData.sprinkler_coverage_required_pct -
                                    selectedSprinklerData.sprinkler_coverage_installed_pct
                                )
                              : ''
                          }
                          readOnly
                          placeholder="—"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-600"
                        />
                      </div>
                    </div>

                    {/* System Type */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        System type (predominant)
                      </label>
                      <select
                        value={selectedSprinklerData.system_type || 'Unknown'}
                        onChange={(e) => updateBuildingSprinkler('system_type', e.target.value as SystemType)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                      >
                        <option value="Unknown">Unknown</option>
                        <option value="Wet pipe">Wet pipe</option>
                        <option value="Dry pipe">Dry pipe</option>
                        <option value="Pre-action">Pre-action</option>
                        <option value="Deluge">Deluge</option>
                        <option value="Combination / Mixed">Combination / Mixed</option>
                      </select>
                    </div>

                    {/* Sprinkler Standard (dropdown) and Hazard Class (free text) */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Sprinkler Standard</label>
                        <select
                          value={selectedSprinklerData.standard || ''}
                          onChange={(e) => updateBuildingSprinkler('standard', e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        >
                          <option value="">Select...</option>
                          <option value="EN 12845">EN 12845</option>
                          <option value="NFPA 13">NFPA 13</option>
                          <option value="FM">FM</option>
                          <option value="LPC Rules">LPC Rules</option>
                          <option value="VdS">VdS</option>
                          <option value="AS 2118">AS 2118</option>
                          <option value="NZS 4541">NZS 4541</option>
                          <option value="SANS 10287">SANS 10287</option>
                          <option value="Other…">Other…</option>
                        </select>
                      </div>

                      {selectedSprinklerData.standard === 'Other…' && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Standard (Other)
                          </label>
                          <input
                            type="text"
                            value={selectedSprinklerData.standard_other || ''}
                            onChange={(e) => updateBuildingSprinkler('standard_other', e.target.value)}
                            placeholder="Specify standard..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                          />
                        </div>
                      )}

                      <div className={selectedSprinklerData.standard === 'Other…' ? 'col-span-2' : ''}>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Hazard Class</label>
                        <input
                          type="text"
                          value={selectedSprinklerData.hazard_class || ''}
                          onChange={(e) => updateBuildingSprinkler('hazard_class', e.target.value)}
                          placeholder="e.g., OH1, OH2, OH3, LH, HHP"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        />
                      </div>
                    </div>

                    {/* Maintenance Status and Sprinkler Adequacy */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Maintenance Status</label>
                        <select
                          value={selectedSprinklerData.maintenance_status || 'Unknown'}
                          onChange={(e) =>
                            updateBuildingSprinkler('maintenance_status', e.target.value as MaintenanceStatus)
                          }
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        >
                          <option value="Unknown">Unknown</option>
                          <option value="Good">Good</option>
                          <option value="Mixed">Mixed</option>
                          <option value="Poor">Poor</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Sprinkler Adequacy</label>
                        <select
                          value={selectedSprinklerData.sprinkler_adequacy || 'Unknown'}
                          onChange={(e) =>
                            updateBuildingSprinkler('sprinkler_adequacy', e.target.value as SprinklerAdequacy)
                          }
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                        >
                          <option value="Unknown">Unknown</option>
                          <option value="Adequate">Adequate</option>
                          <option value="Inadequate">Inadequate</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {/* Localised / Special Fire Protection knockout */}
                <div className="pt-4 border-t border-slate-200">
                  <h4 className="font-semibold text-slate-900 mb-3">Localised / Special fire protection</h4>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Is localised/special protection required for the hazards/processes present?
                      </label>
                      <select
                        value={selectedSprinklerData.localised_required || 'Unknown'}
                        onChange={(e) => updateLocalisedKnockout('localised_required', e.target.value as LocalisedRequired)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                      >
                        <option value="Unknown">Unknown</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>

                    {selectedSprinklerData.localised_required === 'Yes' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            If required, is it installed?
                          </label>
                          <select
                            value={selectedSprinklerData.localised_present || 'Unknown'}
                            onChange={(e) =>
                              updateLocalisedKnockout('localised_present', e.target.value as LocalisedPresent)
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                          >
                            <option value="Unknown">Unknown</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        </div>

                        {selectedSprinklerData.localised_present === 'No' && (
                          <div className="p-3 bg-risk-high-bg border border-risk-high-border rounded-lg">
                            <p className="text-sm text-risk-high-fg">
                              Knockout failed: localised/special protection is required but not installed. This should drive a low engineering score and an open recommendation.
                            </p>
                          </div>
                        )}

                        {selectedSprinklerData.localised_present === 'Yes' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                Protection type (predominant)
                              </label>
                              <select
                                value={selectedSprinklerData.localised_type || ''}
                                onChange={(e) => updateBuildingSprinkler('localised_type', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                              >
                                <option value="">Select...</option>
                                <option value="Gas suppression">Gas suppression</option>
                                <option value="Water mist">Water mist</option>
                                <option value="Foam">Foam</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                Protected asset / area
                              </label>
                              <input
                                type="text"
                                value={selectedSprinklerData.localised_protected_asset || ''}
                                onChange={(e) => updateBuildingSprinkler('localised_protected_asset', e.target.value)}
                                placeholder="e.g., Server room, Paint store, Battery room"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">Comments</label>
                              <textarea
                                value={selectedSprinklerData.localised_comments || ''}
                                onChange={(e) => updateBuildingSprinkler('localised_comments', e.target.value)}
                                placeholder="Additional details on localised protection..."
                                rows={2}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Fire Detection & Alarm - Always visible regardless of sprinklers */}
                <div className="pt-4 border-t border-slate-200">
                  <h4 className="font-semibold text-slate-900 mb-3">Fire Detection & Alarm</h4>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Fire detection installed?
                      </label>
                      <select
                        value={selectedSprinklerData.detection_installed || 'Unknown'}
                        onChange={(e) =>
                          updateBuildingSprinkler('detection_installed', e.target.value as DetectionInstalled)
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                      >
                        <option value="Unknown">Unknown</option>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                        <option value="Partial">Partial</option>
                      </select>
                    </div>

                    {(selectedSprinklerData.detection_installed === 'Yes' ||
                      selectedSprinklerData.detection_installed === 'Partial') && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Detection types (check all that apply)
                          </label>
                          <div className="space-y-2">
                            {[
                              'Automatic point detection (smoke/heat)',
                              'Manual call points',
                              'Aspirating (VESDA)',
                              'Beam',
                              'Flame',
                              'Linear heat',
                              'Other',
                            ].map((type) => (
                              <label key={type} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={(selectedSprinklerData.detection_types || []).includes(type)}
                                  onChange={(e) => {
                                    const current = selectedSprinklerData.detection_types || [];
                                    const updated = e.target.checked
                                      ? [...current, type]
                                      : current.filter((t) => t !== type);
                                    updateBuildingSprinkler('detection_types', updated);
                                  }}
                                  className="rounded border-slate-300"
                                />
                                <span className="text-sm text-slate-700">{type}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {(selectedSprinklerData.detection_types || []).includes('Other') && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                              Other detection type
                            </label>
                            <input
                              type="text"
                              value={selectedSprinklerData.detection_type_other || ''}
                              onChange={(e) => updateBuildingSprinkler('detection_type_other', e.target.value)}
                              placeholder="Specify other detection type..."
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                            />
                          </div>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Alarm monitoring</label>
                          <select
                            value={selectedSprinklerData.alarm_monitoring || 'Unknown'}
                            onChange={(e) =>
                              updateBuildingSprinkler('alarm_monitoring', e.target.value as AlarmMonitoring)
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                          >
                            <option value="Unknown">Unknown</option>
                            <option value="Local only">Local only</option>
                            <option value="ARC">ARC</option>
                            <option value="Fire brigade connection">Fire brigade connection</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Testing regime</label>
                          <select
                            value={selectedSprinklerData.detection_testing_regime || 'Unknown'}
                            onChange={(e) =>
                              updateBuildingSprinkler(
                                'detection_testing_regime',
                                e.target.value as DetectionTestingRegime
                              )
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                          >
                            <option value="Unknown">Unknown</option>
                            <option value="Documented">Documented</option>
                            <option value="Not documented">Not documented</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Maintenance status
                          </label>
                          <select
                            value={selectedSprinklerData.detection_maintenance_status || 'Unknown'}
                            onChange={(e) =>
                              updateBuildingSprinkler(
                                'detection_maintenance_status',
                                e.target.value as DetectionMaintenanceStatus
                              )
                            }
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                          >
                            <option value="Unknown">Unknown</option>
                            <option value="Good">Good</option>
                            <option value="Concerns">Concerns</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Comments</label>
                          <textarea
                            value={selectedSprinklerData.detection_comments || ''}
                            onChange={(e) => updateBuildingSprinkler('detection_comments', e.target.value)}
                            placeholder="Additional details on fire detection system..."
                            rows={2}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Detection Score (Assessor judgement)
                      </label>
                      <select
                        value={
                          selectedSprinklerData.detection_score_1_5 === null ||
                          selectedSprinklerData.detection_score_1_5 === undefined
                            ? 'null'
                            : selectedSprinklerData.detection_score_1_5.toString()
                        }
                        onChange={(e) => {
                          const val = e.target.value === 'null' ? null : Number(e.target.value);
                          updateBuildingSprinkler('detection_score_1_5', val);
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass}"
                      >
                        <option value="null">Not rated</option>
                        <option value="1">1 - Very Poor</option>
                        <option value="2">2 - Poor</option>
                        <option value="3">3 - Fair</option>
                        <option value="4">4 - Good</option>
                        <option value="5">5 - Excellent</option>
                      </select>
                    </div>
                  </div>
                </div>

                {selectedSprinklerData.sprinkler_coverage_required_pct !== undefined &&
                  selectedSprinklerData.sprinkler_coverage_required_pct < 100 &&
                  selectedSprinklerData.sprinkler_coverage_required_pct > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Justification for {'<'}100% Required Coverage
                      </label>
                      <textarea
                        value={selectedSprinklerData.justification_if_required_lt_100 || ''}
                        onChange={(e) =>
                          updateBuildingSprinkler('justification_if_required_lt_100', e.target.value)
                        }
                        placeholder="Explain why full coverage is not required..."
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                      />
                    </div>
                  )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Comments</label>
                  <textarea
                    value={selectedComments}
                    onChange={(e) => updateBuildingComments(e.target.value)}
                    placeholder="Additional notes on sprinkler system..."
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${focusRingClass} resize-none"
                  />
                </div>

                {selectedBuilding && (
                  <div className="pt-6 border-t border-slate-200">
                    <FireProtectionRecommendations
                      recommendations={getBuildingRecommendations(derivedRecommendations, selectedBuilding.id)}
                      title="Building Fire Protection Recommendations"
                    />
                  </div>
                )}

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm text-slate-700">
                    <strong>Note:</strong> Final Active Score combines sprinklers (80%) and detection (20%) when both are rated.
                    Sprinkler score is capped by water supply reliability. Buildings where sprinklers are not installed or not
                    required (0%) are excluded from site roll-up.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-risk-low-bg rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-risk-low-fg" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">Site Fire Protection Roll-up (Informational Indicator)</h3>
            <p className="text-sm text-slate-600">
              Area-weighted average across buildings where sprinklers are required
            </p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-6">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Average Score</div>
            <div className="text-3xl font-bold text-slate-900">
              {siteRollup.buildingsAssessed > 0 ? siteRollup.averageScore.toFixed(1) : 'Not rated'}
            </div>
            <div className="text-xs text-slate-500 mt-1">Out of 5.0</div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Buildings Assessed</div>
            <div className="text-3xl font-bold text-slate-900">{siteRollup.buildingsAssessed}</div>
            <div className="text-xs text-slate-500 mt-1">With required sprinklers</div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Installed sprinkler coverage</div>
            <div className="text-3xl font-bold text-slate-900">
              {siteRollup.totalArea_m2 > 0 ? siteRollup.installedSprinklerArea.toLocaleString() : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">m²</div>
            {siteRollup.totalArea_m2 > 0 && (
              <div className="mt-2 text-sm text-slate-700">
                {siteRollup.installedCoverage_pct.toFixed(1)}% of total area
              </div>
            )}
            {siteRollup.totalArea_m2 === 0 && (
              <div className="mt-2 text-xs text-slate-500">
                —%
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Required sprinkler coverage</div>
            <div className="text-3xl font-bold text-slate-900">
              {siteRollup.totalArea_m2 > 0 ? siteRollup.requiredSprinklerArea.toLocaleString() : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">m²</div>
            {siteRollup.totalArea_m2 > 0 && (
              <div className="mt-2 text-sm text-slate-700">
                {siteRollup.requiredCoverage_pct.toFixed(1)}% of total area
              </div>
            )}
            {siteRollup.totalArea_m2 === 0 && (
              <div className="mt-2 text-xs text-slate-500">
                —%
              </div>
            )}
          </div>
        </div>

        {siteRollup.someAreaMissing && siteRollup.buildingsAssessed > 0 && (
          <div className="mt-4 p-3 bg-risk-info-bg rounded-lg border border-risk-info-border">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-risk-info-fg mt-0.5" />
              <p className="text-sm text-risk-info-fg">
                Some buildings missing area; coverage based on {siteRollup.buildingsWithArea} building{siteRollup.buildingsWithArea !== 1 ? 's' : ''} with area data.
              </p>
            </div>
          </div>
        )}

        {siteRollup.buildingsAssessed === 0 && (
          <div className="mt-4 p-3 bg-risk-medium-bg rounded-lg border border-risk-medium-border">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-risk-medium-fg mt-0.5" />
              <p className="text-sm text-risk-medium-fg">
                No buildings with required sprinklers found. Mark buildings with required_pct {'>'} 0 to include
                in roll-up.
              </p>
            </div>
          </div>
        )}
      </div>


      {document?.id && moduleInstance?.id && (
        <ModuleActions documentId={document.id} moduleInstanceId={moduleInstance.id} buttonLabel="Add Recommendation" />
      )}
    </div>

      <FloatingSaveBar
        onSave={() => void saveData()}
        isSaving={saving}
        statusText={
          saving
            ? 'Saving fire protection assessment…'
            : lastSavedAt
            ? `Last saved at ${lastSavedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'Save to persist RE-04 fire protection updates and recommendation lifecycle changes.'
        }
      />
    </>
  );
}
