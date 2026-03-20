import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, Info, Building as BuildingIcon, TrendingUp } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  generateFireProtectionRecommendations,
  getBuildingRecommendations,
} from '../../../lib/modules/re04FireProtectionRecommendations';
import {
  calculateSprinklerScore,
  generateAutoFlags,
} from '../../../lib/re/fireProtectionModel';
import { syncAutoRecToRegister } from '../../../lib/re/recommendations/recommendationPipeline';
import type { AutoRecommendationLifecycleState } from '../../../lib/re/recommendations/recommendationPipeline';
import FireProtectionRecommendations from '../../re/FireProtectionRecommendations';
import ModuleActions from '../ModuleActions';
import ReEngineeringQuestionCard from '../../re/ReEngineeringQuestionCard';
import FloatingSaveBar from './FloatingSaveBar';
import { updateSectionGrade } from '../../../utils/sectionGrades';
import {
  RE04_ENGINEERING_QUESTIONS,
  RE04_ENGINEERING_QUESTIONS_BY_GROUP,
  RE04_LOCALISED_INSTALLED_FACTOR_KEY,
} from '../../../lib/re/re04EngineeringModel';

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
  data: Record<string, unknown>;
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
  roof_area_m2?: number;
  mezzanine_area_m2?: number;
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

type SupplementaryQuestionGroup = 'adequacy' | 'reliability' | 'localised';


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
  localised_subscore: number | null;
  overall_score: number | null;
}

const SUPPLEMENTARY_FIRE_QUESTIONS: Array<Pick<SupplementaryQuestionResponse, 'factor_key' | 'group' | 'prompt'>> =
  RE04_ENGINEERING_QUESTIONS.map((question) => ({
    factor_key: question.factorKey,
    group: question.group,
    prompt: question.prompt,
  }));

function createDefaultSupplementaryAssessment(): SupplementaryAssessmentData {
  return {
    questions: SUPPLEMENTARY_FIRE_QUESTIONS.map((question) => ({
      ...question,
      score_1_5: null,
      notes: '',
    })),
    adequacy_subscore: null,
    reliability_subscore: null,
    localised_subscore: null,
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
    localised: includeLocalisedGroup
      ? questions.filter((q) => q.group === 'localised' && q.score_1_5 !== null)
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
    (q) => q.score_1_5 !== null && (includeLocalisedGroup || q.group !== 'localised')
  );
  const localised_subscore = average(byGroup.localised);
  const overall_score = average(ratedQuestions);

  return {
    adequacy_subscore,
    reliability_subscore,
    localised_subscore,
    overall_score,
  };
}

function shouldIncludeLocalisedScoring(buildings: Record<string, BuildingFireProtection>): boolean {
  return Object.values(buildings).some((buildingData) => {
    const sprinklerData = buildingData?.sprinklerData;
    if (!sprinklerData) return false;
    const required = sprinklerData.localised_required === 'Yes';
    const installed = sprinklerData.localised_present === 'Yes';
    const requiredButMissing = required && sprinklerData.localised_present === 'No';
    return (required && installed) || requiredButMissing;
  });
}



function initializeAutoRecStates(
  questions: SupplementaryQuestionResponse[]
): Record<string, AutoRecommendationLifecycleState> {
  return questions.reduce((acc, question) => {
    acc[question.factor_key] = 'none';
    return acc;
  }, {} as Record<string, AutoRecommendationLifecycleState>);
}

function parseAreaValue(value: unknown): number {
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

function resolveBuildingArea(building: Building): number {
  const footprintArea = parseAreaValue(building.footprint_m2);
  if (footprintArea > 0) return footprintArea;

  const roofArea = parseAreaValue(building.roof_area_m2);
  if (roofArea > 0) return roofArea;

  const mezzanineArea = parseAreaValue(building.mezzanine_area_m2);
  if (mezzanineArea > 0) return mezzanineArea;

  const floorArea = parseAreaValue(building.floor_area_sqm);
  if (floorArea > 0) return floorArea;

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
  missingRequiredCoverageCount: number;
  missingInstalledCoverageCount: number;
  missingFieldPaths: string[];
  coverageDataBuildings: number;
} {
  let totalWeightedScore = 0;
  let totalWeight = 0;
  let requiredSprinklerArea = 0;
  let installedSprinklerArea = 0;
  let buildingsAssessed = 0;
  let someAreaMissing = false;
  let totalArea_m2 = 0;
  let buildingsWithArea = 0;
  let missingRequiredCoverageCount = 0;
  let missingInstalledCoverageCount = 0;
  let coverageDataBuildings = 0;
  const missingFieldPaths = new Set<string>();

  for (const building of buildings) {
    const buildingFP = fireProtectionData.buildings[building.id];
    if (!buildingFP?.sprinklerData) continue;
    const sprinklersInstalled = buildingFP.sprinklerData.sprinklers_installed === 'Yes';

    const area = resolveBuildingArea(building);
    if (area <= 0) {
      missingFieldPaths.add(`re_buildings.${building.id}.footprint_m2|roof_area_m2|mezzanine_area_m2|floor_area_sqm`);
      someAreaMissing = true;
    }

    // Coverage metrics and missing-data checks apply only where sprinklers are installed
    if (area > 0 && sprinklersInstalled) {
      totalArea_m2 += area;
      buildingsWithArea++;

      const installedPctRaw = buildingFP.sprinklerData.sprinkler_coverage_installed_pct;
      if (installedPctRaw === null || installedPctRaw === undefined) {
        missingInstalledCoverageCount++;
        missingFieldPaths.add(`module_instances.fire_protection.buildings.${building.id}.sprinklerData.sprinkler_coverage_installed_pct`);
      } else {
        const installedPct = Math.max(0, Math.min(100, parseAreaValue(installedPctRaw)));
        installedSprinklerArea += (area * installedPct) / 100;
        coverageDataBuildings++;
      }

      const requiredPctRawForCoverage = buildingFP.sprinklerData.sprinkler_coverage_required_pct;
      if (requiredPctRawForCoverage === null || requiredPctRawForCoverage === undefined) {
        missingRequiredCoverageCount++;
        missingFieldPaths.add(`module_instances.fire_protection.buildings.${building.id}.sprinklerData.sprinkler_coverage_required_pct`);
      } else {
        const requiredPctForCoverage = Math.max(0, Math.min(100, parseAreaValue(requiredPctRawForCoverage)));
        requiredSprinklerArea += (area * requiredPctForCoverage) / 100;
        coverageDataBuildings++;
      }
    }

    // Building scoring roll-up remains informational context and only includes required > 0
    const requiredPctRaw = buildingFP.sprinklerData.sprinkler_coverage_required_pct;
    if (requiredPctRaw === null || requiredPctRaw === undefined) {
      continue;
    }

    // Building scoring roll-up includes only sprinkler-installed buildings with required coverage
    if (!sprinklersInstalled) continue;

    const requiredPct = requiredPctRaw;
    if (requiredPct <= 0) continue;

    const finalScore = buildingFP.sprinklerData.final_active_score_1_5;

    if (area > 0) {
      // Use area for weighted scoring when final score is available
      if (finalScore !== null && finalScore !== undefined) {
        totalWeightedScore += finalScore * area;
        totalWeight += area;
      }
    } else {
      // Building has no area - score weighting falls back only if final score exists
      if (finalScore !== null && finalScore !== undefined) {
        totalWeightedScore += finalScore * 1;
        totalWeight += 1;
      }
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
    missingRequiredCoverageCount,
    missingInstalledCoverageCount,
    missingFieldPaths: Array.from(missingFieldPaths),
    coverageDataBuildings,
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

  const initialData: FireProtectionModuleData = ((moduleInstance.data as { fire_protection?: FireProtectionModuleData } | null)?.fire_protection) || {
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

  const rawSprinklerScore = useMemo(() => calculateSprinklerScore(selectedSprinklerData), [selectedSprinklerData]);
  const selectedSprinklerScore = rawSprinklerScore;
  const selectedDetectionScore = selectedSprinklerData.detection_score_1_5 ?? null;
  const selectedFinalScore = selectedSprinklerData.final_active_score_1_5 ?? rawSprinklerScore;

  const autoFlags = generateAutoFlags(selectedSprinklerData, rawSprinklerScore, 3);
  const siteRollup = calculateSiteRollup(fireProtectionData, buildings);
  const installedCoverageUnavailableReason = siteRollup.totalArea_m2 > 0
    ? null
    : siteRollup.missingInstalledCoverageCount > 0
      ? 'Installed coverage not provided'
      : 'Coverage data unavailable';
  const requiredCoverageUnavailableReason = siteRollup.totalArea_m2 > 0
    ? null
    : siteRollup.missingRequiredCoverageCount > 0
      ? 'Required coverage not provided'
      : 'Coverage data unavailable';
  const supplementaryAssessment = normalizeSupplementaryAssessment(fireProtectionData.supplementary_assessment);
  const supplementaryScores = deriveSupplementaryScores(supplementaryAssessment.questions, {
    includeLocalisedGroup: showLocalisedDetailedAssessment || isLocalisedKnockoutFailed,
  });
  const [supplementaryAutoRecStates, setSupplementaryAutoRecStates] = useState<Record<string, AutoRecommendationLifecycleState>>(
    () => initializeAutoRecStates(supplementaryAssessment.questions)
  );
  const [localisedKnockoutAutoRecStates, setLocalisedKnockoutAutoRecStates] = useState<Record<string, AutoRecommendationLifecycleState>>({});


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
    const buildingsForRecs: Record<string, unknown> = {};

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
      },
    };

    return generateFireProtectionRecommendations(fpModule);
  }, [fireProtectionData.buildings]);

  const hasSufficientSiteRollupData = siteRollup.totalArea_m2 > 0 && siteRollup.coverageDataBuildings > 0;

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

      const industryKey = (riskEngInstance?.data as { industry?: string } | null)?.industry || null;
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
        }).then((lifecycleState) => ({ buildingId, lifecycleState }));
      });

      const [supplementarySyncResults, localisedKnockoutSyncResults] = await Promise.all([
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

      setLocalisedKnockoutAutoRecStates((prev) => {
        const next = { ...prev };

        for (const result of localisedKnockoutSyncResults) {
          if (result.status !== 'fulfilled') continue;
          next[result.value.buildingId] = result.value.lifecycleState;
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


  const updateBuildingSprinkler = (field: keyof BuildingSprinklerData, value: unknown) => {
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
      updatedData.sprinkler_score_1_5 = sprinklerScore;
      updatedData.final_active_score_1_5 = sprinklerScore;

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

      const currentSupplementary = normalizeSupplementaryAssessment(prev.supplementary_assessment);
      const updatedBuildings = {
        ...prev.buildings,
        [selectedBuildingId]: {
          ...building,
          sprinklerData,
        },
      };
      const includeLocalisedGroup = shouldIncludeLocalisedScoring(updatedBuildings);
      const updatedQuestions = currentSupplementary.questions.map((question) =>
        question.factor_key === RE04_LOCALISED_INSTALLED_FACTOR_KEY ? { ...question, score_1_5: null } : question
      );

      return {
        ...prev,
        buildings: updatedBuildings,
        supplementary_assessment: {
          ...currentSupplementary,
          ...deriveSupplementaryScores(updatedQuestions, { includeLocalisedGroup }),
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
          ...deriveSupplementaryScores(questions, {
            includeLocalisedGroup: shouldIncludeLocalisedScoring(prev.buildings),
          }),
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

      <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-risk-info-bg rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-risk-info-fg" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">Engineering Assessment (Primary)</h3>
            <p className="text-sm text-slate-600">This is the only scoring layer that drives RE-04 overall score.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Adequacy</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.adequacy_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Reliability</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.reliability_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="text-sm text-slate-600 mb-1">Localised / Special</div>
            <div className="text-2xl font-bold text-slate-900">{supplementaryScores.localised_subscore ?? 'Not rated'}</div>
          </div>
          <div className="bg-risk-info-bg rounded-lg p-4 border border-risk-info-border">
            <div className="text-sm text-risk-info-fg mb-1">Overall Engineering Score</div>
            <div className="text-2xl font-bold text-risk-info-fg">{supplementaryScores.overall_score ?? 'Not rated'}</div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-slate-900 mb-3">Adequacy (Q1–Q5)</h4>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {RE04_ENGINEERING_QUESTIONS_BY_GROUP.adequacy.map((definition) => {
                const question = supplementaryAssessment.questions.find((q) => q.factor_key === definition.factorKey);
                if (!question) return null;
                return (
                  <ReEngineeringQuestionCard
                    key={definition.factorKey}
                    questionId={definition.id}
                    factorKey={definition.factorKey}
                    prompt={definition.prompt}
                    weight={definition.weight}
                    rating={question.score_1_5}
                    notes={question.notes}
                    autoRecommendationState={supplementaryAutoRecStates[definition.factorKey] || 'none'}
                    onRatingChange={(rating) => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', rating)}
                    onClearRating={() => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', null)}
                    onNotesChange={(notes) => updateSupplementaryQuestion(definition.factorKey, 'notes', notes)}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-slate-900 mb-3">Reliability (Q6–Q10)</h4>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {RE04_ENGINEERING_QUESTIONS_BY_GROUP.reliability.map((definition) => {
                const question = supplementaryAssessment.questions.find((q) => q.factor_key === definition.factorKey);
                if (!question) return null;
                return (
                  <ReEngineeringQuestionCard
                    key={definition.factorKey}
                    questionId={definition.id}
                    factorKey={definition.factorKey}
                    prompt={definition.prompt}
                    weight={definition.weight}
                    rating={question.score_1_5}
                    notes={question.notes}
                    autoRecommendationState={supplementaryAutoRecStates[definition.factorKey] || 'none'}
                    onRatingChange={(rating) => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', rating)}
                    onClearRating={() => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', null)}
                    onNotesChange={(notes) => updateSupplementaryQuestion(definition.factorKey, 'notes', notes)}
                  />
                );
              })}
            </div>
          </div>

          <div className="border border-risk-info-border bg-risk-info-bg rounded-lg p-4">
            <h4 className="font-semibold text-risk-info-fg mb-3">Localised / Special Protection Knockout</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Is localised fire protection required for process/equipment hazards where a fire could develop rapidly or where ceiling sprinkler protection may not provide timely control?</label>
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
                  <label className="block text-sm font-medium text-slate-700 mb-2">If yes, is it installed?</label>
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
            {(() => {
              const currentState = selectedBuildingId ? localisedKnockoutAutoRecStates[selectedBuildingId] : 'none';
              const hasActiveRecommendation = currentState === 'created' || currentState === 'updated' || currentState === 'restored';

              if (isLocalisedKnockoutFailed) {
                return (
                  <p className="mt-3 text-sm text-risk-high-fg">
                    {hasActiveRecommendation ? 'Localised protection knockout recommendation is active.' : 'Localised protection knockout recommendation will be created on save.'}
                  </p>
                );
              }

              if (hasActiveRecommendation) {
                return (
                  <p className="mt-3 text-sm text-risk-info-fg">
                    Localised protection knockout recommendation will be suppressed on save.
                  </p>
                );
              }

              return null;
            })()}
            {!showLocalisedDetailedAssessment && <p className="mt-3 text-sm text-risk-info-fg">Q11–Q13 are shown only when localised protection is required and installed.</p>}
          </div>

          {showLocalisedDetailedAssessment && (
            <div>
              <h4 className="font-semibold text-slate-900 mb-3">Localised / Special Protection (Q11–Q13)</h4>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {RE04_ENGINEERING_QUESTIONS_BY_GROUP.localised.map((definition) => {
                  const question = supplementaryAssessment.questions.find((q) => q.factor_key === definition.factorKey);
                  if (!question) return null;
                  return (
                    <ReEngineeringQuestionCard
                      key={definition.factorKey}
                      questionId={definition.id}
                      factorKey={definition.factorKey}
                      prompt={definition.prompt}
                      weight={definition.weight}
                      rating={question.score_1_5}
                      notes={question.notes}
                      autoRecommendationState={supplementaryAutoRecStates[definition.factorKey] || 'none'}
                      onRatingChange={(rating) => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', rating)}
                      onClearRating={() => updateSupplementaryQuestion(definition.factorKey, 'score_1_5', null)}
                      onNotesChange={(notes) => updateSupplementaryQuestion(definition.factorKey, 'notes', notes)}
                    />
                  );
                })}
              </div>
            </div>
          )}
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
                        <div className="text-xs text-slate-600">Supporting</div>
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
                    Building Active Score (supporting only)
                  </div>
                  <div className="text-3xl font-bold text-slate-900">
                    {selectedFinalScore !== null && selectedFinalScore !== undefined ? `${selectedFinalScore}/5` : 'Not rated'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Sprinklers: {selectedSprinklerScore !== null && selectedSprinklerScore !== undefined ? `${selectedSprinklerScore}/5` : 'Not rated'} • Detection:{' '}
                    {selectedDetectionScore !== null && selectedDetectionScore !== undefined ? `${selectedDetectionScore}/5` : 'Not rated'}
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="Unknown">Unknown</option>
                          <option value="Adequate">Adequate</option>
                          <option value="Inadequate">Inadequate</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}
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
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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

      {hasSufficientSiteRollupData ? (
        <div className="mt-6 bg-slate-50 rounded-lg border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-slate-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-slate-800">Site coverage roll-up (secondary indicator)</h3>
              <p className="text-xs text-slate-600">
                Informational building-coverage context only. Engineering assessment above remains the scoring driver.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 border border-slate-200">
              <div className="text-sm text-slate-600 mb-1">Buildings with required coverage</div>
              <div className="text-2xl font-semibold text-slate-900">{siteRollup.buildingsAssessed}</div>
            </div>

            <div className="bg-white rounded-lg p-4 border border-slate-200">
              <div className="text-sm text-slate-600 mb-1">Installed sprinkler coverage</div>
              <div className="text-2xl font-semibold text-slate-900">{siteRollup.installedSprinklerArea.toLocaleString()} m²</div>
              <div className="mt-1 text-sm text-slate-700">{siteRollup.installedCoverage_pct.toFixed(1)}% of total area</div>
            </div>

            <div className="bg-white rounded-lg p-4 border border-slate-200">
              <div className="text-sm text-slate-600 mb-1">Required sprinkler coverage</div>
              <div className="text-2xl font-semibold text-slate-900">{siteRollup.requiredSprinklerArea.toLocaleString()} m²</div>
              <div className="mt-1 text-sm text-slate-700">{siteRollup.requiredCoverage_pct.toFixed(1)}% of total area</div>
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

          {(siteRollup.missingRequiredCoverageCount > 0 || siteRollup.missingInstalledCoverageCount > 0) && (
            <div className="mt-4 p-3 bg-risk-medium-bg rounded-lg border border-risk-medium-border">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-risk-medium-fg mt-0.5" />
                <p className="text-sm text-risk-medium-fg">
                  Coverage roll-up is partial due to missing source data:
                  {siteRollup.missingRequiredCoverageCount > 0
                    ? ` required sprinkler coverage missing for ${siteRollup.missingRequiredCoverageCount} building${siteRollup.missingRequiredCoverageCount === 1 ? '' : 's'}`
                    : ''}
                  {siteRollup.missingRequiredCoverageCount > 0 && siteRollup.missingInstalledCoverageCount > 0 ? '; ' : ''}
                  {siteRollup.missingInstalledCoverageCount > 0
                    ? ` installed sprinkler coverage missing for ${siteRollup.missingInstalledCoverageCount} building${siteRollup.missingInstalledCoverageCount === 1 ? '' : 's'}`
                    : ''}
                  .
                </p>
              </div>
              {siteRollup.missingFieldPaths.length > 0 && (
                <div className="mt-2 text-xs text-risk-medium-fg">
                  Missing field paths: {siteRollup.missingFieldPaths.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 border border-slate-200 rounded-lg bg-slate-50 p-4">
          <p className="text-sm text-slate-600">
            Site coverage roll-up is hidden until sufficient building coverage data is available.
            {installedCoverageUnavailableReason ? ` Installed coverage: ${installedCoverageUnavailableReason}.` : ''}
            {requiredCoverageUnavailableReason ? ` Required coverage: ${requiredCoverageUnavailableReason}.` : ''}
          </p>
        </div>
      )}


      {document?.id && moduleInstance?.id && (
        <ModuleActions documentId={document.id} moduleInstanceId={moduleInstance.id} buttonLabel="Add Recommendation" useInPlaceReRecommendationModal />
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
