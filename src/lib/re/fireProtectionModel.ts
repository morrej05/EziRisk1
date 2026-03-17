// src/lib/re/fireProtectionModel.ts

export type WaterReliability = 'Reliable' | 'Unreliable' | 'Unknown';
export type PumpArrangement = 'None' | 'Single' | 'Duty+Standby' | 'Unknown';
export type PowerResilience = 'Good' | 'Mixed' | 'Poor' | 'Unknown';
export type TestingRegime = 'Documented' | 'Some evidence' | 'None' | 'Unknown';
export type MaintenanceStatus = 'Good' | 'Mixed' | 'Poor' | 'Unknown';
export type SprinklerAdequacy = 'Adequate' | 'Inadequate' | 'Unknown';
export type SprinklerSystemType = 'wet' | 'dry' | 'esfr' | 'other' | 'unknown';
export type WaterSupplyType = 'mains' | 'tank' | 'dual' | 'unknown';

export interface SiteWaterData {
  water_reliability?: WaterReliability;
  supply_type?: string;
  pumps_present?: boolean;
  pump_arrangement?: PumpArrangement;
  power_resilience?: PowerResilience;
  testing_regime?: TestingRegime;
  key_weaknesses?: string;
  // Phase 1: Derived scores placeholder (no computation yet)
  derived?: {
    site_fire_protection_score?: 1 | 2 | 3 | 4 | 5;
  };
}

export interface SiteWaterRecord {
  id: string;
  document_id: string;
  data: SiteWaterData;
  water_score_1_5?: number;
  comments?: string;
  created_at: string;
  updated_at: string;
}

export interface BuildingSprinklerData {
  sprinkler_coverage_installed_pct?: number;
  sprinkler_coverage_required_pct?: number;
  sprinkler_standard?: string;
  hazard_class?: string;
  maintenance_status?: MaintenanceStatus;
  sprinkler_adequacy?: SprinklerAdequacy;
  justification_if_required_lt_100?: string;
  // Phase 1: New optional technical fields
  design_standard?: string;
  hazard_density?: string;
  system_type?: SprinklerSystemType;
  water_supply_type?: WaterSupplyType;
  // Phase 1: Derived scores placeholder (no computation yet)
  derived?: {
    building_fire_protection_score?: 1 | 2 | 3 | 4 | 5;
  };
}

export interface BuildingSprinklerRecord {
  id: string;
  document_id: string;
  building_id: string;
  data: BuildingSprinklerData;
  sprinkler_score_1_5?: number;
  final_active_score_1_5?: number;
  comments?: string;
  created_at: string;
  updated_at: string;
}

export function createDefaultSiteWater(documentId: string): Partial<SiteWaterRecord> {
  return {
    document_id: documentId,
    data: {
      water_reliability: 'Unknown',
      supply_type: '',
      pumps_present: false,
      pump_arrangement: 'Unknown',
      power_resilience: 'Unknown',
      testing_regime: 'Unknown',
      key_weaknesses: '',
    },
    water_score_1_5: 3,
    comments: '',
  };
}

export function createDefaultBuildingSprinkler(
  documentId: string,
  buildingId: string
): Partial<BuildingSprinklerRecord> {
  return {
    document_id: documentId,
    building_id: buildingId,
    data: {
      sprinkler_coverage_installed_pct: 0,
      sprinkler_coverage_required_pct: 0,
      sprinkler_standard: '',
      hazard_class: '',
      maintenance_status: 'Unknown',
      sprinkler_adequacy: 'Unknown',
      justification_if_required_lt_100: '',
    },
    sprinkler_score_1_5: 3,
    final_active_score_1_5: 3,
    comments: '',
  };
}

/**
 * Generate auto-flags for a building sprinkler record
 */

/**
 * Informational sprinkler adequacy helper for building evidence display only.
 */
export function calculateSprinklerScore(data: BuildingSprinklerData): number | null {
  const {
    sprinklers_installed,
    sprinkler_coverage_installed_pct,
    sprinkler_coverage_required_pct,
    sprinkler_adequacy,
    maintenance_status,
  } = data as BuildingSprinklerData & { sprinklers_installed?: 'Yes' | 'No' | 'Partial' | 'Unknown' };

  if (sprinklers_installed === 'No' || sprinklers_installed === 'Unknown') return null;
  if (!sprinkler_coverage_required_pct || sprinkler_coverage_required_pct === 0) return null;
  if (sprinkler_adequacy === 'Unknown') return null;

  const coverageRatio = Math.min(1, (sprinkler_coverage_installed_pct ?? 0) / sprinkler_coverage_required_pct);

  if (sprinkler_adequacy === 'Inadequate') return coverageRatio < 0.3 ? 1 : 2;
  if (coverageRatio >= 0.95 && maintenance_status === 'Good') return 5;
  if (coverageRatio >= 0.8) return 4;
  if (coverageRatio >= 0.6) return 3;
  if (coverageRatio >= 0.3) return 2;
  return 1;
}

export function generateAutoFlags(
  sprinklerData: BuildingSprinklerData,
  sprinklerScore: number | null,
  waterScore: number
): Array<{ severity: 'warning' | 'info'; message: string }> {
  const flags: Array<{ severity: 'warning' | 'info'; message: string }> = [];
  const {
    sprinklers_installed,
    sprinkler_coverage_installed_pct,
    sprinkler_coverage_required_pct,
  } = sprinklerData;

  // Skip coverage flags if sprinklers not installed
  if (sprinklers_installed !== 'No' && sprinklers_installed !== 'Unknown') {
    const installedPct = sprinkler_coverage_installed_pct ?? 0;
    const requiredPct = sprinkler_coverage_required_pct ?? 0;

    if (requiredPct > installedPct) {
      flags.push({
        severity: 'warning',
        message: `Coverage gap: ${requiredPct}% required but only ${installedPct}% installed`,
      });
    }

    if (requiredPct === 0 && installedPct > 0) {
      flags.push({
        severity: 'info',
        message: 'Sprinklers installed but marked as not required - verify rationale',
      });
    }
  }

  if (sprinklerScore !== null && sprinklerScore >= 4 && waterScore <= 2) {
    flags.push({
      severity: 'warning',
      message: `Sprinkler system rated highly (${sprinklerScore}/5) but water supply is unreliable (${waterScore}/5)`,
    });
  }

  return flags;
}

/**
 * Calculate site-level roll-up: area-weighted average of final_active_score_1_5
 * across buildings where sprinkler_coverage_required_pct > 0
 */
export interface SiteRollup {
  averageScore: number;
  buildingsAssessed: number;
  totalArea: number;
}

export function calculateSiteRollup(
  buildingSprinklers: BuildingSprinklerRecord[],
  buildings: Array<{ id: string; footprint_m2?: number | null }>
): SiteRollup {
  let totalWeightedScore = 0;
  let totalArea = 0;
  let buildingsAssessed = 0;

  for (const sprinkler of buildingSprinklers) {
    const requiredPct = sprinkler.data.sprinkler_coverage_required_pct || 0;

    // Only include buildings where sprinklers are required
    if (requiredPct === 0) continue;

    const building = buildings.find(b => b.id === sprinkler.building_id);
    const area = building?.footprint_m2 || 0;

    if (area > 0 && sprinkler.final_active_score_1_5) {
      totalWeightedScore += sprinkler.final_active_score_1_5 * area;
      totalArea += area;
      buildingsAssessed++;
    }
  }

  const averageScore = totalArea > 0 ? totalWeightedScore / totalArea : 0;

  return {
    averageScore: Math.round(averageScore * 10) / 10, // 1 decimal place
    buildingsAssessed,
    totalArea,
  };
}
