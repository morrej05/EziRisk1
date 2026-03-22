import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import {
  MARGIN,
  CONTENT_WIDTH,
  PAGE_TOP_Y,
  sanitizePdfText,
  wrapText,
  addNewPage,
  drawFooter,
  addSupersededWatermark,
  ensurePageSpace,
  formatDate,
} from './pdfUtils';
import { drawSectionHeaderBar, drawRiskSignificanceBlock, SignificanceLevel } from './pdfPrimitives';
import { buildRiskEngineeringScoreBreakdown } from '../re/scoring/riskEngineeringHelpers';
import { getModuleDisplayName } from '../modules/moduleDisplay';

interface DocumentMeta {
  client?: { name?: string };
  site?: { name?: string; address?: string };
}

interface Document {
  id: string;
  document_type: string;
  title: string;
  status: string;
  version: number;
  assessment_date: string;
  review_date: string | null;
  assessor_name: string | null;
  assessor_role: string | null;
  responsible_person: string | null;
  scope_description: string | null;
  limitations_assumptions: string | null;
  created_at: string;
  updated_at: string;
  executive_summary_ai?: string | null;
  executive_summary_author?: string | null;
  executive_summary_mode?: string | null;
  jurisdiction?: string;
  meta?: DocumentMeta;
  version_number?: number;
  issue_date?: string;
  base_document_id?: string;
  issue_status?: string;
}

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, unknown>;
  completed_at: string | null;
  updated_at: string;
}

interface Action {
  id: string;
  recommended_action: string;
  priority_band: string;
  status: string;
  owner_user_id: string | null;
  owner_display_name?: string;
  target_date: string | null;
  module_instance_id: string;
  created_at: string;
}

interface Organisation {
  id: string;
  name: string;
  branding_logo_path?: string | null;
}

interface BuildPdfOptions {
  document: Document;
  moduleInstances: ModuleInstance[];
  actions: Action[];
  organisation: Organisation;
  renderMode?: 'preview' | 'issued';
  selectedModules?: string[];
  scoreBreakdownOverride?: Breakdown;
}

type Breakdown = Awaited<ReturnType<typeof buildRiskEngineeringScoreBreakdown>>;

type Row = [string, string, string?];

interface LossValuesSummary {
  buildings: number;
  plantMachinery: number;
  stock: number;
  grossProfitAnnual: number;
  indemnityMonths: number;
  effectivePropertyTotal: number;
}

const RE_SECTION_CONFIG: Record<string, { title: string; key: string }> = {
  RE_02_CONSTRUCTION: { title: 'Construction', key: 'construction' },
  RE_03_OCCUPANCY: { title: 'Occupancy', key: 'occupancy' },
  RE_06_FIRE_PROTECTION: { title: 'Fire Protection', key: 'fire_protection' },
  RE_07_NATURAL_HAZARDS: { title: 'Exposures', key: 'exposures' },
  RE_08_UTILITIES: { title: 'Utilities & Critical Services', key: 'utilities' },
  RE_09_MANAGEMENT: { title: 'Management Systems', key: 'management' },
  RE_12_LOSS_VALUES: { title: 'Loss & Values', key: 'loss_values' },
  RE_14_DRAFT_OUTPUTS: { title: 'Supporting Documentation / Evidence Appendix', key: 'supporting_documentation' },
};

function getRatingFromModule(module?: ModuleInstance | null): number | null {
  if (!module?.data) return null;
  if (module.module_key === 'RE_06_FIRE_PROTECTION') {
    const supplementaryOverall = Number((module.data as any)?.fire_protection?.supplementary_assessment?.overall_score);
    if (Number.isFinite(supplementaryOverall) && supplementaryOverall >= 1) return supplementaryOverall;
  }
  const direct = Number(module.data?.ratings?.site_rating_1_5);
  if (Number.isFinite(direct) && direct >= 1) return direct;
  return null;
}

function levelFromRating(rating: number | null | undefined, invert = true): SignificanceLevel {
  if (!rating || !Number.isFinite(rating)) return 'Moderate';
  const r = Math.max(1, Math.min(5, rating));
  if (invert) {
    if (r <= 2) return 'High';
    if (r <= 3.5) return 'Moderate';
    return 'Low';
  }
  if (r >= 4) return 'High';
  if (r >= 2.5) return 'Moderate';
  return 'Low';
}

function levelFromPercent(percent: number): SignificanceLevel {
  if (percent < 45) return 'High';
  if (percent < 70) return 'Moderate';
  return 'Low';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not stated';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : 'Not stated';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function numericOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLossValuesSummary(data: Record<string, unknown> | undefined): LossValuesSummary {
  const d = data || {};
  const sums = (d.sums_insured as Record<string, unknown>) || (d.property_sums_insured as Record<string, unknown>) || {};
  const propertySums = (d.property_sums_insured as Record<string, unknown>) || {};
  const bi = (sums.business_interruption as Record<string, unknown>) || (d.business_interruption as Record<string, unknown>) || {};

  const propertyDamage = (sums.property_damage as Record<string, unknown>) || {};
  const buildings = numericOrZero(sums.buildings ?? propertySums.buildings ?? propertyDamage.buildings_improvements ?? d.buildings);
  const plantMachinery = numericOrZero(
    sums.plant_machinery ??
    sums.plantAndMachinery ??
    propertySums.plant_machinery ??
    propertySums.plantAndMachinery ??
    propertyDamage.plant_machinery_contents ??
    d.plant_machinery
  );
  const stock = numericOrZero(sums.stock ?? propertySums.stock ?? propertyDamage.stock_wip ?? d.stock);

  const explicitPropertyTotal = numericOrZero(sums.total ?? sums.total_sum_insured ?? propertySums.total ?? propertySums.total_sum_insured);
  const derivedPropertyTotal = buildings + plantMachinery + stock;
  const effectivePropertyTotal = explicitPropertyTotal > 0 ? explicitPropertyTotal : derivedPropertyTotal;

  const grossProfitAnnual = numericOrZero(bi.gross_profit_annual ?? bi.gross_profit ?? (sums.business_interruption as any)?.gross_profit_annual ?? d.gross_profit_annual ?? d.gross_profit);
  const indemnityMonths = numericOrZero(bi.indemnity_period_months ?? d.indemnity_period_months);

  return {
    buildings,
    plantMachinery,
    stock,
    grossProfitAnnual,
    indemnityMonths,
    effectivePropertyTotal,
  };
}

function drawParagraph(
  page: PDFPage,
  yPosition: number,
  text: string,
  font: any
): number {
  const lines = wrapText(sanitizePdfText(text), CONTENT_WIDTH, 10, font);
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y: yPosition, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    yPosition -= 14;
  }
  return yPosition;
}

function drawSimpleTable(
  page: PDFPage,
  yPosition: number,
  headers: string[],
  rows: Row[],
  fonts: { regular: any; bold: any },
  options: {
    colWidths?: number[];
    fontSize?: number;
    minRowHeight?: number;
    onPageBreak?: () => { page: PDFPage; yPosition: number };
  } = {}
): { page: PDFPage; yPosition: number } {
  const colWidths = options.colWidths || (headers.length === 2 ? [180, CONTENT_WIDTH - 180] : [170, 115, CONTENT_WIDTH - 285]);
  const fontSize = options.fontSize ?? 8.5;
  const lineHeight = 10;
  const cellPaddingX = 6;
  const cellPaddingY = 4;
  const minRowHeight = options.minRowHeight ?? 16;
  const bottomSafeY = MARGIN + 20;
  const tableLeft = MARGIN;
  const tableRight = MARGIN + CONTENT_WIDTH;
  let x = MARGIN;

  const drawHeader = (): number => {
    const headerHeight = 18;
    page.drawRectangle({
      x: tableLeft,
      y: yPosition - headerHeight + 4,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: rgb(0.94, 0.95, 0.97),
      borderColor: rgb(0.78, 0.8, 0.84),
      borderWidth: 0.8,
    });

    x = MARGIN;
    for (let i = 0; i < headers.length; i++) {
      page.drawText(headers[i], { x: x + cellPaddingX, y: yPosition - 8, size: 8.5, font: fonts.bold, color: rgb(0.08, 0.08, 0.08) });
      x += colWidths[i];
    }

    yPosition -= headerHeight;
    return headerHeight;
  };

  drawHeader();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const wrappedCells = headers.map((_, i) => {
      const value = sanitizePdfText((row[i] || '').toString());
      return wrapText(value, colWidths[i] - cellPaddingX * 2, fontSize, fonts.regular);
    });
    const maxLines = Math.max(1, ...wrappedCells.map(lines => lines.length));
    const rowHeight = Math.max(minRowHeight, maxLines * lineHeight + cellPaddingY * 2);

    if (yPosition - rowHeight < bottomSafeY && options.onPageBreak) {
      const pageBreakState = options.onPageBreak();
      page = pageBreakState.page;
      yPosition = pageBreakState.yPosition;
      drawHeader();
    }

    if (rowIndex % 2 === 1) {
      page.drawRectangle({
        x: tableLeft,
        y: yPosition - rowHeight + 2,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.98, 0.98, 0.99),
      });
    }

    page.drawLine({
      start: { x: tableLeft, y: yPosition + 2 },
      end: { x: tableRight, y: yPosition + 2 },
      thickness: 0.5,
      color: rgb(0.84, 0.85, 0.88),
    });

    x = MARGIN;
    for (let i = 0; i < headers.length; i++) {
      const lines = wrappedCells[i];
      const textY = yPosition - cellPaddingY - lineHeight + 2;
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + cellPaddingX,
          y: textY - lineIndex * lineHeight,
          size: fontSize,
          font: fonts.regular,
          color: rgb(0.15, 0.15, 0.15),
        });
      });

      if (i < headers.length - 1) {
        page.drawLine({
          start: { x: x + colWidths[i], y: yPosition - rowHeight + 2 },
          end: { x: x + colWidths[i], y: yPosition + 2 },
          thickness: 0.4,
          color: rgb(0.88, 0.89, 0.91),
        });
      }
      x += colWidths[i];
    }
    yPosition -= rowHeight;
  }

  page.drawLine({
    start: { x: tableLeft, y: yPosition + 2 },
    end: { x: tableRight, y: yPosition + 2 },
    thickness: 0.6,
    color: rgb(0.78, 0.8, 0.84),
  });

  return { page, yPosition: yPosition - 8 };
}

function getSectionTableRows(module: ModuleInstance, options: { breakdown?: Breakdown; linkedRecommendationCount?: number } = {}): Row[] {
  const d = module.data || {};
  if (module.module_key === 'RE_06_FIRE_PROTECTION') {
    const fp = (d as any).fire_protection || {};
    const buildings = Object.values((fp.buildings || {}) as Record<string, any>);
    const required = buildings.reduce((sum: number, b: any) => sum + Number(b?.sprinklerData?.sprinkler_coverage_required_pct || 0), 0);
    const installed = buildings.reduce((sum: number, b: any) => sum + Number(b?.sprinklerData?.sprinkler_coverage_installed_pct || 0), 0);
    const supplementary = fp.supplementary_assessment || {};
    const scoredQuestions = Array.isArray(supplementary.questions)
      ? supplementary.questions.filter((q: any) => Number.isFinite(Number(q?.score_1_5)))
      : [];
    const pillar = options.breakdown?.globalPillars.find((p) => p.key === 'fire_protection');
    const count = buildings.length || 1;
    return [
      ['Buildings assessed', formatValue(buildings.length || '')],
      ['Avg sprinkler required coverage', `${Math.round((required / count) * 10) / 10}%`],
      ['Avg sprinkler installed coverage', `${Math.round((installed / count) * 10) / 10}%`],
      ['Water supply reliability', formatValue(fp.site?.water?.water_reliability)],
      ['Supplementary assessment (questions rated)', `${scoredQuestions.length}`],
      ['Supplementary engineering overall score', `${formatValue(supplementary.overall_score)}/5`],
      ['Fire protection weighted contribution', pillar ? `${pillar.score.toFixed(1)} of ${pillar.maxScore.toFixed(1)}` : 'Not stated'],
      ['Linked recommendations', `${options.linkedRecommendationCount ?? 0}`],
    ];
  }
  if (module.module_key === 'RE_08_UTILITIES') {
    const services = Array.isArray((d as any).critical_services) ? (d as any).critical_services : [];
    const equipment = Array.isArray((d as any).critical_equipment) ? (d as any).critical_equipment : [];
    return [
      ['Backup power present', formatValue((d as any).power_resilience?.backup_power_present)],
      ['Generator / capacity notes', formatValue((d as any).power_resilience?.generator_capacity_notes)],
      ['Critical services logged', formatValue(services.length || '')],
      ['Critical equipment logged', formatValue(equipment.length || '')],
    ];
  }
  if (module.module_key === 'RE_12_LOSS_VALUES') {
    const loss = getLossValuesSummary(d);
    return [
      ['Buildings', formatValue(loss.buildings || '')],
      ['Plant & machinery', formatValue(loss.plantMachinery || '')],
      ['Stock / contents', formatValue(loss.stock || '')],
      ['BI gross profit (annual)', formatValue(loss.grossProfitAnnual || '')],
      ['Indemnity period (months)', formatValue(loss.indemnityMonths || '')],
    ];
  }

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    const construction = (d as any).construction || d;
    const buildings = Array.isArray(construction.buildings) ? construction.buildings : [];
    return [
      ['Buildings recorded', formatValue(buildings.length || '')],
      ['Site notes', formatValue(construction.site_notes)],
      ['Primary construction type', formatValue(construction.primary_construction_type ?? construction.construction_type)],
      ['Compartmentation quality', formatValue(construction.compartmentation_quality)],
    ];
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    const occupancy = (d as any).occupancy || d;
    return [
      ['Process / use overview', formatValue(occupancy.process_overview ?? occupancy.process_description ?? occupancy.operations_description)],
      ['Industry hazard notes', formatValue(occupancy.industry_special_hazards_notes)],
      ['Generic hazards logged', formatValue(Array.isArray(occupancy.hazards) ? occupancy.hazards.length : '')],
      ['Additional hazards notes', formatValue(occupancy.hazards_free_text)],
    ];
  }

  if (module.module_key === 'RE_07_NATURAL_HAZARDS') {
    const exposures = (d as any).exposures || d;
    const perils = exposures.environmental?.perils || {};
    return [
      ['Flood exposure rating', formatValue(perils.flood?.rating)],
      ['Windstorm exposure rating', formatValue(perils.wind?.rating)],
      ['Wildfire exposure rating', formatValue(perils.wildfire?.rating)],
      ['Human exposure rating', formatValue(exposures.human_exposure?.rating)],
    ];
  }

  if (module.module_key === 'RE_09_MANAGEMENT') {
    const management = (d as any).management || d;
    const categories = Array.isArray(management.categories) ? management.categories : [];
    const lowRated = categories.filter((c: any) => Number(c?.rating_1_5) <= 2).length;
    return [
      ['Management categories rated', formatValue(categories.length || '')],
      ['Low-rated categories (1-2)', formatValue(lowRated || '')],
      ['Hot work notes', formatValue(categories.find((c: any) => c?.key === 'hot_work')?.notes)],
      ['Impairment management notes', formatValue(categories.find((c: any) => c?.key === 'impairment_management')?.notes)],
    ];
  }

  if (module.module_key === 'RE_14_DRAFT_OUTPUTS') {
    return [
      ['Site plans / layout available', formatValue((d as any).site_plans_available)],
      ['Fire system test evidence', formatValue((d as any).fire_system_test_evidence)],
      ['Business continuity documents', formatValue((d as any).bcp_documents_available)],
      ['Photos / records attached', formatValue((d as any).evidence_pack_attached)],
    ];
  }

  return [];
}


function getNarrativeCommentary(module: ModuleInstance): string {
  const notes = sanitizePdfText(module.assessor_notes || '').trim();
  const rating = getRatingFromModule(module);
  const scoreBand = getScoreBand(rating);

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    const base = `Construction selected score: ${rating ?? 'Not stated'}/5 (${scoreBand.label}). ${scoreBand.constructionImplication} This indicates ${scoreBand.resilienceLabel} resilience in structural fire performance and fire spread resistance.`;
    return notes ? `${base} Additional assessor notes: ${notes}` : base;
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    const base = `Occupancy selected score: ${rating ?? 'Not stated'}/5 (${scoreBand.label}). ${scoreBand.occupancyImplication} This indicates ${scoreBand.resilienceLabel} resilience in process controls, ignition management and loss containment potential.`;
    return notes ? `${base} Additional assessor notes: ${notes}` : base;
  }

  if (notes) return notes;
  const sectionTitle = RE_SECTION_CONFIG[module.module_key]?.title || 'Section';
  return `${sectionTitle} assessment reflects submitted survey fields and calibrated engineering scoring outputs.`;
}

function getScoreBand(rating: number | null): {
  label: string;
  resilienceLabel: 'weaker' | 'mixed' | 'stronger';
  constructionImplication: string;
  occupancyImplication: string;
} {
  if (!rating || !Number.isFinite(rating)) {
    return {
      label: 'Not stated',
      resilienceLabel: 'mixed',
      constructionImplication: 'Construction conditions could not be benchmarked from a selected score.',
      occupancyImplication: 'Occupancy/process controls could not be benchmarked from a selected score.',
    };
  }
  if (rating <= 1.5) {
    return {
      label: 'Poor',
      resilienceLabel: 'weaker',
      constructionImplication: 'A low rating indicates high combustibility or structural vulnerability with elevated fire spread and reinstatement risk.',
      occupancyImplication: 'A low rating indicates high-hazard processes or limited controls, increasing ignition likelihood and loss severity.',
    };
  }
  if (rating <= 2.5) {
    return {
      label: 'Below Average',
      resilienceLabel: 'weaker',
      constructionImplication: 'A below-average rating indicates notable construction vulnerabilities and non-trivial escalation pathways during major fire events.',
      occupancyImplication: 'A below-average rating indicates material occupancy/process hazards with only partial mitigating controls.',
    };
  }
  if (rating <= 3.5) {
    return {
      label: 'Average',
      resilienceLabel: 'mixed',
      constructionImplication: 'An average rating indicates mixed construction performance with both resilient and vulnerable features.',
      occupancyImplication: 'An average rating indicates mixed occupancy/process risk with baseline controls but meaningful residual hazard.',
    };
  }
  if (rating <= 4.5) {
    return {
      label: 'Good',
      resilienceLabel: 'stronger',
      constructionImplication: 'A good rating indicates generally resilient construction with lower expected fire spread and structural compromise potential.',
      occupancyImplication: 'A good rating indicates generally well-controlled processes and hazard management with lower expected loss escalation.',
    };
  }
  return {
    label: 'Excellent',
    resilienceLabel: 'stronger',
    constructionImplication: 'An excellent rating indicates strong construction resilience and robust resistance to rapid fire propagation.',
    occupancyImplication: 'An excellent rating indicates robust occupancy/process controls and strong resilience against severe fire/explosion scenarios.',
  };
}

function getMaterialPercent(
  breakdown: Array<{ material?: string; percent?: number | null }> | undefined,
  includeCombustible: boolean
): number | null {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;
  let total = 0;
  for (const item of breakdown) {
    const material = String(item?.material || '').toLowerCase();
    const percent = Number(item?.percent);
    if (!Number.isFinite(percent)) continue;
    const isCombustible = material.includes('combustible') || material.includes('foam plastic') || material.includes('timber');
    if ((includeCombustible && isCombustible) || (!includeCombustible && !isCombustible)) total += percent;
  }
  return Math.max(0, Math.min(100, Math.round(total * 10) / 10));
}

function getConstructionBuildingRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = Array.isArray(construction.buildings) ? construction.buildings : [];
  return buildings.map((building: any): Row => {
    const refOrName = building.ref || building.building_name || building.name || building.id || 'Not stated';
    const roofArea = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzArea = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    const wallsCombPct = getMaterialPercent(building?.walls?.breakdown, true);
    const storeys = building?.geometry?.floors ?? building?.storeys;
    const basements = building?.geometry?.basements ?? building?.basements;
    const claddingPresent = Boolean(building?.combustible_cladding?.present ?? (building?.cladding_present && building?.cladding_combustible));
    const cladding = claddingPresent
      ? `Yes${building?.combustible_cladding?.details ? ` - ${building.combustible_cladding.details}` : ''}`
      : 'No';
    const score = building?.calculated?.construction_rating ?? building?.calculated?.re02 ?? building?.re02_score;
    const combustibility = building?.calculated?.combustible_percent ?? getMaterialPercent(building?.roof?.breakdown, true);

    return [
      formatValue(refOrName),
      `Roof ${formatValue(roofArea)} m² | Mezz ${formatValue(mezzArea)} m² | Walls combust. ${formatValue(wallsCombPct)}% | Storeys ${formatValue(storeys)} | Basements ${formatValue(basements)} | Comb. cladding ${cladding} | RE-02 ${formatValue(score)} | Combustibility ${formatValue(combustibility)}%`,
    ];
  });
}

function getOccupancyStructuredRows(module: ModuleInstance): Row[] {
  const occupancy = (module.data as any)?.occupancy || module.data || {};
  const hazards = Array.isArray(occupancy.hazards) ? occupancy.hazards : [];
  const hazardList = hazards
    .map((hazard: any) => {
      const label = hazard?.hazard_label || hazard?.hazard_key || 'Hazard';
      const assessment = hazard?.assessment ? ` (${hazard.assessment})` : '';
      const detail = hazard?.free_text || hazard?.description;
      return detail ? `${label}${assessment}: ${detail}` : `${label}${assessment}`;
    })
    .filter(Boolean);

  return [
    ['Process / use overview', formatValue(occupancy.process_overview ?? occupancy.process_description ?? occupancy.operations_description ?? occupancy.occupancy_type)],
    ['Industry-specific special hazards', formatValue(occupancy.industry_special_hazards_notes)],
    ['Industry fire / explosion features', formatValue(occupancy.fire_explosion_features ?? occupancy.industry_fire_explosion_features ?? occupancy.special_fire_explosion_features)],
    ['Selected hazards / descriptors', hazardList.length ? hazardList.join('; ') : 'Not stated'],
    ['User free-text notes', formatValue(occupancy.hazards_free_text ?? occupancy.notes)],
  ];
}

function buildExecutiveSignificanceNarrative(breakdown: Breakdown): { level: SignificanceLevel; narrative: string } {
  const percent = breakdown.maxScore > 0 ? (breakdown.totalScore / breakdown.maxScore) * 100 : 0;
  const top = breakdown.topContributors.slice(0, 2).map(t => t.label).join(' and ');
  const level = levelFromPercent(percent);
  const narrative = `${breakdown.industryLabel} risk profile currently performs at ${percent.toFixed(0)}% of weighted benchmark. Primary loss drivers are ${top || 'the major engineering pillars'}, indicating where underwriting attention and resilience controls are most material for probable property and BI loss outcomes.`;
  return { level, narrative };
}

function sectionSignificance(module: ModuleInstance, breakdown: Breakdown): { level: SignificanceLevel; narrative: string } | null {
  const config = RE_SECTION_CONFIG[module.module_key];
  if (!config) return null;

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    const rating = getRatingFromModule(module) ?? breakdown.globalPillars.find(p => p.key === 'construction_and_combustibility')?.rating;
    const level = levelFromRating(rating);
    const narrative = `Construction resilience is assessed at ${rating ?? 'N/A'}/5. This influences fire spread potential, structural vulnerability, reinstatement complexity and the likely scale of property interruption following a major event.`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    const industryLabel = breakdown.industryLabel;
    const topDriver = breakdown.occupancyDrivers[0]?.label;
    const rating = getRatingFromModule(module);
    const level = levelFromRating(rating);
    const narrative = `Occupancy profile (${industryLabel}) and process characteristics shape ignition, fire load and severity dynamics. ${topDriver ? `Current data indicates ${topDriver} as a key occupancy-related contributor.` : 'Current occupancy factors materially influence potential loss severity.'}`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_06_FIRE_PROTECTION') {
    const rating = getRatingFromModule(module) ?? breakdown.globalPillars.find(p => p.key === 'fire_protection')?.rating;
    const level = levelFromRating(rating);
    const narrative = `Fire protection adequacy/reliability is rated ${rating ?? 'N/A'}/5. This is central to expected fire control performance, escalation prevention and containment of direct damage and business interruption.`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_07_NATURAL_HAZARDS') {
    const rating = getRatingFromModule(module) ?? breakdown.globalPillars.find(p => p.key === 'exposure')?.rating;
    const level = levelFromRating(rating);
    const narrative = `External exposure conditions are rated ${rating ?? 'N/A'}/5. Hazard context and controls determine probability of severe external events and recovery complexity once utilities, access or surrounding assets are disrupted.`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_08_UTILITIES') {
    const rating = getRatingFromModule(module);
    const spofCount = Array.isArray(module.data?.single_points_of_failure) ? module.data.single_points_of_failure.length : 0;
    const level = spofCount >= 2 ? 'High' : levelFromRating(rating);
    const narrative = `Utilities resilience is rated ${rating ?? 'N/A'}/5 with ${spofCount} identified single-point failure${spofCount === 1 ? '' : 's'}. Utilities reliability is a direct determinant of business interruption duration, restart capability and contingent loss.`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_09_MANAGEMENT') {
    const rating = getRatingFromModule(module) ?? breakdown.globalPillars.find(p => p.key === 'management_systems')?.rating;
    const level = levelFromRating(rating);
    const narrative = `Management systems are rated ${rating ?? 'N/A'}/5. Governance quality controls how consistently impairment, hot work, housekeeping and emergency processes reduce both incident likelihood and post-loss severity.`;
    return { level, narrative };
  }

  if (module.module_key === 'RE_12_LOSS_VALUES') {
    const loss = getLossValuesSummary(module.data);
    const highMagnitude = loss.effectivePropertyTotal >= 10000000 || loss.grossProfitAnnual >= 3000000 || loss.indemnityMonths >= 12;
    const level: SignificanceLevel = highMagnitude ? 'High' : loss.effectivePropertyTotal > 0 || loss.grossProfitAnnual > 0 ? 'Moderate' : 'Low';
    const narrative = `Declared loss values indicate property exposure of ${loss.effectivePropertyTotal > 0 ? loss.effectivePropertyTotal.toLocaleString() : 'not stated'} and BI gross profit of ${loss.grossProfitAnnual > 0 ? loss.grossProfitAnnual.toLocaleString() : 'not stated'}. This frames potential loss quantum and insurer balance-sheet sensitivity for severe but plausible scenarios.`;
    return { level, narrative };
  }

  return null;
}

export async function buildReSurveyPdf(options: BuildPdfOptions): Promise<Uint8Array> {
  console.log('[PDF RE Survey] Starting RE Survey PDF build');
  const { document, moduleInstances, actions, organisation, renderMode, selectedModules } = options;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isIssuedMode = renderMode === 'issued';
  const isDraft = !isIssuedMode;
  const totalPages: PDFPage[] = [];

  console.log('[PDF RE Survey] Render mode:', isIssuedMode ? 'ISSUED' : 'DRAFT');

  let { page } = addNewPage(pdfDoc, isDraft, totalPages);
  let yPosition = PAGE_TOP_Y;

  const modulesToInclude = selectedModules
    ? moduleInstances.filter(m => selectedModules.includes(m.module_key))
    : moduleInstances;

  const modulesByKey = new Map(modulesToInclude.map(m => [m.module_key, m]));
  const riskEngineeringData = modulesByKey.get('RISK_ENGINEERING')?.data || {};
  const breakdown = options.scoreBreakdownOverride || await buildRiskEngineeringScoreBreakdown(document.id, riskEngineeringData);

  ({ page, yPosition } = ensurePageSpace(110, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Report Overview',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });
  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Item', 'Detail'],
    [
      ['Report', formatValue(document.title || 'Risk Engineering Survey')],
      ['Organisation', formatValue(organisation.name)],
      ['Client', formatValue(document.meta?.client?.name || document.responsible_person)],
      ['Site', formatValue(document.meta?.site?.name || document.scope_description)],
      ['Assessment date', formatValue(formatDate(document.assessment_date || null))],
      ['Version / status', `v${Number(document.version_number || document.version || 1)} - ${isIssuedMode ? 'Issued' : 'Draft'}`],
    ],
    { regular: font, bold: fontBold },
    {
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Executive Summary',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });

  const summary = buildExecutiveSignificanceNarrative(breakdown);
  const performanceRatio = (breakdown.totalScore / Math.max(1, breakdown.maxScore)) * 100;
  const overallRating = levelFromPercent(performanceRatio);
  const overallRiskSignificance = summary.level;
  const engineeringOpinion =
    overallRiskSignificance === 'High'
      ? 'Material engineering vulnerabilities are present and require prioritised risk improvement to reduce likely loss severity.'
      : overallRiskSignificance === 'Moderate'
        ? 'Engineering controls are mixed with meaningful opportunities to improve resilience and reduce volatility in loss outcomes.'
        : 'Engineering controls are generally robust with lower relative loss volatility at present conditions.';
  ({ page, yPosition } = ensurePageSpace(170, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawParagraph(
    page,
    yPosition,
    `This report summarises risk engineering findings for ${document.meta?.site?.name || document.scope_description || 'the assessed site'} in ${breakdown.industryLabel} context. Weighted total score is ${breakdown.totalScore.toFixed(1)} of ${breakdown.maxScore.toFixed(1)} (${performanceRatio.toFixed(0)}%) with an overall ${overallRating} rating.`,
    font
  );

  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Executive indicator', 'Assessment'],
    [
      ['Overall score', `${breakdown.totalScore.toFixed(1)} / ${breakdown.maxScore.toFixed(1)} (${performanceRatio.toFixed(0)}%)`],
      ['Overall rating', overallRating],
      ['Key risk drivers', breakdown.topContributors.slice(0, 3).map(driver => driver.label).join('; ') || 'Not stated'],
      ['Overall engineering opinion', engineeringOpinion],
      ['Overall risk significance', overallRiskSignificance],
    ],
    { regular: font, bold: fontBold },
    {
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  yPosition = drawRiskSignificanceBlock({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    level: summary.level,
    narrative: summary.narrative,
    fonts: { regular: font, bold: fontBold },
  }).y;

  yPosition -= 8;

  ({ page, yPosition } = ensurePageSpace(220, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Risk Scoring Summary',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });

  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Metric', 'Value'],
    [
      ['Industry label', breakdown.industryLabel],
      ['Total weighted score', `${breakdown.totalScore.toFixed(1)} / ${breakdown.maxScore.toFixed(1)}`],
      ['Performance ratio', `${((breakdown.totalScore / Math.max(1, breakdown.maxScore)) * 100).toFixed(0)}%`],
    ],
    { regular: font, bold: fontBold },
    {
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  yPosition -= 6;
  yPosition = drawParagraph(page, yPosition, 'Global pillars:', fontBold);
  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Pillar', 'Rating', 'Weighted Score'],
    breakdown.globalPillars.map(p => [p.label, `${p.rating ?? 'N/A'}/5`, `${p.score.toFixed(1)} of ${p.maxScore.toFixed(1)}`]),
    { regular: font, bold: fontBold },
    {
      fontSize: 8.25,
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  ({ page, yPosition } = ensurePageSpace(180, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Key Risk Drivers',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });

  const driverRows: Row[] = [
    ...breakdown.occupancyDrivers.slice(0, 5).map((d): Row => [d.label, `${d.rating ?? 'N/A'}/5`, `${d.score.toFixed(1)} of ${d.maxScore.toFixed(1)}`]),
    ...breakdown.topContributors.map((c): Row => [`Top contributor: ${c.label}`, `${c.rating ?? 'N/A'}/5`, `${c.score.toFixed(1)} of ${c.maxScore.toFixed(1)}`]),
  ];
  ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Driver', 'Rating', 'Weighted Score'], driverRows, { regular: font, bold: fontBold }, {
    fontSize: 8.25,
    onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
  }));

  ({ page, yPosition } = ensurePageSpace(180, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Document Control',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });
  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Control item', 'Value'],
    [
      ['Document ID', formatValue(document.id)],
      ['Assessment date', formatValue(formatDate(document.assessment_date || null))],
      ['Review date', formatValue(formatDate(document.review_date || null))],
      ['Issue date', formatValue(formatDate((document.issue_date || document.assessment_date) || null))],
      ['Assessor', formatValue(document.assessor_name)],
      ['Assessor role', formatValue(document.assessor_role)],
      ['Responsible person', formatValue(document.responsible_person)],
    ],
    { regular: font, bold: fontBold },
    {
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  const orderedSections = [
    'RE_02_CONSTRUCTION',
    'RE_03_OCCUPANCY',
    'RE_06_FIRE_PROTECTION',
    'RE_07_NATURAL_HAZARDS',
    'RE_08_UTILITIES',
    'RE_09_MANAGEMENT',
    'RE_12_LOSS_VALUES',
    'RE_14_DRAFT_OUTPUTS',
  ];

  for (const moduleKey of orderedSections) {
    const module = modulesByKey.get(moduleKey);
    if (!module) continue;
    ({ page, yPosition } = ensurePageSpace(170, page, yPosition, pdfDoc, isDraft, totalPages));

    const sectionTitle = RE_SECTION_CONFIG[module.module_key]?.title || getModuleDisplayName(module.module_key);
    yPosition = drawSectionHeaderBar({
      page,
      x: MARGIN,
      y: yPosition,
      w: CONTENT_WIDTH,
      title: sectionTitle,
      product: 're',
      fonts: { regular: font, bold: fontBold },
    });

    const linkedRecommendationCount = actions.filter((action) => action.module_instance_id === module.id).length;
    const tableRows = getSectionTableRows(module, { breakdown, linkedRecommendationCount });
    if (tableRows.length > 0) {
      ({ page, yPosition } = ensurePageSpace(100 + tableRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawParagraph(page, yPosition, 'Section Snapshot', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], tableRows, { regular: font, bold: fontBold }, {
        colWidths: [195, CONTENT_WIDTH - 195],
        fontSize: 9,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
    }

    if (module.module_key === 'RE_02_CONSTRUCTION') {
      const buildingRows = getConstructionBuildingRows(module);
      if (buildingRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + buildingRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawParagraph(page, yPosition, 'Building-level Construction Inputs', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Building', 'Module detail'], buildingRows, { regular: font, bold: fontBold }, {
          colWidths: [140, CONTENT_WIDTH - 140],
          fontSize: 8.5,
          minRowHeight: 20,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
      }
    }

    if (module.module_key === 'RE_03_OCCUPANCY') {
      const occupancyRows = getOccupancyStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + occupancyRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawParagraph(page, yPosition, 'Occupancy Module Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], occupancyRows, { regular: font, bold: fontBold }, {
        colWidths: [170, CONTENT_WIDTH - 170],
        fontSize: 8.75,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
    }

    const commentary = getNarrativeCommentary(module);
    ({ page, yPosition } = ensurePageSpace(120, page, yPosition, pdfDoc, isDraft, totalPages));
    yPosition = drawParagraph(page, yPosition, 'Narrative Commentary', fontBold);
    yPosition = drawParagraph(page, yPosition, commentary, font);

    const significance = sectionSignificance(module, breakdown);
    if (significance) {
      ({ page, yPosition } = ensurePageSpace(100, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawRiskSignificanceBlock({
        page,
        x: MARGIN,
        y: yPosition,
        w: CONTENT_WIDTH,
        level: significance.level,
        narrative: significance.narrative,
        fonts: { regular: font, bold: fontBold },
      }).y;
    }

    yPosition -= 10;
  }

  ({ page, yPosition } = ensurePageSpace(130, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Conclusion',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });

  const conclusion = `Overall engineering materiality is ${summary.level.toLowerCase()}. Judgement reflects combined weighted scoring, principal contributors and section-level vulnerabilities that may amplify maximum foreseeable loss and business interruption duration.`;
  yPosition = drawRiskSignificanceBlock({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    level: summary.level,
    narrative: conclusion,
    fonts: { regular: font, bold: fontBold },
  }).y;

  for (let i = 0; i < totalPages.length; i++) {
    drawFooter(totalPages[i], document.title, i + 1, totalPages.length, font);
  }

  if (document.issue_status === 'superseded') {
    await addSupersededWatermark(pdfDoc);
  }

  const pdfBytes = await pdfDoc.save();
  console.log('[PDF RE Survey] PDF build complete');
  return pdfBytes;
}
