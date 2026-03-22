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
import { addIssuedReportPages } from './issuedPdfPages';

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

const SECTION_BLOCK_SPACING = 20;

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

const RE_SURVEY_DISCLAIMER_TEXT =
  'This report represents a professional opinion based on observations and information available at the time of survey. It does not constitute a guarantee of loss prevention performance. Generated outputs are support tools requiring competent review before issue or reliance. Responsibility for interpretation and implementation of recommendations remains with the duty holder and competent professional.';

function getRatingFromModule(module?: ModuleInstance | null): number | null {
  if (!module?.data) return null;
  if (module.module_key === 'RE_02_CONSTRUCTION') {
    const construction = (module.data as any)?.construction || module.data || {};
    const moduleSpecific =
      Number((module.data as any)?.ratings?.site_rating_1_5) ||
      Number(construction?.site_re02_score) ||
      Number(construction?.calculated?.site_construction_rating) ||
      Number(construction?.site_totals?.site_re02_score);
    if (Number.isFinite(moduleSpecific) && moduleSpecific >= 1) return moduleSpecific;
  }
  if (module.module_key === 'RE_03_OCCUPANCY') {
    const occupancy = (module.data as any)?.occupancy || module.data || {};
    const moduleSpecific =
      Number((module.data as any)?.ratings?.site_rating_1_5) ||
      Number(occupancy?.ratings?.site_rating_1_5) ||
      Number(occupancy?.site_rating_1_5);
    if (Number.isFinite(moduleSpecific) && moduleSpecific >= 1) return moduleSpecific;
  }
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

function formatDataValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Data not provided';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : 'Data not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatDataPercent(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Data not provided';
  return `${numeric}%`;
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

function sectionBreak(yPosition: number, spacing = SECTION_BLOCK_SPACING): number {
  return yPosition - spacing;
}

function drawBlockHeading(page: PDFPage, yPosition: number, title: string, fontBold: any): number {
  const withTopSpacing = sectionBreak(yPosition, 8);
  return drawParagraph(page, withTopSpacing, title, fontBold);
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


function resolveSectionRating(module: ModuleInstance, breakdown: Breakdown): number | null {
  const direct = getRatingFromModule(module);
  if (direct && Number.isFinite(direct)) return direct;

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    return breakdown.globalPillars.find((p) => p.key === 'construction_and_combustibility')?.rating ?? null;
  }
  if (module.module_key === 'RE_03_OCCUPANCY') {
    const weighted = breakdown.occupancyDrivers.filter((driver) => Number.isFinite(Number(driver.rating)) && driver.weight > 0);
    if (weighted.length === 0) return null;
    const totalWeight = weighted.reduce((sum, driver) => sum + driver.weight, 0);
    if (totalWeight <= 0) return null;
    const weightedAverage = weighted.reduce((sum, driver) => sum + Number(driver.rating) * driver.weight, 0) / totalWeight;
    return Math.max(1, Math.min(5, Math.round(weightedAverage * 10) / 10));
  }

  return null;
}

function getNarrativeCommentaryWithBreakdown(module: ModuleInstance, breakdown: Breakdown): string {
  const notes = sanitizePdfText(module.assessor_notes || '').trim();
  const rating = resolveSectionRating(module, breakdown);
  const scoreBand = getScoreBand(rating);

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    const context = getConstructionContext(module, breakdown);
    const combustibleValue = context.explicitCombustiblePct ?? context.derivedCombustiblePct;
    const fireSpreadRisk = combustibleValue === null
      ? 'fire spread potential cannot be quantified from provided construction percentages'
      : combustibleValue >= 40
        ? 'elevated fire spread potential'
        : combustibleValue >= 20
          ? 'moderate fire spread potential'
          : 'generally controlled fire spread potential';
    const structuralResilience = rating && rating >= 4 ? 'strong structural resilience' : rating && rating >= 3 ? 'mixed structural resilience' : 'heightened structural vulnerability';
    const lossScale = context.totalRoofArea >= 3000 ? 'material loss scale potential' : 'moderate loss scale potential';
    const reinstatementComplexity = context.totalRoofArea >= 3000 || context.hasMezzanine || (rating ?? 0) <= 2.5
      ? 'reinstatement complexity is likely elevated due to site scale and internal vertical interfaces'
      : 'reinstatement complexity is expected to be moderate';
    const scoreText = Number.isFinite(rating as number) ? `${rating}/5` : 'Unavailable';
    const base = `Construction score: ${scoreText} (${scoreBand.label}). RE-02 reflects construction combustibility, structural system resilience, and envelope escalation potential. The current site includes ${context.buildingCount} building(s), total roof area ${formatDataValue(context.totalRoofArea)} m², and mezzanine area ${formatDataValue(context.totalMezzArea)} m². Combustible proportion is ${context.combustibilityText} (${context.combustibilitySource === 'explicit' ? 'from submitted site totals' : context.combustibilitySource === 'derived' ? 'derived from building-level data' : 'data not provided'}). This indicates ${fireSpreadRisk}, ${structuralResilience}, ${lossScale}, and ${reinstatementComplexity}.${context.partialData ? ' Interpretation is based on partial construction data.' : ''}`;
    return notes ? `${base} Additional assessor notes: ${notes}` : base;
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    const occupancy = (module.data as any)?.occupancy || module.data || {};
    const hazards = Array.isArray(occupancy.hazards) ? occupancy.hazards : [];
    const hazardSignals = describeOccupancyHazardSignals(hazards, occupancy);
    const scoreText = Number.isFinite(rating as number) ? `${rating}/5` : 'Unavailable';
    const base = `Occupancy score: ${scoreText} (${scoreBand.label}). ${scoreBand.occupancyImplication} Observed hazards (${hazardSignals.hazardSummary}) indicate ${hazardSignals.ignitionLikelihood}, ${hazardSignals.fireLoadSeverity}, and ${hazardSignals.controlsDependency}. ${hazardSignals.processSpecificNarrative}`;
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
      label: 'Unscored',
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
      label: 'Moderate',
      resilienceLabel: 'mixed',
      constructionImplication: 'A moderate rating indicates mixed construction performance with both resilient and vulnerable features.',
      occupancyImplication: 'A moderate rating indicates mixed occupancy/process risk with baseline controls but meaningful residual hazard.',
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

function describeConstructionBuildingMix(buildings: any[]): string {
  if (!buildings.length) return 'no building-level mix data';
  const frameTypes = new Set<string>();
  for (const building of buildings) {
    const frame = String(building?.frame_type || '').trim();
    if (frame) frameTypes.add(frame.replace(/_/g, ' '));
  }
  if (frameTypes.size === 0) return `${buildings.length} building(s) with unspecified frame mix`;
  return `${buildings.length} building(s) across ${frameTypes.size} frame type(s): ${Array.from(frameTypes).join(', ')}`;
}

function getConstructionContext(module: ModuleInstance, breakdown: Breakdown): {
  buildings: any[];
  rating: number | null;
  totalRoofArea: number;
  totalMezzArea: number;
  buildingCount: number;
  hasMezzanine: boolean;
  hasMultipleBuildings: boolean;
  explicitCombustiblePct: number | null;
  derivedCombustiblePct: number | null;
  combustibilitySource: 'explicit' | 'derived' | 'none';
  combustibilityText: string;
  partialData: boolean;
} {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = Array.isArray(construction.buildings) ? construction.buildings : [];
  const rating = resolveSectionRating(module, breakdown);
  const totalRoofArea = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.roof?.area_sqm ?? b?.roof_area_m2), 0);
  const totalMezzArea = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.upper_floors_mezzanine?.area_sqm ?? b?.mezzanine_area_m2), 0);
  const explicitCombustible = Number(
    construction?.site_combustible_percent ??
      construction?.calculated?.site_combustible_percent ??
      construction?.site_totals?.site_combustible_percent
  );
  const explicitCombustiblePct = Number.isFinite(explicitCombustible) ? explicitCombustible : null;
  const combustibleValues = buildings
    .map((building: any) => Number(building?.calculated?.combustible_percent))
    .filter((value: number) => Number.isFinite(value));
  const derivedCombustiblePct = combustibleValues.length
    ? Math.round((combustibleValues.reduce((sum: number, value: number) => sum + value, 0) / combustibleValues.length) * 10) / 10
    : null;
  const combustibilitySource = explicitCombustiblePct !== null ? 'explicit' : derivedCombustiblePct !== null ? 'derived' : 'none';
  const combustibilityValue = explicitCombustiblePct ?? derivedCombustiblePct;
  const buildingCount = buildings.length;
  const hasMezzanine = buildings.some((building: any) => numericOrZero(building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2) > 0);
  const hasMultipleBuildings = buildingCount > 1;
  const partialData = combustibilitySource === 'none' || buildings.some((building: any) => {
    const hasRoofArea = Number.isFinite(Number(building?.roof?.area_sqm ?? building?.roof_area_m2));
    const hasStoreys = Number.isFinite(Number(building?.geometry?.floors ?? building?.storeys ?? building?.floors ?? building?.number_of_storeys));
    return !hasRoofArea || !hasStoreys;
  });

  return {
    buildings,
    rating,
    totalRoofArea,
    totalMezzArea,
    buildingCount,
    hasMezzanine,
    hasMultipleBuildings,
    explicitCombustiblePct,
    derivedCombustiblePct,
    combustibilitySource,
    combustibilityText: combustibilityValue !== null ? `${combustibilityValue}%` : 'Data not provided',
    partialData,
  };
}

function describeOccupancyHazardSignals(hazards: any[], occupancy: any): {
  hazardSummary: string;
  ignitionLikelihood: string;
  fireLoadSeverity: string;
  controlsDependency: string;
  processSpecificNarrative: string;
} {
  const tokens = hazards.map((hazard) => String(hazard?.hazard_label || hazard?.hazard_key || '').toLowerCase()).filter(Boolean);
  const bodyText = `${occupancy?.industry_special_hazards_notes || ''} ${occupancy?.hazards_free_text || ''} ${hazards.map((h) => h?.free_text || '').join(' ')}`.toLowerCase();
  const hasFryers = tokens.some((token) => token.includes('fryer')) || bodyText.includes('fryer') || bodyText.includes('deep fat');
  const hasThermalOil = tokens.some((token) => token.includes('thermal oil')) || bodyText.includes('thermal oil') || bodyText.includes('hot oil');
  const hasFlammable = tokens.some((token) => token.includes('ignitable') || token.includes('flammable') || token.includes('gas')) || bodyText.includes('flammable') || bodyText.includes('solvent');
  const hasDustExplosion = tokens.some((token) => token.includes('dust') || token.includes('explosive')) || bodyText.includes('dust') || bodyText.includes('powder');
  const hasBatteryRisk = tokens.some((token) => token.includes('lithium') || token.includes('battery')) || bodyText.includes('lithium') || bodyText.includes('battery');
  const highHazardCount = [hasFlammable, hasDustExplosion, hasBatteryRisk, hasFryers, hasThermalOil].filter(Boolean).length;

  const ignitionLikelihood = highHazardCount >= 2 ? 'high ignition likelihood' : highHazardCount === 1 ? 'moderate ignition likelihood' : 'baseline ignition likelihood';
  const fireLoadSeverity = hasFlammable || hasDustExplosion || hasFryers || hasThermalOil ? 'elevated fire load/severity potential' : 'moderate fire load/severity potential';
  const controlsDependency = highHazardCount >= 2 ? 'high dependency on engineered and procedural controls' : 'moderate dependency on controls';
  const hazardSummary = tokens.length ? tokens.slice(0, 4).join(', ') : 'no explicit hazard entries';
  const processSpecificNarrative = [
    hasFryers ? 'Industrial fryers introduce sustained high-temperature ignition sources and oil-fire severity potential.' : '',
    hasThermalOil ? 'Thermal oil systems introduce high-temperature leak scenarios that can accelerate escalation behaviour.' : '',
  ].filter(Boolean).join(' ');

  return { hazardSummary, ignitionLikelihood, fireLoadSeverity, controlsDependency, processSpecificNarrative };
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

function getConstructionBuildingEvidenceRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = Array.isArray(construction.buildings) ? construction.buildings : [];
  return buildings.map((building: any): Row => {
    const refOrName = building.ref || building.building_name || building.name || building.id;
    const roofArea = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzArea = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    const wallsCombPct = getMaterialPercent(building?.walls?.breakdown, true);
    const wallsPct =
      Number.isFinite(Number(building?.walls?.total_percent)) ? Number(building.walls.total_percent) :
      Number.isFinite(Number(building?.walls_percent)) ? Number(building?.walls_percent) :
      Number.isFinite(Number(building?.wall_percent)) ? Number(building?.wall_percent) :
      null;
    const storeys = building?.geometry?.floors ?? building?.storeys ?? building?.floors ?? building?.number_of_storeys;
    const basements = building?.geometry?.basements ?? building?.basements ?? building?.basement_levels ?? building?.number_of_basements;
    const claddingPresent = Boolean(
      building?.combustible_cladding?.present ??
      building?.cladding_present ??
      building?.has_combustible_cladding ??
      (building?.cladding_present && building?.cladding_combustible)
    );
    const cladding = claddingPresent
      ? `Yes${building?.combustible_cladding?.details || building?.cladding_system ? ` - ${building?.combustible_cladding?.details || building?.cladding_system}` : ''}`
      : 'No';
    const score =
      building?.calculated?.construction_rating ??
      building?.calculated?.re02 ??
      building?.re02_score ??
      building?.re02_construction_score ??
      building?.construction_rating;
    const combustibility =
      building?.calculated?.combustible_percent ??
      building?.area_weighted_combustible_percent ??
      building?.combustible_percent ??
      getMaterialPercent(building?.roof?.breakdown, true);
    return [
      formatDataValue(refOrName),
      formatDataValue(roofArea),
      formatDataValue(mezzArea),
      `${formatDataPercent(wallsCombPct)} / ${formatDataPercent(wallsPct)}`,
      formatDataValue(storeys),
      formatDataValue(basements),
      sanitizePdfText(cladding),
      formatDataValue(score),
      formatDataPercent(combustibility),
    ];
  });
}

function getConstructionSiteSummaryRows(module: ModuleInstance, breakdown: Breakdown): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const context = getConstructionContext(module, breakdown);
  const pillarScore = breakdown.globalPillars.find((p) => p.key === 'construction_and_combustibility');
  const siteScore = construction?.site_re02_score ?? construction?.calculated?.site_construction_rating ?? construction?.site_totals?.site_re02_score ?? pillarScore?.rating;
  return [
    ['Site totals (roof m² / mezz m²)', `${formatDataValue(context.totalRoofArea)} / ${formatDataValue(context.totalMezzArea)}`],
    ['Site RE-02 score', `${formatDataValue(siteScore)}`],
    ['Site combustible %', context.combustibilityText],
    ['Site-level construction notes', formatDataValue(construction.site_notes)],
  ];
}

function getOccupancyStructuredRows(module: ModuleInstance): Row[] {
  const occupancy = (module.data as any)?.occupancy || module.data || {};
  const hazards = Array.isArray(occupancy.hazards) ? occupancy.hazards : [];
  const hazardList = hazards
    .map((hazard: any) => {
      const label = hazard?.hazard_label || hazard?.hazard_key || 'Hazard';
      const assessment = hazard?.assessment ? ` (${hazard.assessment})` : '';
      const detail = hazard?.free_text || hazard?.description;
      const formattedLabel = String(label).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      return detail ? `- ${formattedLabel}${assessment}:\n  - ${String(detail).trim()}` : `- ${formattedLabel}${assessment}`;
    })
    .filter(Boolean)
    .filter((value: string, index: number, arr: string[]) => arr.indexOf(value) === index);

  return [
    ['Occupancy type', formatDataValue(occupancy.occupancy_type)],
    ['Process / use overview', formatDataValue(occupancy.process_overview ?? occupancy.process_description ?? occupancy.operations_description ?? occupancy.occupancy_type)],
    ['Shift pattern / operating profile', formatDataValue(occupancy.shift_pattern ?? occupancy.operating_profile)],
    ['Combustible loading profile', formatDataValue(occupancy.combustible_loading)],
    ['Industry-specific special hazards', formatDataValue(occupancy.industry_special_hazards_notes)],
    ['Industry fire / explosion features', formatDataValue(occupancy.fire_explosion_features ?? occupancy.industry_fire_explosion_features ?? occupancy.special_fire_explosion_features)],
    ['Selected hazards / descriptors', hazardList.length ? hazardList.join('\n') : 'Data not provided'],
    ['User free-text notes', formatDataValue(occupancy.hazards_free_text ?? occupancy.notes)],
  ];
}

function getFireProtectionBuildingRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = fp?.buildings || {};
  return Object.entries(buildings).map(([buildingId, buildingData]: [string, any]): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const detectionTypes = Array.isArray(sprinklerData?.detection_types)
      ? sprinklerData.detection_types.join(', ')
      : '';
    return [
      formatDataValue(buildingId),
      [
        `Sprinklers: ${formatDataValue(sprinklerData?.sprinklers_installed)}`,
        `Installed/required: ${formatDataPercent(sprinklerData?.sprinkler_coverage_installed_pct)} / ${formatDataPercent(sprinklerData?.sprinkler_coverage_required_pct)}`,
        `System/standard: ${formatDataValue(sprinklerData?.system_type)} / ${formatDataValue(sprinklerData?.standard ?? sprinklerData?.sprinkler_standard)}`,
        `Maintenance/adequacy: ${formatDataValue(sprinklerData?.maintenance_status)} / ${formatDataValue(sprinklerData?.sprinkler_adequacy)}`,
        `Localised required/present: ${formatDataValue(sprinklerData?.localised_required)} / ${formatDataValue(sprinklerData?.localised_present)}`,
        `Localised type/asset: ${formatDataValue(sprinklerData?.localised_type)} / ${formatDataValue(sprinklerData?.localised_protected_asset)}`,
        `Localised comments: ${formatDataValue(sprinklerData?.localised_comments)}`,
        `Coverage justification: ${formatDataValue(sprinklerData?.justification_if_required_lt_100)}`,
        `Building reliability notes: ${formatDataValue(buildingData?.comments)}`,
      ].join('\n'),
      [
        `Detection installed: ${formatDataValue(sprinklerData?.detection_installed)}`,
        `Monitoring: ${formatDataValue(sprinklerData?.alarm_monitoring)}`,
        `Testing/maintenance: ${formatDataValue(sprinklerData?.detection_testing_regime)} / ${formatDataValue(sprinklerData?.detection_maintenance_status)}`,
        `Detection types: ${formatDataValue(detectionTypes || sprinklerData?.detection_type_other)}`,
        `Detection comments: ${formatDataValue(sprinklerData?.detection_comments)}`,
        `Sprinkler/detection/final score: ${formatDataValue(sprinklerData?.sprinkler_score_1_5)} / ${formatDataValue(sprinklerData?.detection_score_1_5)} / ${formatDataValue(sprinklerData?.final_active_score_1_5)}`,
      ].join('\n'),
    ];
  });
}

function getFireProtectionSiteRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const water = fp?.site?.water || {};
  const buildings = Object.values((fp?.buildings || {}) as Record<string, any>);
  const installed = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.sprinklerData?.sprinkler_coverage_installed_pct), 0);
  const required = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.sprinklerData?.sprinkler_coverage_required_pct), 0);
  const count = Math.max(buildings.length, 1);
  return [
    ['Water reliability / supply type', `${formatDataValue(water?.water_reliability)} / ${formatDataValue(water?.supply_type)} (${formatDataValue(water?.supply_type_other)})`],
    ['Supports / pumps / arrangement', `${formatDataValue(water?.supports)} / ${formatDataValue(water?.pumps_present)} / ${formatDataValue(water?.pump_arrangement)}`],
    ['Power resilience / testing regime', `${formatDataValue(water?.power_resilience)} / ${formatDataValue(water?.testing_regime)}`],
    ['Hydrant/fire main/hose reels', `${formatDataValue(water?.hydrant_coverage)} / ${formatDataValue(water?.fire_main_condition)} / ${formatDataValue(water?.hose_reels_present)}`],
    ['Flow test evidence / date', `${formatDataValue(water?.flow_test_evidence)} / ${formatDataValue(water?.flow_test_date)}`],
    ['Water weaknesses / site comments', `${formatDataValue(water?.key_weaknesses)} / ${formatDataValue(fp?.site?.comments)}`],
    ['Site water score (1-5)', formatDataValue(fp?.site?.water_score_1_5)],
    ['Impairment management notes', formatDataValue((module.data as any)?.management?.impairment_management ?? (module.data as any)?.management?.impairment_management_notes)],
    ['Legacy fixed systems / detection', `${formatDataValue(fp?.sprinklers_present)} / ${formatDataValue(fp?.automatic_detection)} / ${formatDataValue(fp?.hydrants)}`],
    ['Building totals and averages', `${formatDataValue(buildings.length || '')} buildings; avg installed ${Math.round((installed / count) * 10) / 10}% vs avg required ${Math.round((required / count) * 10) / 10}%`],
  ];
}

function getFireProtectionSupplementaryRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const supplementary = fp?.supplementary_assessment || {};
  const questions = Array.isArray(supplementary?.questions) ? supplementary.questions : [];
  const scored = questions.filter((q: any) => Number.isFinite(Number(q?.score_1_5)));
  const notesPresent = scored.filter((q: any) => String(q?.notes || '').trim().length > 0).length;
  const headlineRows: Row[] = [
    ['Questions scored', `${scored.length} of ${questions.length || 0}`],
    ['Adequacy / reliability subscore', `${formatDataValue(supplementary?.adequacy_subscore)} / ${formatDataValue(supplementary?.reliability_subscore)}`],
    ['Localised / evidence subscore', `${formatDataValue(supplementary?.localised_subscore)} / ${formatDataValue(supplementary?.evidence_subscore)}`],
    ['Overall supplementary score', formatDataValue(supplementary?.overall_score)],
    ['Question notes captured', formatDataValue(notesPresent || '')],
  ];
  const questionRows: Row[] = questions.map((q: any, index: number) => [
    `Q${index + 1}: ${formatDataValue(q?.prompt ?? q?.factor_key)}`,
    `Score ${formatDataValue(q?.score_1_5)} / Notes: ${formatDataValue(q?.notes)}`,
  ]);
  return [...headlineRows, ...questionRows];
}

function getExposuresStructuredRows(module: ModuleInstance): Row[] {
  const exposures = (module.data as any)?.exposures || module.data || {};
  const perils = exposures?.environmental?.perils || {};
  const environmental = [
    ['Flood', perils?.flood?.rating, perils?.flood?.notes],
    ['Windstorm', perils?.wind?.rating, perils?.wind?.notes],
    ['Wildfire', perils?.wildfire?.rating, perils?.wildfire?.notes],
    ['Seismic', perils?.seismic?.rating, perils?.seismic?.notes],
    ['Freeze', perils?.freeze?.rating, perils?.freeze?.notes],
  ]
    .filter((item) => item[1] !== undefined || item[2])
    .map((item) => `${item[0]}: ${formatDataValue(item[1])}${item[2] ? ` (${formatDataValue(item[2])})` : ''}`)
    .join('\n');

  return [
    ['Environmental perils', formatDataValue(environmental || exposures?.flood_exposure_level || exposures?.windstorm_exposure_level || exposures?.wildfire_exposure_level)],
    ['Other peril', `${formatDataValue(perils?.other?.label)} / ${formatDataValue(perils?.other?.rating)} / ${formatDataValue(perils?.other?.notes)}`],
    ['Human exposure / adjoining risk', `${formatDataValue(exposures?.human_exposure?.rating)} / ${formatDataValue(exposures?.adjoining_risk)}`],
    ['Human exposure notes', formatDataValue(exposures?.human_exposure?.notes)],
    ['Security / arson controls', formatDataValue(exposures?.security?.notes ?? exposures?.arson_controls)],
    ['Drainage / site topography notes', formatDataValue(exposures?.drainage_notes ?? exposures?.site_topography_notes)],
    ['Mitigation / resilience notes', formatDataValue(exposures?.resilience_measures ?? exposures?.mitigation_notes)],
  ];
}

function getUtilitiesStructuredRows(module: ModuleInstance): Row[] {
  const d = module.data || {};
  const power = (d as any).power_resilience || (d as any).power || {};
  const services = Array.isArray((d as any).critical_services) ? (d as any).critical_services : [];
  const equipment = Array.isArray((d as any).critical_equipment) ? (d as any).critical_equipment : [];
  const spof = Array.isArray((d as any).single_points_of_failure) ? (d as any).single_points_of_failure : [];
  return [
    ['Backup power present / capacity', `${formatDataValue(power?.backup_power_present ?? power?.resilience_level)} / ${formatDataValue(power?.generator_capacity_notes ?? power?.backup_generation)}`],
    ['Power resilience notes', formatDataValue(power?.notes)],
    ['Critical dependencies', formatDataValue((d as any).critical_dependencies)],
    ['Critical services', services.length ? services.map((item: any) => `${formatDataValue(item?.custom_label ?? item?.service_name ?? item?.service_type ?? item?.name ?? item)} | present ${formatDataValue(item?.present)} | criticality ${formatDataValue(item?.criticality)} | backup ${formatDataValue(item?.backup_available)} | notes ${formatDataValue(item?.notes)}`).join('\n') : 'Data not provided'],
    ['Critical equipment', equipment.length ? equipment.map((item: any) => `${formatDataValue(item?.custom_label ?? item?.equipment_name ?? item?.equipment_type ?? item?.name ?? item)} (${formatDataValue(item?.tag_or_name)}) | criticality ${formatDataValue(item?.criticality)} | redundancy ${formatDataValue(item?.redundancy)} | spares ${formatDataValue(item?.spares_strategy)} | maintenance ${formatDataValue(item?.maintenance_adequacy_rating)} | condition ${formatDataValue(item?.condition_notes ?? item?.known_issues)} | notes ${formatDataValue(item?.notes)}`).join('\n') : 'Data not provided'],
    ['Single points of failure', spof.length ? spof.map((item: any) => `- ${formatDataValue(item)}`).join('\n') : 'Data not provided'],
  ];
}

function getManagementStructuredRows(module: ModuleInstance): Row[] {
  const management = (module.data as any)?.management || module.data || {};
  const categories = Array.isArray(management?.categories) ? management.categories : [];
  const categoryRows = categories
    .map((category: any) => `${formatDataValue(category?.label ?? category?.key)}: ${formatDataValue(category?.rating_1_5)} (${formatDataValue(category?.notes)})`)
    .join('\n');
  return [
    ['Formal management system', formatDataValue(management?.formal_risk_management_system)],
    ['Hot work controls', formatDataValue(management?.hot_work_permit_process)],
    ['Housekeeping standard', formatDataValue(management?.housekeeping_standard)],
    ['Emergency response planning', formatDataValue(management?.emergency_response_plan)],
    ['Impairment controls', formatDataValue(management?.impairment_management ?? management?.impairment_management_notes)],
    ['Category ratings and notes', formatDataValue(categoryRows)],
    ['Recommendations / actions', Array.isArray(management?.recommendations) ? management.recommendations.map((rec: any) => formatDataValue(rec?.action || rec?.text || rec)).join('\n') : 'Data not provided'],
  ];
}

function getLossValuesStructuredRows(module: ModuleInstance): Row[] {
  const d = module.data || {};
  const loss = getLossValuesSummary(d);
  const sums = ((d as any).sums_insured || (d as any).property_sums_insured || {}) as any;
  const bi = ((d as any).business_interruption || sums?.business_interruption || {}) as any;
  return [
    ['Currency', formatDataValue((d as any)?.currency)],
    ['Buildings / plant & machinery / stock', `${formatDataValue(loss.buildings)} / ${formatDataValue(loss.plantMachinery)} / ${formatDataValue(loss.stock)}`],
    ['Property total (effective)', formatDataValue(loss.effectivePropertyTotal)],
    ['BI gross profit annual / indemnity months', `${formatDataValue(loss.grossProfitAnnual)} / ${formatDataValue(loss.indemnityMonths)}`],
    ['Additional BI notes', formatDataValue(bi?.notes ?? (d as any)?.business_interruption_notes)],
    ['Declared values commentary', formatDataValue((d as any)?.loss_comments ?? (d as any)?.declared_values_notes ?? sums?.notes)],
    ['Sums insured additional comments', formatDataValue((d as any)?.sums_insured?.additional_comments)],
    ['WLE scenario / estimate', `${formatDataValue((d as any)?.wle?.scenario_summary ?? (d as any)?.wle?.scenario_description)} | ${formatDataValue((d as any)?.wle?.estimated_total ?? (d as any)?.wle?.estimated_total_loss)}`],
    ['NLE scenario / estimate', `${formatDataValue((d as any)?.nle?.scenario_summary ?? (d as any)?.nle?.scenario_description)} | ${formatDataValue((d as any)?.nle?.estimated_total ?? (d as any)?.nle?.estimated_total_loss)}`],
  ];
}

function buildFireProtectionEngineeringInterpretation(module: ModuleInstance): string {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = Object.values((fp?.buildings || {}) as Record<string, any>);
  const sprinklerRequiredCount = buildings.filter((b: any) => Number.isFinite(Number(b?.sprinklerData?.sprinkler_coverage_required_pct)) && Number(b?.sprinklerData?.sprinkler_coverage_required_pct) > 0).length;
  const sprinklerInstalledCount = buildings.filter((b: any) => (b?.sprinklerData?.sprinklers_installed === 'Yes' || Number(b?.sprinklerData?.sprinkler_coverage_installed_pct) > 0)).length;
  const localisedMissing = buildings.filter((b: any) => b?.sprinklerData?.localised_required === 'Yes' && b?.sprinklerData?.localised_present === 'No').length;
  const water = fp?.site?.water || {};
  const reliability = formatDataValue(water?.water_reliability).toLowerCase();
  const reliabilityNarrative = reliability.includes('reliable') ? 'water supply reliability appears broadly resilient' : reliability.includes('unreliable') ? 'water supply reliability is a material weakness' : 'water supply reliability is uncertain from submitted evidence';
  return `Engineering Interpretation: Building-level fixed protection records show ${sprinklerInstalledCount} building(s) with installed sprinkler coverage against ${sprinklerRequiredCount} building(s) showing a stated requirement. ${reliabilityNarrative}. Localised/special protection gaps are identified in ${localisedMissing} building(s), and should be prioritised where high-value or high-challenge hazards are present. Supplementary fire-engineering outputs, testing evidence and impairment governance records should be read together to judge expected suppression reliability during a severe event.`;
}

function buildConstructionScoringBasisText(module: ModuleInstance): string {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = Array.isArray(construction.buildings) ? construction.buildings : [];
  const buildingCount = buildings.length;
  return `RE-02 measures physical fire performance of the built asset: combustible proportion in roof/wall/mezzanine assemblies, structural system robustness, and external envelope/cladding escalation pathways. Higher scores are driven by lower combustible percentages, resilient non-combustible structural assemblies, and absence of combustible cladding. Lower scores are driven by high combustible fractions, vulnerable mixed assemblies, weak compartmentation, and combustible envelope elements. Current dataset includes ${buildingCount} building record${buildingCount === 1 ? '' : 's'} for this assessment.`;
}

function buildConstructionEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown): string {
  const context = getConstructionContext(module, breakdown);
  const buildingMix = describeConstructionBuildingMix(context.buildings);
  const combustibleValue = context.explicitCombustiblePct ?? context.derivedCombustiblePct;
  const fireSpreadRisk = combustibleValue === null
    ? 'fire spread risk cannot be quantified from provided combustibility data'
    : combustibleValue >= 40
      ? 'high fire spread risk'
      : combustibleValue >= 20
        ? 'moderate fire spread risk'
        : 'lower fire spread risk';
  const structuralResilience = context.rating && context.rating >= 4 ? 'strong structural resilience' : context.rating && context.rating >= 3 ? 'intermediate structural resilience' : 'limited structural resilience';
  const conditionalDrivers = [
    context.hasMezzanine ? 'mezzanine levels increase vertical fire spread pathways' : '',
    context.hasMultipleBuildings ? 'multiple buildings introduce inter-building fire spread potential' : '',
    context.totalRoofArea >= 3000 ? 'large floor area increases probable maximum loss scale' : '',
  ].filter(Boolean).join('; ');
  const reinstatementComplexity = context.totalRoofArea >= 3000 || context.hasMezzanine || (context.rating ?? 0) <= 2.5 ? 'elevated reinstatement complexity' : 'moderate reinstatement complexity';
  return `Engineering Interpretation: Combustible proportion (${context.combustibilityText}; ${context.combustibilitySource === 'explicit' ? 'site totals provided' : context.combustibilitySource === 'derived' ? 'derived from building records' : 'data not provided'}) and building mix (${buildingMix}) with RE-02 score (${Number.isFinite(context.rating as number) ? `${context.rating}/5` : 'unavailable'}) indicate ${fireSpreadRisk}, ${structuralResilience}, and ${reinstatementComplexity}.${conditionalDrivers ? ` Site-specific drivers: ${conditionalDrivers}.` : ''}${context.partialData ? ' Interpretation is based on partial data and should be refined once missing construction fields are completed.' : ''}`;
}

function buildOccupancyEngineeringInterpretation(module: ModuleInstance): string {
  const occupancy = (module.data as any)?.occupancy || module.data || {};
  const hazards = Array.isArray(occupancy.hazards) ? occupancy.hazards : [];
  const hazardSignals = describeOccupancyHazardSignals(hazards, occupancy);
  return `Engineering Interpretation: Current hazard profile indicates ${hazardSignals.ignitionLikelihood}, ${hazardSignals.fireLoadSeverity}, and ${hazardSignals.controlsDependency}. ${hazardSignals.processSpecificNarrative}`;
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

  const modulesToInclude = selectedModules
    ? moduleInstances.filter(m => selectedModules.includes(m.module_key))
    : moduleInstances;

  const modulesByKey = new Map(modulesToInclude.map(m => [m.module_key, m]));
  const riskEngineeringData = modulesByKey.get('RISK_ENGINEERING')?.data || {};
  const breakdown = options.scoreBreakdownOverride || await buildRiskEngineeringScoreBreakdown(document.id, riskEngineeringData);
  const sectionStartPages = new Map<string, number>();

  const { coverPage, docControlPage } = await addIssuedReportPages({
    pdfDoc,
    document: {
      id: document.id,
      title: document.title,
      document_type: 'RE',
      version_number: Number(document.version_number || document.version || 1),
      issue_date: (document.issue_date || document.assessment_date) || new Date().toISOString(),
      issue_status: isIssuedMode ? 'issued' : 'draft',
      assessor_name: document.assessor_name,
      base_document_id: document.base_document_id,
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      branding_logo_path: organisation.branding_logo_path,
    },
    client: {
      name: document.meta?.client?.name || document.responsible_person || '',
      site: document.meta?.site?.name || document.scope_description || '',
    },
    fonts: { bold: fontBold, regular: font },
  });
  totalPages.push(coverPage);

  let { page } = addNewPage(pdfDoc, isDraft, totalPages);
  let yPosition = PAGE_TOP_Y;
  sectionStartPages.set('Disclaimer', totalPages.length);
  ({ page, yPosition } = ensurePageSpace(180, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Disclaimer',
    product: 're',
    fonts: { regular: font, bold: fontBold },
  });
  yPosition = drawParagraph(page, yPosition, RE_SURVEY_DISCLAIMER_TEXT, font);

  ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
  yPosition = PAGE_TOP_Y;
  const contentsPage = page;
  sectionStartPages.set('Contents', totalPages.length);

  page = addNewPage(pdfDoc, isDraft, totalPages).page;
  yPosition = PAGE_TOP_Y;
  sectionStartPages.set('Executive Summary', totalPages.length);

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

  page = addNewPage(pdfDoc, isDraft, totalPages).page;
  yPosition = PAGE_TOP_Y;
  sectionStartPages.set('Risk Scoring Summary', totalPages.length);
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

  totalPages.push(docControlPage);
  sectionStartPages.set('Document Control', totalPages.length);
  page = addNewPage(pdfDoc, isDraft, totalPages).page;
  yPosition = PAGE_TOP_Y;

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
    if (!sectionStartPages.has(sectionTitle)) {
      sectionStartPages.set(sectionTitle, totalPages.length);
    }
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
      yPosition = drawBlockHeading(page, yPosition, 'Section Snapshot', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], tableRows, { regular: font, bold: fontBold }, {
        colWidths: [195, CONTENT_WIDTH - 195],
        fontSize: 9,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_02_CONSTRUCTION') {
      const buildingRows = getConstructionBuildingEvidenceRows(module);
      if (buildingRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + buildingRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Building-level Construction Inputs', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Ref / Name', 'Roof (m²)', 'Upper floors / mezz (m²)', 'Walls combustibility / walls %', 'Storeys', 'Basements', 'Combined cladding', 'Building RE-02 score', 'Combustibility %'], buildingRows, { regular: font, bold: fontBold }, {
          colWidths: [65, 48, 58, 74, 40, 44, 62, 56, 68],
          fontSize: 7.5,
          minRowHeight: 20,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition);
      }
      const siteTotals = getConstructionSiteSummaryRows(module, breakdown);
      ({ page, yPosition } = ensurePageSpace(100, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Site Construction Summary', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Metric', 'Value'], siteTotals, { regular: font, bold: fontBold }, {
        colWidths: [180, CONTENT_WIDTH - 180],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
      const scoringBasis = buildConstructionScoringBasisText(module);
      ({ page, yPosition } = ensurePageSpace(100, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Construction Scoring Basis', fontBold);
      yPosition = drawParagraph(page, yPosition, scoringBasis, font);
      yPosition = sectionBreak(yPosition);
      const engineeringInterpretation = buildConstructionEngineeringInterpretation(module, breakdown);
      ({ page, yPosition } = ensurePageSpace(80, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Engineering Interpretation', fontBold);
      yPosition = drawParagraph(page, yPosition, engineeringInterpretation, font);
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_03_OCCUPANCY') {
      const occupancyRows = getOccupancyStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + occupancyRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Process / Use Overview', fontBold);
      yPosition = drawParagraph(page, yPosition, formatValue((module.data as any)?.occupancy?.process_overview ?? (module.data as any)?.occupancy?.process_description ?? (module.data as any)?.occupancy?.operations_description ?? (module.data as any)?.occupancy?.occupancy_type), font);
      yPosition = drawBlockHeading(page, yPosition, 'Occupancy Structured Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], occupancyRows, { regular: font, bold: fontBold }, {
        colWidths: [170, CONTENT_WIDTH - 170],
        fontSize: 8.75,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
      const occupancyInterpretation = buildOccupancyEngineeringInterpretation(module);
      ({ page, yPosition } = ensurePageSpace(80, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Engineering Interpretation', fontBold);
      yPosition = drawParagraph(page, yPosition, occupancyInterpretation, font);
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_06_FIRE_PROTECTION') {
      const buildingRows = getFireProtectionBuildingRows(module);
      if (buildingRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(110 + buildingRows.length * 22, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Fire Protection Detail Table / Structured Inputs', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Building', 'Active Protection', 'Detection / Scores'], buildingRows, { regular: font, bold: fontBold }, {
          colWidths: [70, 205, CONTENT_WIDTH - 275],
          fontSize: 8,
          minRowHeight: 22,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition);
      }
      const siteRows = getFireProtectionSiteRows(module);
      ({ page, yPosition } = ensurePageSpace(105 + siteRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Fire Protection Site / Reliability Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], siteRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
      const supplementaryRows = getFireProtectionSupplementaryRows(module);
      ({ page, yPosition } = ensurePageSpace(95 + supplementaryRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Supplementary Engineering Assessment (10-question output)', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], supplementaryRows, { regular: font, bold: fontBold }, {
        colWidths: [205, CONTENT_WIDTH - 205],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
      const fireInterpretation = buildFireProtectionEngineeringInterpretation(module);
      ({ page, yPosition } = ensurePageSpace(90, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Engineering Interpretation', fontBold);
      yPosition = drawParagraph(page, yPosition, fireInterpretation, font);
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_07_NATURAL_HAZARDS') {
      const exposuresRows = getExposuresStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + exposuresRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Exposures Structured Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], exposuresRows, { regular: font, bold: fontBold }, {
        colWidths: [190, CONTENT_WIDTH - 190],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_08_UTILITIES') {
      const utilitiesRows = getUtilitiesStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + utilitiesRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Utilities Structured Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], utilitiesRows, { regular: font, bold: fontBold }, {
        colWidths: [180, CONTENT_WIDTH - 180],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_09_MANAGEMENT') {
      const managementRows = getManagementStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + managementRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Management Structured Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], managementRows, { regular: font, bold: fontBold }, {
        colWidths: [180, CONTENT_WIDTH - 180],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_12_LOSS_VALUES') {
      const lossRows = getLossValuesStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + lossRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Loss & Values Structured Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], lossRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    const commentary = getNarrativeCommentaryWithBreakdown(module, breakdown);
    ({ page, yPosition } = ensurePageSpace(120, page, yPosition, pdfDoc, isDraft, totalPages));
    yPosition = drawBlockHeading(page, yPosition, 'Narrative Commentary', fontBold);
    yPosition = drawParagraph(page, yPosition, commentary, font);
    yPosition = sectionBreak(yPosition);

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

  sectionStartPages.set('Conclusion', totalPages.length);
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

  contentsPage.drawText('Contents', {
    x: MARGIN,
    y: PAGE_TOP_Y,
    size: 18,
    font: fontBold,
    color: rgb(0.08, 0.08, 0.08),
  });
  const contentsRows: Array<[string, number | undefined]> = [
    ['Disclaimer', sectionStartPages.get('Disclaimer')],
    ['Executive Summary', sectionStartPages.get('Executive Summary')],
    ['Risk Scoring Summary', sectionStartPages.get('Risk Scoring Summary')],
    ['Document Control', sectionStartPages.get('Document Control')],
    ['Construction', sectionStartPages.get('Construction')],
    ['Occupancy', sectionStartPages.get('Occupancy')],
    ['Fire Protection', sectionStartPages.get('Fire Protection')],
    ['Exposures', sectionStartPages.get('Exposures')],
    ['Utilities & Critical Services', sectionStartPages.get('Utilities & Critical Services')],
    ['Management Systems', sectionStartPages.get('Management Systems')],
    ['Loss & Values', sectionStartPages.get('Loss & Values')],
    ['Conclusion', sectionStartPages.get('Conclusion')],
  ];
  let tocY = PAGE_TOP_Y - 34;
  for (const [label, pageNo] of contentsRows) {
    const safePage = pageNo ?? '-';
    contentsPage.drawText(label, { x: MARGIN, y: tocY, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
    contentsPage.drawText(String(safePage), { x: MARGIN + CONTENT_WIDTH - 20, y: tocY, size: 11, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    tocY -= 18;
  }

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
