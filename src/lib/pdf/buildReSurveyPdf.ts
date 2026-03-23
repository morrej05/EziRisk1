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
import { supabase } from '../supabase';

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

interface ReSurveySitePhoto {
  id?: string;
  storage_path?: string;
  caption?: string;
  description?: string;
  notes?: string;
  uploaded_at?: string;
}

interface ReSurveySitePlan {
  storage_path?: string;
  description?: string;
  uploaded_at?: string;
}

interface Action {
  id: string;
  reference_number?: string | null;
  recommended_action: string;
  priority_band: string;
  status: string;
  completed_at?: string | null;
  is_complete?: boolean | null;
  document_id?: string | null;
  survey_id?: string | null;
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
type FireQuestionGroup = 'adequacy' | 'reliability' | 'localised' | 'evidence';

interface LossValuesSummary {
  buildings: number;
  plantMachinery: number;
  stock: number;
  grossProfitAnnual: number;
  indemnityMonths: number;
  effectivePropertyTotal: number;
}

const SECTION_BLOCK_SPACING = 34;

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

const RE_SURVEY_DISCLAIMER_TEXT = `This Risk Engineering report has been prepared to support the insured’s risk management and loss prevention activities, with the aim of reducing the likelihood and impact of property damage and business interruption.

The content of this report is based on information provided by the insured, observations made during the survey, and professional judgement at the time of assessment. It reflects conditions at the time of inspection only and does not represent a comprehensive audit of all risks present at the site.

No attempt has been made to identify or assess all possible hazards. Risks may exist that are not identified within this report. Any actions or decisions taken by the insured based on this report are the responsibility of the insured.

This report does not constitute certification of compliance with any laws, regulations, codes, or standards. No assessment has been made in respect of statutory compliance unless explicitly stated.

The information contained within this report should not be relied upon by third parties without prior written consent. EziRisk accepts no liability for any loss or damage arising from the use of this report by any party.

All recommendations are provided in good faith based on available information and are intended to support risk improvement, not to guarantee loss prevention.`;

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

function isMissingDataValue(value: unknown): boolean {
  const text = String(value ?? '')
    .replace(/\(data not provided\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return !text || text === 'data not provided' || text === 'not provided' || text === 'not stated' || text === 'unknown' || text === 'n/a';
}

function normaliseFireProtectionValue(parts: unknown[]): string {
  const knownParts: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    const raw = String(part)
      .replace(/\(data not provided\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) continue;
    const splitParts = raw.split(/\s*\/\s*/g).map((entry) => entry.trim()).filter(Boolean);
    for (const splitPart of splitParts) {
      const clean = splitPart.replace(/\(([^)]+)\)\s*$/g, '').trim();
      if (!clean || isMissingDataValue(clean)) continue;
      if (!knownParts.some((entry) => entry.toLowerCase() === clean.toLowerCase())) {
        knownParts.push(clean);
      }
    }
  }
  return knownParts.length ? knownParts.join(' / ') : 'Not provided';
}

function isNotProvidedValue(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text === 'not provided' || text === 'data not provided' || text === 'not stated' || text === 'unknown';
}

function resolveFireProtectionField(...fields: unknown[]): string {
  return normaliseFireProtectionValue(fields);
}

function formatDataPercent(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Data not provided';
  return `${numeric}%`;
}

function formatScore(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return Number.isInteger(numeric) ? `${numeric}` : `${Math.round(numeric * 10) / 10}`;
}

function formatScoreOutOfFive(value: unknown): string {
  const score = formatScore(value);
  return score === 'N/A' ? 'N/A' : `${score}/5`;
}

function formatIdentifierLabel(value: unknown): string {
  if (value === null || value === undefined) return 'Data not provided';
  const text = String(value).trim();
  if (!text) return 'Data not provided';
  if (text.toLowerCase() === 'data not provided' || text.toLowerCase() === 'not stated') return 'Data not provided';
  return text
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pickFirstProvided(...values: unknown[]): unknown {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function getConstructionBuildings(construction: any): any[] {
  const rawBuildings = construction?.buildings;
  if (Array.isArray(rawBuildings)) return rawBuildings;
  if (rawBuildings && typeof rawBuildings === 'object') return Object.values(rawBuildings as Record<string, any>);
  return [];
}

function formatWeightedScore(value: unknown, maxValue: unknown): string {
  return `${formatScore(value)} of ${formatScore(maxValue)}`;
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
  const withTopSpacing = sectionBreak(yPosition, 12);
  return drawParagraph(page, withTopSpacing, title, fontBold);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed !== '' && trimmed.toLowerCase() !== 'data not provided' && trimmed.toLowerCase() !== 'not stated';
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return true;
}

function compactRows(rows: Row[], importantLabels: string[] = []): Row[] {
  const important = new Set(importantLabels.map((v) => v.toLowerCase()));
  return rows.filter((row) => {
    const label = String(row[0] || '').toLowerCase();
    const values = row.slice(1);
    const meaningful = values.some((value) => hasMeaningfulValue(value));
    return meaningful || important.has(label);
  }).map((row) => row.map((cell) => sanitizePdfText(String(cell))) as Row);
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
    wrapHeader?: boolean;
    headerMinRowHeight?: number;
    headerFontSize?: number;
    onPageBreak?: () => { page: PDFPage; yPosition: number };
  } = {}
): { page: PDFPage; yPosition: number } {
  const colWidths = options.colWidths || (headers.length === 2 ? [180, CONTENT_WIDTH - 180] : [170, 115, CONTENT_WIDTH - 285]);
  const fontSize = options.fontSize ?? 8.5;
  const lineHeight = 10;
  const cellPaddingX = 6;
  const cellPaddingY = 4;
  const headerFontSize = options.headerFontSize ?? 8.5;
  const headerMinRowHeight = options.headerMinRowHeight ?? 18;
  const minRowHeight = options.minRowHeight ?? 16;
  const bottomSafeY = MARGIN + 20;
  const tableLeft = MARGIN;
  const tableRight = MARGIN + CONTENT_WIDTH;
  let x = MARGIN;

  const drawHeader = (): number => {
    const wrappedHeaderCells = options.wrapHeader
      ? headers.map((header, i) => wrapText(header, colWidths[i] - cellPaddingX * 2, headerFontSize, fonts.bold))
      : headers.map((header) => [header]);
    const maxHeaderLines = Math.max(1, ...wrappedHeaderCells.map((lines) => lines.length));
    const headerHeight = Math.max(headerMinRowHeight, maxHeaderLines * lineHeight + cellPaddingY * 2);
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
      const lines = wrappedHeaderCells[i];
      const headerTextHeight = lines.length * lineHeight;
      const textY = yPosition - ((headerHeight - headerTextHeight) / 2) - lineHeight + 2;
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + cellPaddingX,
          y: textY - lineIndex * lineHeight,
          size: headerFontSize,
          font: fonts.bold,
          color: rgb(0.08, 0.08, 0.08),
        });
      });
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
    return compactRows([
      ['Buildings assessed', formatValue(buildings.length || '')],
      ['Avg sprinkler required coverage', `${Math.round((required / count) * 10) / 10}%`],
      ['Avg sprinkler installed coverage', `${Math.round((installed / count) * 10) / 10}%`],
      ['Water supply reliability', formatValue(fp.site?.water?.water_reliability)],
      ['Supplementary assessment (questions rated)', `${scoredQuestions.length}`],
      ['Supplementary engineering overall score', formatScoreOutOfFive(supplementary.overall_score)],
      ['Fire protection weighted contribution', pillar ? formatWeightedScore(pillar.score, pillar.maxScore) : 'Not stated'],
      ['Linked recommendations', `${options.linkedRecommendationCount ?? 0}`],
    ]);
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
    const buildings = getConstructionBuildings(construction);
    const firstBuilding = buildings[0] || {};
    const primaryConstructionType =
      construction.primary_construction_type ??
      construction.construction_type ??
      firstBuilding?.primary_construction_type ??
      firstBuilding?.frame_type ??
      firstBuilding?.structure?.frame_type;
    const compartmentationQuality =
      construction.compartmentation_quality ??
      firstBuilding?.compartmentation_quality ??
      firstBuilding?.compartmentation ??
      firstBuilding?.fire_compartmentation ??
      firstBuilding?.compartmentation_minutes;
    return compactRows([
      ['Buildings recorded', formatValue(buildings.length || '')],
      ['Site notes', formatValue(construction.site_notes)],
      ['Primary construction type', formatIdentifierLabel(primaryConstructionType)],
      ['Compartmentation quality', normalizeCompartmentationLabel(compartmentationQuality)],
    ], ['buildings recorded']);
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    const occupancy = (d as any).occupancy || d;
    return compactRows([
      ['Process / use overview', formatValue(occupancy.process_overview ?? occupancy.process_description ?? occupancy.operations_description)],
      ['Industry hazard notes', formatValue(occupancy.industry_special_hazards_notes)],
      ['Generic hazards logged', formatValue(Array.isArray(occupancy.hazards) ? occupancy.hazards.length : '')],
      ['Additional hazards notes', formatValue(occupancy.hazards_free_text)],
    ], ['process / use overview']);
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
    const construction = (module.data as any)?.construction || module.data || {};
    const buildings = getConstructionBuildings(construction);
    const claddingPresentCount = buildings.filter((building: any) => resolveCladdingDescriptor(building).toLowerCase().startsWith('yes')).length;
    const combustibleValue = context.explicitCombustiblePct ?? context.derivedCombustiblePct;
    const fireSpreadRisk = combustibleValue === null ? 'uncertain fire spread potential' : combustibleValue >= 40 ? 'elevated fire spread potential' : combustibleValue >= 20 ? 'moderate fire spread potential' : 'more contained fire spread potential';
    const interruptionSeverity = context.hasMezzanine || context.hasMultipleBuildings || context.totalRoofArea >= 3000
      ? 'material interruption severity'
      : 'moderate interruption severity';
    const scoreText = Number.isFinite(rating as number) ? `${rating}/5` : 'Unavailable';
    const base = `Construction score: ${scoreText} (${scoreBand.label}). The mixed profile means a fire is more likely to spread through combustible envelope/contents even where primary framing is protected steel. With ${context.buildingCount} buildings, roof area ${formatDataValue(context.totalRoofArea)} m² and mezzanine area ${formatDataValue(context.totalMezzArea)} m², a severe event can produce staged shutdown and phased reinstatement rather than a single quick restart. Cladding is identified on ${claddingPresentCount} building(s), supporting ${fireSpreadRisk}. Expected outcome is ${interruptionSeverity}, with longer strip-out, smoke remediation and programme risk than a fully non-combustible site profile.`;
    return notes ? `${base} Additional assessor notes: ${notes}` : base;
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    return notes;
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
  combustibilitySource: 'explicit' | 'none';
  combustibilityText: string;
  partialData: boolean;
} {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = getConstructionBuildings(construction);
  const rating = resolveSectionRating(module, breakdown);
  const totalRoofArea = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.roof?.area_sqm ?? b?.roof_area_m2), 0);
  const totalMezzArea = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.upper_floors_mezzanine?.area_sqm ?? b?.mezzanine_area_m2), 0);
  const explicitCombustible = Number(
    construction?.site_combustible_percent ??
      construction?.calculated?.site_combustible_percent ??
      construction?.site_totals?.site_combustible_percent
  );
  const explicitCombustiblePct = Number.isFinite(explicitCombustible) ? explicitCombustible : null;
  const buildingCombustibleValues = buildings
    .map((building: any) => Number(
      building?.calculated?.combustibility_percent ??
      building?.calculated?.combustible_percent ??
      building?.combustibility_percent ??
      building?.area_weighted_combustible_percent ??
      building?.combustible_percent
    ))
    .filter((value: number) => Number.isFinite(value));
  const derivedCombustiblePct = buildingCombustibleValues.length
    ? Math.round((buildingCombustibleValues.reduce((sum: number, value: number) => sum + value, 0) / buildingCombustibleValues.length) * 10) / 10
    : null;
  const combustibilitySource = explicitCombustiblePct !== null ? 'explicit' : 'none';
  const combustibilityValue = explicitCombustiblePct ?? derivedCombustiblePct;
  const buildingCount = buildings.length;
  const hasMezzanine = buildings.some((building: any) => numericOrZero(building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2) > 0);
  const hasMultipleBuildings = buildingCount > 1;
  const partialData = combustibilitySource === 'none' || buildings.some((building: any) => {
    const hasRoofArea = Number.isFinite(Number(building?.roof?.area_sqm ?? building?.roof_area_m2));
    const hasStoreys = Number.isFinite(Number(
      building?.geometry?.floors ??
      building?.geometry?.storeys ??
      building?.storeys ??
      building?.floors ??
      building?.number_of_storeys ??
      building?.number_of_floors ??
      building?.floors_above_ground ??
      building?.storeys_above_ground
    ));
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

function getConstructionBuildingEvidenceRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = getConstructionBuildings(construction);
  return compactRows(buildings.map((building: any): Row => {
    const refOrName = building.ref || building.building_name || building.name || building.id;
    const roofArea = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzArea = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    const hasRoofArea = Number.isFinite(Number(roofArea));
    const hasMezzArea = Number.isFinite(Number(mezzArea));
    const totalFloorArea = hasRoofArea || hasMezzArea
      ? numericOrZero(roofArea) + numericOrZero(mezzArea)
      : null;
    // Active RE_02 completion snapshot persists these geometry fields directly:
    //   construction.buildings[].storeys
    //   construction.buildings[].basements
    const storeys = building?.storeys;
    const basements = building?.basements;
    return [
      formatDataValue(refOrName),
      formatDataValue(roofArea),
      formatDataValue(mezzArea),
      formatDataValue(totalFloorArea),
      formatDataValue(storeys),
      formatDataValue(basements),
    ];
  }), ['storeys', 'basements', 'total floor area']);
}

function getConstructionGeometryTotalsRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = getConstructionBuildings(construction);
  const totals = buildings.reduce((acc: { roof: number; mezz: number; floor: number; hasRoof: boolean; hasMezz: boolean; hasFloor: boolean }, building: any) => {
    const roofRaw = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzRaw = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    const hasRoof = Number.isFinite(Number(roofRaw));
    const hasMezz = Number.isFinite(Number(mezzRaw));
    const roof = hasRoof ? numericOrZero(roofRaw) : 0;
    const mezz = hasMezz ? numericOrZero(mezzRaw) : 0;
    acc.hasRoof = acc.hasRoof || hasRoof;
    acc.hasMezz = acc.hasMezz || hasMezz;
    acc.hasFloor = acc.hasFloor || hasRoof || hasMezz;
    if (hasRoof) acc.roof += roof;
    if (hasMezz) acc.mezz += mezz;
    if (hasRoof || hasMezz) acc.floor += roof + mezz;
    return acc;
  }, { roof: 0, mezz: 0, floor: 0, hasRoof: false, hasMezz: false, hasFloor: false });

  return [
    ['Total roof area (m²)', formatDataValue(totals.hasRoof ? totals.roof : null)],
    ['Total mezz area (m²)', formatDataValue(totals.hasMezz ? totals.mezz : null)],
    ['Total floor area (m²)', formatDataValue(totals.hasFloor ? totals.floor : null)],
  ];
}

function getConstructionRoofWallEvidenceRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = getConstructionBuildings(construction);
  const buildingRows = buildings.map((building: any): Row => {
    const refOrName = building.ref || building.building_name || building.name || building.id;
    const roofConstructionEvidence = resolveRoofConstructionEvidence(building, construction);
    const wallsConstructionEvidence = resolveWallConstructionEvidence(building, construction);
    const compartmentationEvidence =
      building?.compartmentation_quality ??
      building?.compartmentation ??
      building?.fire_compartmentation ??
      building?.compartmentation_minutes;
    return [
      formatDataValue(refOrName),
      roofConstructionEvidence,
      wallsConstructionEvidence,
      normalizeCompartmentationLabel(compartmentationEvidence),
    ];
  });

  const siteRoofEvidence = sanitizePdfText(formatDataValue(construction?.roof_construction));
  const siteWallEvidence = sanitizePdfText(formatDataValue(construction?.wall_construction));
  const hasSiteRoofEvidence = siteRoofEvidence !== 'Data not provided';
  const hasSiteWallEvidence = siteWallEvidence !== 'Data not provided';
  if (hasSiteRoofEvidence || hasSiteWallEvidence) {
    buildingRows.push(['Site-level evidence', siteRoofEvidence, siteWallEvidence, 'Data not provided']);
  }

  return compactRows(buildingRows, ['roof construction', 'wall construction', 'compartmentation']);
}

function summarizeMaterialBreakdown(breakdown: unknown): string {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return 'Data not provided';
  const entries = breakdown
    .map((item: any) => {
      const material = sanitizePdfText(formatDataValue(item?.material));
      const percent = Number(item?.percent);
      if (!material || material === 'Data not provided') return null;
      return Number.isFinite(percent) ? `${material} (${percent}%)` : material;
    })
    .filter(Boolean);
  return entries.length > 0 ? entries.join('; ') : 'Data not provided';
}

function summarizeMaterialPercentObject(breakdown: unknown): string {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return 'Data not provided';
  const entries = Object.entries(breakdown as Record<string, unknown>)
    .map(([material, percent]) => {
      const cleanMaterial = sanitizePdfText(formatIdentifierLabel(material));
      const numericPercent = Number(percent);
      if (!cleanMaterial || cleanMaterial === 'Data not provided') return null;
      return Number.isFinite(numericPercent) ? `${cleanMaterial} (${numericPercent}%)` : cleanMaterial;
    })
    .filter(Boolean);
  return entries.length > 0 ? entries.join('; ') : 'Data not provided';
}

function normalizeCompartmentationLabel(value: unknown): string {
  if (value === null || value === undefined) return 'Data not provided';
  if (typeof value === 'number' && Number.isFinite(value)) return `${value} min`;
  const normalized = String(value).trim();
  if (!normalized) return 'Data not provided';
  const lower = normalized.toLowerCase();
  if (lower === 'low') return 'Low';
  if (lower === 'medium') return 'Medium';
  if (lower === 'high') return 'High';
  if (lower === 'unknown') return 'Unknown';
  return formatIdentifierLabel(normalized);
}

type SourcedValue = {
  value: string;
  source: string | null;
};

function firstProvidedWithSource(entries: Array<{ source: string; value: unknown }>): SourcedValue {
  for (const entry of entries) {
    const candidate = sanitizePdfText(formatDataValue(entry.value));
    if (candidate === 'Data not provided') continue;
    return { value: candidate, source: entry.source };
  }
  return { value: 'Data not provided', source: null };
}

function resolveRoofConstructionEvidence(building: any, construction: any): string {
  return firstProvidedWithSource([
    { source: 'construction.buildings[].roof.breakdown', value: summarizeMaterialBreakdown(building?.roof?.breakdown) },
    { source: 'construction.buildings[].roof_construction_percent', value: summarizeMaterialPercentObject(building?.roof_construction_percent) },
    { source: 'construction.buildings[].roof.construction_percent', value: summarizeMaterialPercentObject(building?.roof?.construction_percent) },
    { source: 'construction.buildings[].roof_construction_summary', value: building?.roof_construction_summary },
    { source: 'construction.buildings[].roof_construction', value: building?.roof_construction },
    { source: 'construction.buildings[].roof_construction_type', value: building?.roof_construction_type },
    { source: 'construction.buildings[].roof.construction_type', value: building?.roof?.construction_type },
    { source: 'construction.buildings[].roof.type', value: building?.roof?.type },
    { source: 'construction.buildings[].roof.description', value: building?.roof?.description },
    { source: 'construction.roof_construction', value: construction?.roof_construction },
    { source: 'construction.roof_construction_summary', value: construction?.roof_construction_summary },
  ]).value;
}

function resolveWallConstructionEvidence(building: any, construction: any): string {
  return firstProvidedWithSource([
    { source: 'construction.buildings[].walls.breakdown', value: summarizeMaterialBreakdown(building?.walls?.breakdown) },
    { source: 'construction.buildings[].wall_construction_percent', value: summarizeMaterialPercentObject(building?.wall_construction_percent) },
    { source: 'construction.buildings[].walls.construction_percent', value: summarizeMaterialPercentObject(building?.walls?.construction_percent) },
    { source: 'construction.buildings[].wall_construction_summary', value: building?.wall_construction_summary },
    { source: 'construction.buildings[].wall_construction', value: building?.wall_construction },
    { source: 'construction.buildings[].wall_construction_type', value: building?.wall_construction_type },
    { source: 'construction.buildings[].walls.construction_type', value: building?.walls?.construction_type },
    { source: 'construction.buildings[].walls.type', value: building?.walls?.type },
    { source: 'construction.buildings[].walls.description', value: building?.walls?.description },
    { source: 'construction.wall_construction', value: construction?.wall_construction },
    { source: 'construction.wall_construction_summary', value: construction?.wall_construction_summary },
  ]).value;
}

function resolveCladdingDescriptor(building: any): string {
  const claddingPresentRaw = pickFirstProvided(
    building?.combustible_cladding?.present,
    building?.cladding_present,
    building?.has_combustible_cladding,
    building?.cladding_combustible
  );
  const claddingType = building?.combustible_cladding?.details || building?.cladding_system || building?.cladding_type;
  const normalizedString = typeof claddingPresentRaw === 'string' ? claddingPresentRaw.trim().toLowerCase() : null;
  const claddingPresent = claddingPresentRaw === true || normalizedString === 'yes' || normalizedString === 'true';
  const claddingAbsent = claddingPresentRaw === false || normalizedString === 'no' || normalizedString === 'false';

  if (claddingPresent) return `Yes${claddingType ? ` - ${claddingType}` : ''}`;
  if (claddingAbsent) return claddingType ? `No - ${claddingType}` : 'No';
  if (claddingType) return `Data not provided - ${claddingType}`;
  return 'Data not provided';
}

function getConstructionSiteSummaryRows(module: ModuleInstance, breakdown: Breakdown): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const context = getConstructionContext(module, breakdown);
  const pillarScore = breakdown.globalPillars.find((p) => p.key === 'construction_and_combustibility');
  const siteScore = construction?.site_re02_score ?? construction?.calculated?.site_construction_rating ?? construction?.site_totals?.site_re02_score ?? pillarScore?.rating;
  const siteCombustiblePercent = pickFirstProvided(
    construction?.site_combustible_percent,
    construction?.calculated?.site_combustible_percent,
    construction?.site_totals?.site_combustible_percent,
    pillarScore?.metadata?.site_combustible_percent,
    context.explicitCombustiblePct
  );
  const combustibleText = Number.isFinite(Number(siteCombustiblePercent))
    ? `${Number(siteCombustiblePercent)}%`
    : context.combustibilityText !== 'Data not provided'
      ? context.combustibilityText
      : null;
  return compactRows([
    ['Site totals (roof m² / mezz m²)', `${formatDataValue(context.totalRoofArea)} / ${formatDataValue(context.totalMezzArea)}`],
    ['Site construction score', `${formatDataValue(siteScore)}`],
    ['Site combustible %', combustibleText ?? 'Data not provided'],
    ['Site-level construction notes', formatDataValue(construction?.site_notes)],
  ], ['site construction score', 'site combustible %']);
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
      return detail
        ? `- ${formattedLabel}${assessment} — ${String(detail).trim().replace(/\s+/g, ' ')}`
        : `- ${formattedLabel}${assessment}`;
    })
    .filter(Boolean)
    .filter((value: string, index: number, arr: string[]) => arr.indexOf(value) === index);

  const occupancyType = pickFirstProvided(
    occupancy.occupancy_type,
    occupancy.occupancyType,
    (module.data as any)?.occupancy_type,
    (module.data as any)?.occupancyType
  );
  const processOverview =
    occupancy.process_overview ??
    occupancy.process_description ??
    occupancy.operations_description ??
    occupancy.process_use_overview ??
    occupancy.occupancy_products_services ??
    (module.data as any)?.occupancyProductsServices ??
    (module.data as any)?.activityOverview;
  const combustibleLoading =
    occupancy.combustible_loading ??
    occupancy.combustible_loading_profile ??
    occupancy.fire_load_profile;
  return compactRows([
    ['Occupancy type', formatDataValue(occupancyType)],
    ['Process / use overview', formatDataValue(processOverview)],
    ['Shift pattern / operating profile', formatDataValue(occupancy.shift_pattern ?? occupancy.operating_profile ?? occupancy.operating_hours_profile)],
    ['Combustible loading profile', formatDataValue(combustibleLoading)],
    ['Industry-specific special hazards', formatDataValue(occupancy.industry_special_hazards_notes ?? occupancy.special_hazards ?? occupancy.industry_specific_special_hazards)],
    ['Industry fire / explosion features', formatDataValue(occupancy.fire_explosion_features ?? occupancy.industry_fire_explosion_features ?? occupancy.special_fire_explosion_features)],
    ['Selected hazards / descriptors', hazardList.length ? hazardList.map((item) => `- ${item.replace(/^-\s*/, '')}`).join('\n') : 'Data not provided'],
    ['User free-text notes', formatDataValue(occupancy.hazards_free_text ?? occupancy.notes ?? occupancy.user_notes)],
  ], ['occupancy type', 'process / use overview', 'selected hazards / descriptors']);
}

function resolveBuildingDisplayName(buildingId: string, buildingData: any, index: number): string {
  const explicitName =
    buildingData?.building_name ??
    buildingData?.name ??
    buildingData?.ref ??
    buildingData?.description ??
    buildingData?.building_ref;
  if (explicitName !== null && explicitName !== undefined && String(explicitName).trim() !== '') {
    return String(explicitName).trim();
  }
  const idText = String(buildingId || '').trim();
  const looksLikeOpaqueId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(idText);
  if (idText && !looksLikeOpaqueId) return idText;
  return `Building ${index + 1}`;
}

function getFireProtectionCoverageTable(module: ModuleInstance): { headers: string[]; rows: Row[]; colWidths: number[] } {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = fp?.buildings || {};
  const baseHeaders = [
    'Building',
    'Sprinklers present',
    'Installed coverage',
    'Required coverage',
    'System type',
    'Design standard',
    'Density / area',
    'Pressure',
    'No. of heads',
  ];
  const rows = compactRows(Object.entries(buildings).map(([buildingId, buildingData]: [string, any], index: number): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
    return [
      formatDataValue(displayName),
      resolveFireProtectionField(sprinklerData?.sprinklers_installed),
      resolveFireProtectionField(formatDataPercent(sprinklerData?.sprinkler_coverage_installed_pct)),
      resolveFireProtectionField(formatDataPercent(sprinklerData?.sprinkler_coverage_required_pct)),
      resolveFireProtectionField(sprinklerData?.system_type),
      resolveFireProtectionField(sprinklerData?.standard ?? sprinklerData?.sprinkler_standard),
      resolveFireProtectionField(sprinklerData?.density_area),
      resolveFireProtectionField(sprinklerData?.pressure),
      resolveFireProtectionField(sprinklerData?.number_of_heads),
    ];
  }), ['sprinklers present', 'installed coverage', 'required coverage']);

  const retainedIndexes = baseHeaders
    .map((_, index) => index)
    .filter((index) => {
      if (index <= 5) return true;
      return rows.some((row) => !isNotProvidedValue(row[index]));
    });

  const widthMap: Record<string, number> = {
    Building: 72,
    'Sprinklers present': 57,
    'Installed coverage': 58,
    'Required coverage': 58,
    'System type': 66,
    'Design standard': 64,
    'Density / area': 58,
    Pressure: 48,
  };
  const fixedWidth = retainedIndexes.reduce((sum, index) => {
    const header = baseHeaders[index];
    if (header === 'No. of heads') return sum;
    return sum + (widthMap[header] ?? 55);
  }, 0);
  const headers = retainedIndexes.map((index) => baseHeaders[index]);
  const rowsByHeader = rows.map((row) => retainedIndexes.map((index) => row[index]) as Row);
  const colWidths = headers.map((header) => (
    header === 'No. of heads' ? Math.max(46, CONTENT_WIDTH - fixedWidth) : (widthMap[header] ?? 55)
  ));

  return { headers, rows: rowsByHeader, colWidths };
}

function getFireProtectionReliabilityRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = fp?.buildings || {};
  return compactRows(Object.entries(buildings).map(([buildingId, buildingData]: [string, any], index: number): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const detectionTypes = Array.isArray(sprinklerData?.detection_types) ? sprinklerData.detection_types.join(', ') : '';
    const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
    return [
      formatDataValue(displayName),
      resolveFireProtectionField(sprinklerData?.detection_installed),
      resolveFireProtectionField(detectionTypes, sprinklerData?.detection_type_other),
      resolveFireProtectionField(sprinklerData?.alarm_monitoring),
      resolveFireProtectionField(sprinklerData?.detection_testing_regime, sprinklerData?.detection_maintenance_status),
      resolveFireProtectionField(buildingData?.comments, sprinklerData?.detection_comments, sprinklerData?.maintenance_status),
    ];
  }), ['detection installed']);
}

function getFireProtectionLocalisedTable(module: ModuleInstance): { headers: string[]; rows: Row[] } {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = fp?.buildings || {};
  const baseHeaders = ['Building', 'Localised protection required', 'Localised protection present', 'Localised type', 'Protected asset / area', 'Comments'];
  const rows = compactRows(Object.entries(buildings).map(([buildingId, buildingData]: [string, any], index: number): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
    return [
      formatDataValue(displayName),
      resolveFireProtectionField(sprinklerData?.localised_required),
      resolveFireProtectionField(sprinklerData?.localised_present),
      resolveFireProtectionField(sprinklerData?.localised_type),
      resolveFireProtectionField(sprinklerData?.localised_protected_asset),
      resolveFireProtectionField(sprinklerData?.localised_comments, sprinklerData?.justification_if_required_lt_100),
    ];
  }), ['localised protection required', 'localised protection present']);

  const retainedIndexes = baseHeaders
    .map((_, index) => index)
    .filter((index) => {
      if (index <= 2) return true;
      return rows.some((row) => !isNotProvidedValue(row[index]));
    });

  return {
    headers: retainedIndexes.map((index) => baseHeaders[index]),
    rows: rows.map((row) => retainedIndexes.map((index) => row[index]) as Row),
  };
}

function getFireProtectionSiteRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const water = fp?.site?.water || {};
  const buildings = Object.values((fp?.buildings || {}) as Record<string, any>);
  const installed = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.sprinklerData?.sprinkler_coverage_installed_pct), 0);
  const required = buildings.reduce((sum: number, b: any) => sum + numericOrZero(b?.sprinklerData?.sprinkler_coverage_required_pct), 0);
  const count = Math.max(buildings.length, 1);
  const rows: Row[] = [
    ['Water reliability / supply type', resolveFireProtectionField(water?.water_reliability, water?.supply_type, water?.supply_type_other)],
    ['Supports / pumps / arrangement', resolveFireProtectionField(water?.supports, water?.pumps_present, water?.pump_arrangement)],
    ['Power resilience / testing regime', resolveFireProtectionField(water?.power_resilience, water?.testing_regime)],
    ['Hydrant/fire main/hose reels', resolveFireProtectionField(water?.hydrant_coverage, water?.fire_main_condition, water?.hose_reels_present)],
    ['Flow test evidence / date', resolveFireProtectionField(water?.flow_test_evidence, water?.flow_test_date)],
    ['Water weaknesses / site comments', resolveFireProtectionField(water?.key_weaknesses, fp?.site?.comments)],
    ['Site water score (1-5)', resolveFireProtectionField(fp?.site?.water_score_1_5)],
    ['Impairment management notes', resolveFireProtectionField((module.data as any)?.management?.impairment_management, (module.data as any)?.management?.impairment_management_notes)],
    ['Building totals and averages', `${formatDataValue(buildings.length || '')} buildings; avg installed ${Math.round((installed / count) * 10) / 10}% vs avg required ${Math.round((required / count) * 10) / 10}%`],
  ];
  return rows.filter(([label, value]) => {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel === 'site water score (1-5)' || lowerLabel === 'building totals and averages') return true;
    return !isNotProvidedValue(value);
  });
}

function getFireProtectionSupplementaryRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const supplementary = fp?.supplementary_assessment || {};
  const questions = Array.isArray(supplementary?.questions) ? supplementary.questions : [];
  const scored = questions.filter((q: any) => Number.isFinite(Number(q?.score_1_5)));
  const notesPresent = scored.filter((q: any) => String(q?.notes || '').trim().length > 0).length;
  const adequacyScored = getFireProtectionQuestionsByGroup(module, 'adequacy').filter((q: any) => Number.isFinite(Number(q?.score_1_5))).length;
  const reliabilityScored = getFireProtectionQuestionsByGroup(module, 'reliability').filter((q: any) => Number.isFinite(Number(q?.score_1_5))).length;
  const headlineRows: Row[] = [
    ['Questions scored', `${scored.length} of ${questions.length || 0}`],
    ['Adequacy questions scored (Q1–Q4)', `${adequacyScored}`],
    ['Reliability questions scored (Q5–Q7)', `${reliabilityScored}`],
    ['Adequacy / reliability subscore', `${formatDataValue(supplementary?.adequacy_subscore)} / ${formatDataValue(supplementary?.reliability_subscore)}`],
    ['Localised / evidence subscore', `${formatDataValue(supplementary?.localised_subscore)} / ${formatDataValue(supplementary?.evidence_subscore)}`],
    ['Overall supplementary score', formatDataValue(supplementary?.overall_score)],
    ['Question notes captured', formatDataValue(notesPresent || '')],
  ];
  return compactRows(headlineRows, ['questions scored', 'overall supplementary score']);
}

function cleanFireProtectionRows(rows: Row[]): Row[] {
  return rows
    .map((row) => row.map((cell, index) => (
      index === 0 ? cell : resolveFireProtectionField(cell)
    )) as Row)
    .filter((row) => row.slice(1).some((cell) => !isNotProvidedValue(cell)));
}

function getCoverageInterpretation(module: ModuleInstance): string {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = Object.values((fp?.buildings || {}) as Record<string, any>);
  if (buildings.length === 0) return '';
  const mismatchedCoverage = buildings.some((building: any) => {
    const installed = Number(building?.sprinklerData?.sprinkler_coverage_installed_pct);
    const required = Number(building?.sprinklerData?.sprinkler_coverage_required_pct);
    return Number.isFinite(installed) && Number.isFinite(required) && Math.abs(installed - required) > 0.01;
  });
  return mismatchedCoverage
    ? 'Overall installed sprinkler coverage exceeds required levels; however, coverage is not consistent across all buildings.'
    : 'Installed sprinkler coverage is broadly aligned with stated required levels across recorded buildings.';
}

function hasWaterSupplyDataUncertainty(module: ModuleInstance): boolean {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const water = fp?.site?.water || {};
  const keyFields = [
    water?.water_reliability,
    water?.supply_type,
    water?.flow_test_evidence,
    water?.flow_test_date,
    water?.pumps_present,
    water?.testing_regime,
  ];
  const availableCount = keyFields.filter((value) => !isMissingDataValue(value)).length;
  return availableCount < 3;
}

function getFireProtectionKeyFindings(module: ModuleInstance): string[] {
  const findings: string[] = [];
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildingsById = fp?.buildings || {};
  const buildings = Object.entries(buildingsById) as Array<[string, any]>;
  const supplementaryQuestions = Array.isArray(fp?.supplementary_assessment?.questions)
    ? fp.supplementary_assessment.questions
    : [];

  const lowScoringQuestions = supplementaryQuestions
    .map((question: any, index: number) => ({
      score: Number(question?.score_1_5),
      label: sanitizePdfText(formatDataValue(question?.prompt ?? question?.factor_key ?? `Question ${index + 1}`)).replace(/^Q\d+\s*[-:]\s*/i, ''),
      note: String(question?.notes ?? question?.comment ?? '').trim(),
    }))
    .filter((entry: any) => Number.isFinite(entry.score))
    .sort((a: any, b: any) => a.score - b.score)
    .slice(0, 2);
  for (const entry of lowScoringQuestions) {
    if (entry.score <= 2) {
      findings.push(`${entry.label} is a current weakness (score ${formatScore(entry.score)}/5)${entry.note ? `: ${sanitizePdfText(entry.note)}` : ''}.`);
    }
  }

  const coverageGaps = buildings
    .map(([buildingId, buildingData], index) => {
      const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
      const required = Number(buildingData?.sprinklerData?.sprinkler_coverage_required_pct);
      const installed = Number(buildingData?.sprinklerData?.sprinkler_coverage_installed_pct);
      if (Number.isFinite(required) && Number.isFinite(installed) && installed + 0.01 < required) {
        return `${displayName} (${Math.round(installed)}% installed vs ${Math.round(required)}% required)`;
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 2);
  if (coverageGaps.length > 0) {
    findings.push(`Coverage shortfalls are recorded in ${coverageGaps.join(' and ')}.`);
  }

  if (hasWaterSupplyDataUncertainty(module)) {
    findings.push('Water supply reliability cannot be confirmed from available records, creating uncertainty in expected suppression performance.');
  }

  const inconsistentDetection = buildings
    .map(([buildingId, buildingData], index) => {
      const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
      const detectionInstalled = String(buildingData?.sprinklerData?.detection_installed || '').trim();
      return detectionInstalled ? `${displayName}: ${detectionInstalled}` : null;
    })
    .filter(Boolean);
  const uniqueDetectionStates = new Set(inconsistentDetection.map((entry) => entry?.split(':')[1]?.trim().toLowerCase()));
  if (uniqueDetectionStates.size > 1) {
    findings.push('Detection and monitoring controls are inconsistent between buildings, indicating uneven reliability performance across the site.');
  }

  const localisedMissing = buildings
    .map(([buildingId, buildingData], index) => {
      const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
      if (String(buildingData?.sprinklerData?.localised_required || '').toLowerCase() === 'yes'
        && String(buildingData?.sprinklerData?.localised_present || '').toLowerCase() === 'no') {
        return displayName;
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 2);
  if (localisedMissing.length > 0) {
    findings.push(`Localised/special protection is missing where required in ${localisedMissing.join(' and ')}.`);
  }

  if (findings.length < 3) {
    const scoredCount = supplementaryQuestions.filter((question: any) => Number.isFinite(Number(question?.score_1_5))).length;
    findings.push(`${scoredCount} of ${supplementaryQuestions.length || 0} supplementary fire protection questions are currently scored.`);
  }
  if (findings.length < 3) {
    const requiredCount = buildings.filter(([, buildingData]) => Number(buildingData?.sprinklerData?.sprinkler_coverage_required_pct) > 0).length;
    const installedCount = buildings.filter(([, buildingData]) => Number(buildingData?.sprinklerData?.sprinkler_coverage_installed_pct) > 0).length;
    findings.push(`Sprinkler coverage is recorded as installed in ${installedCount} building(s) against stated requirement in ${requiredCount} building(s).`);
  }

  return findings.slice(0, 5);
}

function getFireProtectionQuestionsByGroup(module: ModuleInstance, group: FireQuestionGroup): any[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const questions = Array.isArray(fp?.supplementary_assessment?.questions) ? fp.supplementary_assessment.questions : [];
  return questions.filter((question: any, index: number) => {
    const questionGroup = String(question?.group || '').trim().toLowerCase();
    if (questionGroup) return questionGroup === group;
    if (group === 'adequacy') return index <= 3;
    if (group === 'reliability') return index >= 4 && index <= 6;
    return false;
  });
}

function getFireProtectionPillarNarrative(module: ModuleInstance, group: 'adequacy' | 'reliability'): string {
  const questions = getFireProtectionQuestionsByGroup(module, group);
  if (!questions.length) return '';
  const scored = questions
    .map((question) => ({ score: Number(question?.score_1_5), question }))
    .filter((entry) => Number.isFinite(entry.score));
  if (!scored.length) return '';

  const majorityAdequate = scored.filter((entry) => entry.score >= 3).length >= Math.ceil(scored.length / 2);
  const strongItems = scored
    .filter((entry) => entry.score >= 4)
    .slice(0, 2)
    .map((entry) => sanitizePdfText(formatDataValue(entry.question?.prompt ?? entry.question?.factor_key)).replace(/^Q\d+\s*[-:]\s*/i, ''));
  const lowItems = scored
    .filter((entry) => entry.score <= 2)
    .slice(0, 2)
    .map((entry) => ({
      label: sanitizePdfText(formatDataValue(entry.question?.prompt ?? entry.question?.factor_key)).replace(/^Q\d+\s*[-:]\s*/i, ''),
      note: String(entry.question?.notes ?? entry.question?.comment ?? '').trim(),
    }));

  const overall = majorityAdequate
    ? `${group === 'adequacy' ? 'Overall adequacy is broadly adequate' : 'Overall reliability is broadly adequate'} based on the current Q${group === 'adequacy' ? '1–Q4' : '5–Q7'} scoring profile.`
    : `${group === 'adequacy' ? 'Adequacy is constrained by low-scoring controls' : 'Reliability is constrained by low-scoring controls'} in the current dataset.`;
  const strengths = strongItems.length > 0
    ? `Strengths are most evident in ${strongItems.join(' and ')}.`
    : '';
  const weaknesses = lowItems.length > 0
    ? `Weaknesses are recorded in ${lowItems.map((item) => item.label).join(' and ')}${lowItems.some((item) => item.note) ? ` (${sanitizePdfText(lowItems.map((item) => item.note).filter(Boolean).join('; '))})` : ''}.`
    : '';
  const uncertainty = group === 'reliability' && hasWaterSupplyDataUncertainty(module)
    ? 'Water supply reliability cannot be confirmed due to limited available information.'
    : '';

  return [overall, strengths, weaknesses, uncertainty].filter(Boolean).join(' ');
}

interface OccupancyScoredFactor {
  key: string;
  label: string;
  rating: number;
  explanation: string;
  weight: number;
}

function extractOccupancyFactorExplanations(module: ModuleInstance): Map<string, string> {
  const occupancy = ((module.data as any)?.occupancy || module.data || {}) as any;
  const sources = [
    ...(Array.isArray(occupancy?.questions) ? occupancy.questions : []),
    ...(Array.isArray(occupancy?.factors) ? occupancy.factors : []),
    ...(Array.isArray(occupancy?.ratings_breakdown) ? occupancy.ratings_breakdown : []),
    ...(Array.isArray((module.data as any)?.questions) ? (module.data as any).questions : []),
    ...(Array.isArray((module.data as any)?.factors) ? (module.data as any).factors : []),
  ];
  const explanations = new Map<string, string>();
  for (const item of sources) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.factor_key ?? item.canonical_key ?? item.key ?? item.id ?? '').trim().toLowerCase();
    if (!key) continue;
    const explanation = String(
      item.notes ??
      item.explanation ??
      item.descriptor ??
      item.description ??
      item.detail ??
      ''
    ).trim();
    if (!explanation || explanations.has(key)) continue;
    explanations.set(key, explanation.replace(/\s+/g, ' '));
  }
  return explanations;
}

function getOccupancyScoredFactors(module: ModuleInstance, breakdown: Breakdown): OccupancyScoredFactor[] {
  const explanations = extractOccupancyFactorExplanations(module);
  return breakdown.occupancyDrivers
    .filter((factor) => Number.isFinite(Number(factor.rating)))
    .map((factor) => {
      const key = String(factor.key || '').trim();
      const explanation = explanations.get(key.toLowerCase()) || '';
      return {
        key,
        label: formatIdentifierLabel(factor.label || key),
        rating: Number(factor.rating),
        explanation,
        weight: Number(factor.weight) || 0,
      };
    });
}

function buildOccupancyEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown): string {
  const occupancy = (module.data as any)?.occupancy || module.data || {};
  const hazards = Array.isArray(occupancy?.hazards) ? occupancy.hazards : [];
  const scoredFactors = getOccupancyScoredFactors(module, breakdown);
  if (scoredFactors.length === 0) return '';

  const occupancyType = pickFirstProvided(
    occupancy?.occupancy_type,
    occupancy?.occupancyType,
    (module.data as any)?.occupancy_type,
    (module.data as any)?.occupancyType
  );
  const processOverview = pickFirstProvided(
    occupancy?.process_overview,
    occupancy?.process_description,
    occupancy?.operations_description,
    occupancy?.process_use_overview,
    occupancy?.occupancy_products_services,
    (module.data as any)?.occupancyProductsServices,
    (module.data as any)?.activityOverview
  );
  const hazardLabels = hazards
    .map((hazard: any) => String(hazard?.hazard_label || hazard?.hazard_key || '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  const contextParts = [formatDataValue(occupancyType), formatDataValue(processOverview), hazardLabels || null]
    .filter((part) => part && part !== 'Data not provided');
  const opening = contextParts.length
    ? `Occupancy context: ${contextParts.join(' | ')}.`
    : 'Occupancy context: Data not provided.';

  const ranked = [...scoredFactors].sort((a, b) => a.rating - b.rating || b.weight - a.weight || a.label.localeCompare(b.label));
  const weak = ranked.filter((factor) => factor.rating <= 2);
  const moderate = ranked.filter((factor) => factor.rating > 2 && factor.rating < 4);
  const strong = ranked.filter((factor) => factor.rating >= 4);

  const weakFocus = (weak.length ? weak : moderate).slice(0, 3);
  const weakSummary = weakFocus
    .map((factor) => `${factor.label} (${formatScoreOutOfFive(factor.rating)})${factor.explanation ? `: ${factor.explanation}` : ''}`)
    .join('; ');
  const weaknessNarrative = weakSummary
    ? `Most material occupancy weaknesses are ${weakSummary}.`
    : '';

  const strongFocus = strong.slice(0, 2);
  const resilienceNarrative = strongFocus.length
    ? `Relative resilience is supported by ${strongFocus.map((factor) => `${factor.label} (${formatScoreOutOfFive(factor.rating)})`).join(' and ')}.`
    : '';

  const overallRating = resolveSectionRating(module, breakdown);
  const implication = getScoreBand(overallRating).occupancyImplication;
  const closing = `Overall occupancy score is ${formatScoreOutOfFive(overallRating)}. ${implication} This profile should be read as a direct indicator of ignition potential, fire/explosion escalation risk, and interruption sensitivity.`;

  return [opening, weaknessNarrative, resilienceNarrative, closing].filter(Boolean).join('\n\n');
}

function buildSectionInterpretation(module: ModuleInstance, breakdown: Breakdown): string {
  if (module.module_key === 'RE_02_CONSTRUCTION') return buildConstructionEngineeringInterpretation(module, breakdown);
  if (module.module_key === 'RE_03_OCCUPANCY') return buildOccupancyEngineeringInterpretation(module, breakdown);
  if (module.module_key === 'RE_06_FIRE_PROTECTION') return buildFireProtectionEngineeringInterpretation(module);

  const rating = resolveSectionRating(module, breakdown);
  if (!Number.isFinite(Number(rating))) {
    return 'Engineering interpretation is constrained because section rating data is not provided. Conclusions are therefore provisional and should be treated as data-limited.';
  }
  return `Engineering interpretation is aligned to submitted section inputs and current score (${Number(rating)}/5). No additional inferred values are applied.`;
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
  ];
}

function getLossExpectancyRows(module: ModuleInstance, event: 'wle' | 'nle'): Row[] {
  const d = module.data || {};
  const expectancy = (d as any)?.[event] || {};
  const bi = expectancy?.business_interruption || {};
  const estimate = expectancy?.estimated_total ?? expectancy?.estimated_total_loss;
  const commentary = expectancy?.commentary ?? expectancy?.notes ?? expectancy?.scenario_commentary;
  const estimateAndCommentary = estimate || commentary
    ? `${formatDataValue(estimate)} | ${formatDataValue(commentary)}`
    : 'Data not provided';

  return [
    ['Scenario title', formatDataValue(expectancy?.scenario_summary ?? expectancy?.scenario_description ?? expectancy?.title)],
    ['Building damage %', formatDataPercent(expectancy?.property_damage?.buildings_improvements_pct)],
    ['Plant & machinery damage %', formatDataPercent(expectancy?.property_damage?.plant_machinery_contents_pct)],
    ['Stock damage %', formatDataPercent(expectancy?.property_damage?.stock_wip_pct)],
    ['BI interruption basis', formatDataValue(bi?.interruption_basis ?? bi?.basis ?? bi?.gross_profit_basis)],
    ['BI interruption duration', formatDataValue(bi?.outage_duration_months !== undefined ? `${bi?.outage_duration_months} months` : undefined)],
    ['BI severity input', formatDataPercent(bi?.gross_profit_pct ?? bi?.severity_pct)],
    ['Estimate / commentary', estimateAndCommentary],
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

function buildConstructionEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown): string {
  const construction = (module.data as any)?.construction || module.data || {};
  const context = getConstructionContext(module, breakdown);
  const scoreBand = getScoreBand(context.rating);
  const pillarScore = breakdown.globalPillars.find((p) => p.key === 'construction_and_combustibility');
  const siteScore = construction?.site_re02_score ?? construction?.calculated?.site_construction_rating ?? construction?.site_totals?.site_re02_score ?? pillarScore?.rating;
  const scoreText = formatScoreOutOfFive(siteScore);
  const combustibleValue = pickFirstProvided(
    construction?.site_combustible_percent,
    construction?.calculated?.site_combustible_percent,
    construction?.site_totals?.site_combustible_percent,
    pillarScore?.metadata?.site_combustible_percent,
    context.explicitCombustiblePct
  );
  const combustibleText = Number.isFinite(Number(combustibleValue))
    ? `${Number(combustibleValue)}%`
    : context.combustibilityText;
  const buildings = context.buildings;
  const claddingPresentCount = buildings.filter((building: any) => resolveCladdingDescriptor(building).toLowerCase().startsWith('yes')).length;
  const claddingText = claddingPresentCount > 0
    ? `Combustible cladding is identified on ${claddingPresentCount} of ${context.buildingCount} building(s).`
    : context.buildingCount > 0
      ? 'No combustible cladding is identified in submitted building records.'
      : 'Building-level cladding records are not available.';
  const geometryText = `Recorded geometry totals are roof ${formatDataValue(context.totalRoofArea)} m² and mezz ${formatDataValue(context.totalMezzArea)} m² across ${context.buildingCount} building(s).`;
  return `Engineering Interpretation: Site construction score is ${scoreText} (${scoreBand.label}) with site combustible proportion ${combustibleText}. ${geometryText} ${claddingText}`;
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
    const context = getConstructionContext(module, breakdown);
    const level = levelFromRating(rating);
    const narrative = `Construction resilience is assessed at ${rating ?? 'N/A'}/5 with site combustible proportion ${context.combustibilityText}. This influences fire spread potential, structural vulnerability, reinstatement complexity and the likely scale of property interruption following a major event.`;
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

function isSupportedImagePath(path: string): boolean {
  return /\.(png|jpg|jpeg)$/i.test(path);
}

async function fetchEvidenceImageBytes(storagePath: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await supabase.storage
      .from('evidence')
      .createSignedUrl(storagePath, 300);
    if (error || !data?.signedUrl) {
      console.warn('[PDF RE Survey] Failed to sign evidence asset:', storagePath, error);
      return null;
    }
    const response = await fetch(data.signedUrl);
    if (!response.ok) {
      console.warn('[PDF RE Survey] Failed to fetch evidence asset:', storagePath, response.status);
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.warn('[PDF RE Survey] Error loading evidence asset:', storagePath, error);
    return null;
  }
}

async function embedEvidenceImage(pdfDoc: PDFDocument, storagePath: string) {
  const bytes = await fetchEvidenceImageBytes(storagePath);
  if (!bytes) return null;
  if (/\.png$/i.test(storagePath)) {
    return pdfDoc.embedPng(bytes);
  }
  return pdfDoc.embedJpg(bytes);
}

function isCompletedRecommendationStatus(action: Pick<Action, 'status' | 'completed_at' | 'is_complete'>): boolean {
  const normalized = String(action.status || '').trim().toLowerCase();
  if (normalized === 'closed' || normalized === 'completed' || normalized === 'complete' || normalized === 'resolved') {
    return true;
  }
  if (action.is_complete) return true;
  return !!action.completed_at;
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

  const moduleInstanceIdSet = new Set(moduleInstances.map((module) => module.id));
  const currentSurveyRecommendations = actions.filter((action) => {
    const actionSurveyId = action.document_id || action.survey_id;
    if (actionSurveyId) {
      return actionSurveyId === document.id;
    }
    return moduleInstanceIdSet.has(action.module_instance_id);
  });
  const modulesByKey = new Map(modulesToInclude.map(m => [m.module_key, m]));
  const re10SitePhotosModule = modulesByKey.get('RE_10_SITE_PHOTOS');
  const re10Data = (re10SitePhotosModule?.data || {}) as Record<string, unknown>;
  const sitePhotos = Array.isArray(re10Data.photos)
    ? (re10Data.photos as ReSurveySitePhoto[]).filter((photo) => !!photo?.storage_path && isSupportedImagePath(String(photo.storage_path)))
    : [];
  const sitePlan = ((re10Data.site_plan || null) as ReSurveySitePlan | null);
  const sitePlanPath = sitePlan?.storage_path && isSupportedImagePath(sitePlan.storage_path) ? sitePlan.storage_path : null;
  const re01DocControl =
    moduleInstances.find((module) => module.module_key === 'RE_01_DOC_CONTROL') ||
    moduleInstances.find((module) => module.module_key === 'RE_01_DOCUMENT_CONTROL');
  const siteContact = Array.isArray((re01DocControl?.data as any)?.site_contacts)
    ? (re01DocControl?.data as any).site_contacts
      .map((contact: any) => String(contact?.name || '').trim())
      .filter(Boolean)
      .join(', ')
    : '';
  const personsPresent = Array.isArray((re01DocControl?.data as any)?.present_during_survey)
    ? (re01DocControl?.data as any).present_during_survey
      .map((attendee: any) => String(attendee?.name || '').trim())
      .filter(Boolean)
      .join(', ')
    : '';
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
    compactRows([
      ['Report', formatValue(document.title || 'Risk Engineering Survey')],
      ['Organisation', formatValue(organisation.name)],
      ['Client', formatValue(document.meta?.client?.name || document.responsible_person)],
      ['Site', formatValue(document.meta?.site?.name || document.scope_description)],
      ['Site contact', formatValue(siteContact)],
      ['Persons present', formatValue(personsPresent)],
      ['Assessment date', formatValue(formatDate(document.assessment_date || null))],
      ['Version / status', `v${Number(document.version_number || document.version || 1)} - ${isIssuedMode ? 'Issued' : 'Draft'}`],
    ], ['site contact', 'persons present']),
    { regular: font, bold: fontBold },
    {
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  yPosition -= 34;

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
    `This report summarises risk engineering findings for ${document.meta?.site?.name || document.scope_description || 'the assessed site'} in ${breakdown.industryLabel} context. Weighted total score is ${formatScore(breakdown.totalScore)} of ${formatScore(breakdown.maxScore)} (${performanceRatio.toFixed(0)}%) with an overall ${overallRating} rating.`,
    font
  );

  ({ page, yPosition } = drawSimpleTable(
    page,
    yPosition,
    ['Executive indicator', 'Assessment'],
    [
      ['Overall score', `${formatScore(breakdown.totalScore)} / ${formatScore(breakdown.maxScore)} (${performanceRatio.toFixed(0)}%)`],
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
      ['Total weighted score', `${formatScore(breakdown.totalScore)} / ${formatScore(breakdown.maxScore)}`],
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
    breakdown.globalPillars.map(p => [p.label, formatScoreOutOfFive(p.rating), formatWeightedScore(p.score, p.maxScore)]),
    { regular: font, bold: fontBold },
    {
      fontSize: 8.25,
      onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
    }
  ));

  yPosition = sectionBreak(yPosition, 20);
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
    ...breakdown.occupancyDrivers.slice(0, 5).map((d): Row => [d.label, formatScoreOutOfFive(d.rating), formatWeightedScore(d.score, d.maxScore)]),
    ...breakdown.topContributors.map((c): Row => [`Top contributor: ${c.label}`, formatScoreOutOfFive(c.rating), formatWeightedScore(c.score, c.maxScore)]),
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
    yPosition = sectionBreak(yPosition, 18);

    // NOTE (report separation readiness):
    // Survey report currently consumes recommendation metadata via action rows (module_instance_id linkage).
    // This is the integration point to keep for future extraction into a dedicated LP/recommendations PDF builder.
    const linkedRecommendationCount = actions.filter((action) => action.module_instance_id === module.id).length;
    const tableRows = getSectionTableRows(module, { breakdown, linkedRecommendationCount });
    if (tableRows.length > 0) {
      ({ page, yPosition } = ensurePageSpace(100 + tableRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Section Snapshot', fontBold);
      yPosition = sectionBreak(yPosition, 8);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], tableRows, { regular: font, bold: fontBold }, {
        colWidths: [195, CONTENT_WIDTH - 195],
        fontSize: 9,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition, 42);
    }

    if (module.module_key === 'RE_02_CONSTRUCTION') {
      const geometryRows = getConstructionBuildingEvidenceRows(module);
      if (geometryRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(180 + geometryRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Inputs — Geometry', fontBold);
        yPosition = sectionBreak(yPosition, 8);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Building', 'Roof', 'Mezz', 'Total floor area', 'Storeys', 'Basements'], geometryRows, { regular: font, bold: fontBold }, {
          colWidths: [97, 66, 86, 86, 60, 60],
          fontSize: 8.5,
          minRowHeight: 18,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        const geometryTotals = getConstructionGeometryTotalsRows(module);
        yPosition = sectionBreak(yPosition, 8);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Total', 'Value'], geometryTotals, { regular: font, bold: fontBold }, {
          colWidths: [180, CONTENT_WIDTH - 180],
          fontSize: 8.5,
          minRowHeight: 18,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition, 20);
      }
      const roofWallEvidenceRows = getConstructionRoofWallEvidenceRows(module);
      if (roofWallEvidenceRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + roofWallEvidenceRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Building construction evidence', fontBold);
        yPosition = sectionBreak(yPosition, 8);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Building', 'Roof construction', 'Wall construction', 'Compartmentation'], roofWallEvidenceRows, { regular: font, bold: fontBold }, {
          colWidths: [82, 150, 150, CONTENT_WIDTH - 382],
          fontSize: 8.25,
          minRowHeight: 18,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition, 26);
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
      yPosition = sectionBreak(yPosition, 14);
      yPosition = drawParagraph(
        page,
        yPosition,
        'Site combustible % is an area-weighted site-wide indicator and is not a direct repeat of the per-building roof/wall composition descriptors.',
        font
      );
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_03_OCCUPANCY') {
      const occupancyRows = getOccupancyStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + occupancyRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Inputs — Process / use overview', fontBold);
      yPosition = drawParagraph(page, yPosition, formatDataValue((module.data as any)?.occupancy?.process_overview ?? (module.data as any)?.occupancy?.process_description ?? (module.data as any)?.occupancy?.operations_description ?? (module.data as any)?.occupancy?.process_use_overview ?? (module.data as any)?.occupancy?.occupancy_type ?? (module.data as any)?.occupancyProductsServices ?? (module.data as any)?.activityOverview), font);
      yPosition = sectionBreak(yPosition, 12);
      yPosition = drawBlockHeading(page, yPosition, 'Inputs — Occupancy structured fields', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], occupancyRows, { regular: font, bold: fontBold }, {
        colWidths: [170, CONTENT_WIDTH - 170],
        fontSize: 8.75,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_06_FIRE_PROTECTION') {
      const coverageTable = getFireProtectionCoverageTable(module);
      const coverageRows = cleanFireProtectionRows(coverageTable.rows);
      if (coverageRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + coverageRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Fire Protection — Coverage', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, coverageTable.headers, coverageRows, { regular: font, bold: fontBold }, {
          colWidths: coverageTable.colWidths,
          fontSize: 7.5,
          minRowHeight: 18,
          wrapHeader: true,
          headerMinRowHeight: 22,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        const coverageInterpretation = getCoverageInterpretation(module);
        if (coverageInterpretation) {
          yPosition = sectionBreak(yPosition, 8);
          yPosition = drawParagraph(page, yPosition, coverageInterpretation, font);
        }
        yPosition = sectionBreak(yPosition);
      }
      const reliabilityRows = cleanFireProtectionRows(getFireProtectionReliabilityRows(module));
      if (reliabilityRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + reliabilityRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Fire Protection — Reliability and Detection', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Building', 'Detection installed', 'Detection type', 'Monitoring', 'Maintenance / testing', 'Reliability notes'], reliabilityRows, { regular: font, bold: fontBold }, {
          colWidths: [85, 76, 84, 72, 95, CONTENT_WIDTH - 412],
          fontSize: 7.25,
          minRowHeight: 18,
          wrapHeader: true,
          headerMinRowHeight: 22,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition);
      }
      const localisedTable = getFireProtectionLocalisedTable(module);
      const cleanedLocalisedRows = cleanFireProtectionRows(localisedTable.rows);
      if (cleanedLocalisedRows.length > 0) {
        const localisedColWidthsByHeader: Record<string, number> = {
          Building: 80,
          'Localised protection required': 92,
          'Localised protection present': 92,
          'Localised type': 72,
          'Protected asset / area': 90,
        };
        const localisedFixedWidth = localisedTable.headers
          .filter((header) => header !== 'Comments')
          .reduce((sum, header) => sum + (localisedColWidthsByHeader[header] ?? 0), 0);
        const localisedColWidths = localisedTable.headers.map((header) => (
          header === 'Comments' ? Math.max(70, CONTENT_WIDTH - localisedFixedWidth) : (localisedColWidthsByHeader[header] ?? 80)
        ));
        ({ page, yPosition } = ensurePageSpace(100 + cleanedLocalisedRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Fire Protection — Localised / Special Protection', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, localisedTable.headers, cleanedLocalisedRows, { regular: font, bold: fontBold }, {
          colWidths: localisedColWidths,
          fontSize: 7,
          minRowHeight: 18,
          wrapHeader: true,
          headerMinRowHeight: 24,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition);
      }
      const siteRows = cleanFireProtectionRows(getFireProtectionSiteRows(module));
      ({ page, yPosition } = ensurePageSpace(105 + siteRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Site / Water Supply / Reliability Inputs', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], siteRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      if (hasWaterSupplyDataUncertainty(module)) {
        yPosition = sectionBreak(yPosition, 8);
        yPosition = drawParagraph(
          page,
          yPosition,
          'Water supply reliability cannot be confirmed due to limited available information. This represents a key uncertainty in system performance.',
          font
        );
      }
      yPosition = sectionBreak(yPosition);
      const keyFindings = getFireProtectionKeyFindings(module);
      if (keyFindings.length > 0) {
        yPosition = sectionBreak(yPosition, 10);
        yPosition = drawBlockHeading(page, yPosition, 'Key Findings', fontBold);
        yPosition = sectionBreak(yPosition, 6);
        for (const finding of keyFindings) {
          const lines = wrapText(`• ${sanitizePdfText(finding)}`, CONTENT_WIDTH - 4, 9, font);
          for (const line of lines) {
            ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
            page.drawText(line, {
              x: MARGIN + 2,
              y: yPosition,
              size: 9,
              font,
              color: rgb(0.14, 0.14, 0.14),
            });
            yPosition -= 11;
          }
          yPosition -= 2;
        }
      }
      const adequacyNarrative = getFireProtectionPillarNarrative(module, 'adequacy');
      if (adequacyNarrative) {
        yPosition = sectionBreak(yPosition, 10);
        yPosition = drawParagraph(page, yPosition, `Adequacy (Q1–Q4): ${adequacyNarrative}`, font);
      }
      const reliabilityNarrative = getFireProtectionPillarNarrative(module, 'reliability');
      if (reliabilityNarrative) {
        yPosition = sectionBreak(yPosition, 8);
        yPosition = drawParagraph(page, yPosition, `Reliability (Q5–Q7): ${reliabilityNarrative}`, font);
      }
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_07_NATURAL_HAZARDS') {
      const exposuresRows = getExposuresStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + exposuresRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Inputs — Exposures structured fields', fontBold);
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
      yPosition = drawBlockHeading(page, yPosition, 'Inputs — Utilities structured fields', fontBold);
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
      yPosition = drawBlockHeading(page, yPosition, 'Inputs — Management structured fields', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], managementRows, { regular: font, bold: fontBold }, {
        colWidths: [180, CONTENT_WIDTH - 180],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key === 'RE_12_LOSS_VALUES') {
      const declaredValueRows = getLossValuesStructuredRows(module);
      ({ page, yPosition } = ensurePageSpace(100 + declaredValueRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'Declared Values Summary', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], declaredValueRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);

      const wleRows = getLossExpectancyRows(module, 'wle');
      ({ page, yPosition } = ensurePageSpace(100 + wleRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'WLE (Worse Loss Event)', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], wleRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);

      const nleRows = getLossExpectancyRows(module, 'nle');
      ({ page, yPosition } = ensurePageSpace(100 + nleRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'NLE (Normal Loss Event)', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Entered detail'], nleRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      yPosition = sectionBreak(yPosition);
    }

    if (module.module_key !== 'RE_02_CONSTRUCTION' && module.module_key !== 'RE_06_FIRE_PROTECTION') {
      const interpretation = buildSectionInterpretation(module, breakdown);
      if (interpretation) {
        ({ page, yPosition } = ensurePageSpace(90, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Engineering Interpretation', fontBold);
        yPosition = drawParagraph(page, yPosition, interpretation, font);
        yPosition = sectionBreak(yPosition, 44);
      }
    }

    if (module.module_key !== 'RE_02_CONSTRUCTION' && module.module_key !== 'RE_03_OCCUPANCY' && module.module_key !== 'RE_06_FIRE_PROTECTION') {
      const commentary = getNarrativeCommentaryWithBreakdown(module, breakdown);
      if (commentary) {
        ({ page, yPosition } = ensurePageSpace(120, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Narrative Commentary', fontBold);
        yPosition = drawParagraph(page, yPosition, commentary, font);
        yPosition = sectionBreak(yPosition, 44);
      }
    }

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

    yPosition -= 20;
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

  if (sitePhotos.length > 0) {
    ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
    yPosition = PAGE_TOP_Y;
    sectionStartPages.set('Appendix A — Site Photographs', totalPages.length);
    yPosition = drawSectionHeaderBar({
      page,
      x: MARGIN,
      y: yPosition,
      w: CONTENT_WIDTH,
      title: 'Appendix A — Site Photographs',
      product: 're',
      fonts: { regular: font, bold: fontBold },
    });
    yPosition = sectionBreak(yPosition, 12);

    const columnGap = 14;
    const itemWidth = (CONTENT_WIDTH - columnGap) / 2;
    const rowHeight = 184;
    let column = 0;

    for (const photo of sitePhotos) {
      const image = await embedEvidenceImage(pdfDoc, String(photo.storage_path));
      if (!image) continue;

      if (yPosition < MARGIN + rowHeight) {
        ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
        yPosition = PAGE_TOP_Y;
      }

      const x = MARGIN + (column * (itemWidth + columnGap));
      const availableHeight = 150;
      const scaled = image.scale(Math.min(itemWidth / image.width, availableHeight / image.height));
      const imageX = x + (itemWidth - scaled.width) / 2;
      const imageY = yPosition - scaled.height;

      page.drawRectangle({
        x,
        y: yPosition - availableHeight,
        width: itemWidth,
        height: availableHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.82, 0.84, 0.88),
      });
      page.drawImage(image, {
        x: imageX,
        y: imageY,
        width: scaled.width,
        height: scaled.height,
      });

      const photoDescription = String(
        photo.caption ||
        photo.description ||
        (photo as any).caption_text ||
        (photo as any).photo_description ||
        photo.notes ||
        ''
      ).trim();
      if (photoDescription) {
        const captionLines = wrapText(sanitizePdfText(photoDescription), itemWidth - 8, 8, font).slice(0, 3);
        let captionY = yPosition - availableHeight - 10;
        for (const line of captionLines) {
          page.drawText(line, {
            x: x + 4,
            y: captionY,
            size: 8,
            font,
            color: rgb(0.43, 0.45, 0.5),
          });
          captionY -= 9;
        }
      }

      if (column === 0) {
        column = 1;
      } else {
        column = 0;
        yPosition -= rowHeight;
      }
    }
  }

  if (sitePlanPath) {
    ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
    yPosition = PAGE_TOP_Y;
    sectionStartPages.set('Appendix B — Site Plan', totalPages.length);
    yPosition = drawSectionHeaderBar({
      page,
      x: MARGIN,
      y: yPosition,
      w: CONTENT_WIDTH,
      title: 'Appendix B — Site Plan',
      product: 're',
      fonts: { regular: font, bold: fontBold },
    });
    yPosition = sectionBreak(yPosition, 12);

    const sitePlanImage = await embedEvidenceImage(pdfDoc, sitePlanPath);
    if (sitePlanImage) {
      const maxHeight = PAGE_TOP_Y - MARGIN - 40;
      const scaled = sitePlanImage.scale(Math.min(CONTENT_WIDTH / sitePlanImage.width, maxHeight / sitePlanImage.height));
      const imageX = MARGIN + (CONTENT_WIDTH - scaled.width) / 2;
      const imageY = yPosition - scaled.height;
      page.drawImage(sitePlanImage, {
        x: imageX,
        y: imageY,
        width: scaled.width,
        height: scaled.height,
      });
      if (sitePlan?.description?.trim()) {
        const descriptionLines = wrapText(sanitizePdfText(sitePlan.description.trim()), CONTENT_WIDTH, 9, font);
        let descriptionY = imageY - 14;
        for (const line of descriptionLines.slice(0, 3)) {
          page.drawText(line, {
            x: MARGIN,
            y: descriptionY,
            size: 9,
            font,
            color: rgb(0.18, 0.18, 0.18),
          });
          descriptionY -= 11;
        }
      }
    }
  }

  if (currentSurveyRecommendations.length > 0) {
    const outstandingRecommendations = currentSurveyRecommendations.filter((action) => !isCompletedRecommendationStatus(action));
    const completedRecommendations = currentSurveyRecommendations.filter((action) => isCompletedRecommendationStatus(action));

    ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
    yPosition = PAGE_TOP_Y;
    sectionStartPages.set('Appendix C — Recommendations Register', totalPages.length);
    yPosition = drawSectionHeaderBar({
      page,
      x: MARGIN,
      y: yPosition,
      w: CONTENT_WIDTH,
      title: 'Appendix C — Recommendations Register',
      product: 're',
      fonts: { regular: font, bold: fontBold },
    });
    yPosition = sectionBreak(yPosition, 12);

    const drawRecommendationSection = (heading: string, rows: Action[]) => {
      yPosition = drawBlockHeading(page, yPosition, heading, fontBold);
      yPosition = sectionBreak(yPosition, 8);
      const tableRows = rows.map((action) => [
        sanitizePdfText(String(action.reference_number || action.id || 'Not provided')),
        sanitizePdfText(String(action.recommended_action || 'Not provided')),
        sanitizePdfText(String(action.priority_band || 'Not provided')),
        sanitizePdfText(String(action.owner_display_name || 'Unassigned')),
        sanitizePdfText(formatDate(action.target_date || '')),
        sanitizePdfText(String(action.status || 'Not provided')),
      ]);
      ({ page, yPosition } = drawSimpleTable(
        page,
        yPosition,
        ['Ref / ID', 'Recommendation', 'Priority', 'Owner', 'Target date', 'Status'],
        tableRows,
        { regular: font, bold: fontBold },
        {
          colWidths: [62, 206, 56, 78, 70, CONTENT_WIDTH - 472],
          fontSize: 8.25,
          minRowHeight: 18,
          wrapHeader: true,
          headerMinRowHeight: 22,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }
      ));
      yPosition = sectionBreak(yPosition, 12);
    };

    if (outstandingRecommendations.length > 0) {
      drawRecommendationSection('Section 1: Outstanding', outstandingRecommendations);
    }
    if (completedRecommendations.length > 0) {
      drawRecommendationSection('Section 2: Completed', completedRecommendations);
    }
  }

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
    ['Appendix A — Site Photographs', sectionStartPages.get('Appendix A — Site Photographs')],
    ['Appendix B — Site Plan', sectionStartPages.get('Appendix B — Site Plan')],
    ['Appendix C — Recommendations Register', sectionStartPages.get('Appendix C — Recommendations Register')],
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
