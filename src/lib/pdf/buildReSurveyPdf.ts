import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import {
  MARGIN,
  CONTENT_WIDTH,
  PAGE_TOP_Y,
  sanitizePdfText,
  wrapText,
  addNewPage,
  drawFooter,
  drawPlanWatermark,
  addSupersededWatermark,
  ensurePageSpace,
  formatDate,
} from './pdfUtils';
import { drawSectionHeaderBar, drawRiskSignificanceBlock, SignificanceLevel } from './pdfPrimitives';
import { buildRiskEngineeringScoreBreakdown } from '../re/scoring/riskEngineeringHelpers';
import { getModuleDisplayName } from '../modules/moduleDisplay';
import { addIssuedReportPages } from './issuedPdfPages';
import { supabase } from '../supabase';
import { resolvePdfPreparedByName } from '../../utils/pdfIdentity';
import {
  calculateScenarioLoss,
  isScenarioBlank,
  formatLossCurrency,
  type SumsInsuredData as LossCalcSumsInsured,
} from '../re/lossScenarioCalculator';
import { resolveFactorFallback } from '../re/recommendations/recommendationPipeline';
import {
  OLD_GENERIC_ACTION_PREFIX,
  OLD_GENERIC_HAZARD_TEXT,
} from '../re/recommendations/remediationMap';

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
  metadata?: {
    description?: string;
    caption?: string;
  };
  uploaded_at?: string;
}

function getPhotoCaptionText(photo: ReSurveySitePhoto): string {
  return String(
    photo.caption ||
    photo.description ||
    photo.notes ||
    photo.metadata?.description ||
    photo.metadata?.caption ||
    ''
  ).trim();
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
  action_required_text?: string | null;
  description?: string | null;
  title?: string | null;
  hazard_text?: string | null;
  source_module_key?: string | null;
  source_factor_key?: string | null;
  photos?: Array<unknown> | null;
  priority_band: string;
  status: string;
  completed_at?: string | null;
  is_complete?: boolean | null;
  document_id?: string | null;
  survey_id?: string | null;
  owner_user_id: string | null;
  owner_display_name?: string;
  target_date: string | null;
  timescale?: string | null;
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
  applyTrialWatermark?: boolean;
  preparedByName?: string | null;
}

type Breakdown = Awaited<ReturnType<typeof buildRiskEngineeringScoreBreakdown>>;

type Row = string[];
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
  // Treat null/undefined as absent data, not as 0. Number(null) === 0 would be misleading.
  if (value === null || value === undefined) return 'Data not provided';
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

export function getSectionTableRows(module: ModuleInstance, options: { breakdown?: Breakdown; linkedRecommendationCount?: number } = {}): Row[] {
  const d = module.data || {};
  if (module.module_key === 'RE_06_FIRE_PROTECTION') {
    const fp = (d as any).fire_protection || {};
    const buildings = Object.values((fp.buildings || {}) as Record<string, any>);
    const supplementary = fp.supplementary_assessment || {};
    const scoredQuestions = Array.isArray(supplementary.questions)
      ? supplementary.questions.filter((q: any) => Number.isFinite(Number(q?.score_1_5)))
      : [];
    const pillar = options.breakdown?.globalPillars.find((p) => p.key === 'fire_protection');

    if (!buildings.length) {
      return compactRows([
        ['Buildings assessed', 'Not entered at building level'],
        ['Sprinkler coverage', 'Not entered at building level'],
        ['Water supply reliability', formatValue(fp.site?.water?.water_reliability)],
        ['Supplementary assessment (questions rated)', `${scoredQuestions.length}`],
        ['Supplementary engineering overall score', formatScoreOutOfFive(supplementary.overall_score)],
        ['Fire protection weighted contribution', pillar ? formatWeightedScore(pillar.score, pillar.maxScore) : 'Not stated'],
        ['Linked recommendations', `${options.linkedRecommendationCount ?? 0}`],
      ]);
    }

    // Classify each building by its sprinkler installation status so the PDF never
    // shows misleading 0%/0% coverage for buildings where sprinklers are simply absent.
    const installedBuildings = buildings.filter((b: any) => {
      const status = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
      return status === 'Yes' || status === 'Partial';
    });
    const warrantedAbsentBuildings = buildings.filter((b: any) => {
      const status = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
      const warranted = String(b?.sprinklerData?.sprinklers_warranted ?? '').trim();
      return status === 'No' && warranted === 'Yes';
    });
    const notWarrantedBuildings = buildings.filter((b: any) => {
      const status = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
      const warranted = String(b?.sprinklerData?.sprinklers_warranted ?? '').trim();
      return status === 'No' && (warranted === 'No' || warranted === '');
    });

    // Derive a single summary statement for sprinkler status/coverage.
    // These four cases are mutually exclusive in priority order.
    let sprinklerSummaryRow: Row;
    let coverageRow: Row;

    // Helper: null-safe coverage average — only averages buildings where the value was actually entered.
    // Using ?? 0 would produce "0%" for unrecorded fields, which is misleading.
    const avgCoverage = (bldgs: any[], field: 'sprinkler_coverage_required_pct' | 'sprinkler_coverage_installed_pct'): string => {
      const entered = bldgs.filter((b: any) => {
        const v = b?.sprinklerData?.[field];
        return v !== null && v !== undefined && Number.isFinite(Number(v));
      });
      if (entered.length === 0) return 'Not entered';
      const avg = entered.reduce((s: number, b: any) => s + Number(b?.sprinklerData?.[field]), 0) / entered.length;
      return `${Math.round(avg * 10) / 10}%`;
    };

    if (installedBuildings.length > 0 && warrantedAbsentBuildings.length > 0) {
      // Mixed site — some buildings have systems, others have an unmitigated gap.
      const avgReq  = avgCoverage(installedBuildings, 'sprinkler_coverage_required_pct');
      const avgInst = avgCoverage(installedBuildings, 'sprinkler_coverage_installed_pct');
      sprinklerSummaryRow = ['Sprinkler status', `Installed in ${installedBuildings.length} building(s); absent (warranted) in ${warrantedAbsentBuildings.length} building(s)`];
      coverageRow = ['Sprinkler coverage (avg required / installed)', `${avgReq} req / ${avgInst} inst (installed buildings only)`];
    } else if (installedBuildings.length > 0) {
      const avgReq  = avgCoverage(installedBuildings, 'sprinkler_coverage_required_pct');
      const avgInst = avgCoverage(installedBuildings, 'sprinkler_coverage_installed_pct');
      sprinklerSummaryRow = ['Sprinkler status', `Installed in ${installedBuildings.length} of ${buildings.length} building(s)`];
      coverageRow = ['Sprinkler coverage (avg required / installed)', `${avgReq} req / ${avgInst} inst`];
    } else if (warrantedAbsentBuildings.length > 0) {
      sprinklerSummaryRow = ['Sprinkler status', `Sprinklers absent; protection warranted (${warrantedAbsentBuildings.length} building(s))`];
      coverageRow = ['Sprinkler coverage', 'Not applicable - system absent'];
    } else if (notWarrantedBuildings.length > 0) {
      // Check whether the FP supplementary score or pillar rating indicates a weak
      // protection profile — if so, the snapshot should not say "not considered warranted"
      // because that contradicts the engineering interpretation's risk-signal findings.
      const fpSupplementaryScore = Number(supplementary.overall_score);
      const fpPillarRating = pillar ? Number(pillar.rating) : NaN;
      const snapshotRiskSignal =
        (Number.isFinite(fpSupplementaryScore) && fpSupplementaryScore <= 2) ||
        (Number.isFinite(fpPillarRating) && fpPillarRating <= 2);
      const sprinklerStatusLabel = snapshotRiskSignal
        ? 'Sprinklers absent; fixed protection appears warranted by risk profile'
        : 'Sprinklers absent; not considered warranted';
      sprinklerSummaryRow = ['Sprinkler status', sprinklerStatusLabel];
      coverageRow = ['Sprinkler coverage', 'Not applicable'];
    } else {
      // Unknown or unrecorded status
      sprinklerSummaryRow = ['Sprinkler status', 'Sprinkler status unknown'];
      coverageRow = ['Sprinkler coverage', 'Not assessed'];
    }

    return compactRows([
      ['Buildings assessed', `${buildings.length}`],
      sprinklerSummaryRow,
      coverageRow,
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
    // 'Process / use overview' is rendered as a standalone paragraph block in the body —
    // omit it here to avoid a duplicate entry in the Section Snapshot table.
    const occupancy = (d as any).occupancy || d;
    return compactRows([
      ['Industry hazard notes', formatValue(occupancy.industry_special_hazards_notes)],
      ['Generic hazards logged', formatValue(Array.isArray(occupancy.hazards) ? occupancy.hazards.length : '')],
      ['Additional hazards notes', formatValue(occupancy.hazards_free_text)],
    ], []);
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

export function getNarrativeCommentaryWithBreakdown(module: ModuleInstance, breakdown: Breakdown): string {
  let notes = sanitizePdfText(module.assessor_notes || '').trim();

  if (module.module_key === 'RE_02_CONSTRUCTION') {
    // Return only the assessor's own narrative notes here.
    // The auto-generated engineering interpretation is rendered separately by
    // buildConstructionEngineeringInterpretation via buildSectionInterpretation.
    const construction = (module.data as any)?.construction || module.data || {};
    notes = sanitizePdfText(String(
      notes ||
      construction?.narrative_commentary ||
      construction?.construction_narrative ||
      construction?.site_notes ||
      construction?.comments ||
      ''
    )).trim();
    return notes;
  }

  if (module.module_key === 'RE_03_OCCUPANCY') {
    return notes;
  }

  // If the assessor has not entered narrative notes, suppress the Narrative Commentary
  // block entirely — the Engineering Interpretation already stands on its own.
  if (notes) return notes;
  return '';
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
  totalFloorArea: number | null;
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
  // Explicit GIA — only aggregate where the field is present; null means no GIA data entered
  const giaValues = buildings.map((b: any) => b?.total_floor_area_m2).filter((v: any) => Number.isFinite(Number(v)));
  const totalFloorArea = giaValues.length > 0 ? giaValues.reduce((sum: number, v: any) => sum + Number(v), 0) : null;
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
    // Prefer explicit GIA; fall back to roof area check for legacy records
    const hasFloorArea = Number.isFinite(Number(building?.total_floor_area_m2))
      || Number.isFinite(Number(building?.roof?.area_sqm ?? building?.roof_area_m2));
    const hasStoreys = Number.isFinite(Number(
      building?.geometry?.floors ??
      building?.geometry?.storeys ??
      building?.geometry?.storeys_above_ground ??
      building?.storeys ??
      building?.floors ??
      building?.number_of_storeys ??
      building?.number_of_floors ??
      building?.floors_above_ground ??
      building?.storeys_above_ground
    ));
    return !hasFloorArea || !hasStoreys;
  });

  return {
    buildings,
    rating,
    totalRoofArea,
    totalMezzArea,
    totalFloorArea,
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
  biSensitivity: string;
} {
  const tokens = hazards.map((hazard) => String(hazard?.hazard_label || hazard?.hazard_key || '').toLowerCase()).filter(Boolean);
  const bodyText = [
    occupancy?.industry_special_hazards_notes,
    occupancy?.hazards_free_text,
    occupancy?.process_description ?? occupancy?.process_overview ?? occupancy?.operations_description,
    ...hazards.map((h) => h?.free_text || ''),
  ].filter(Boolean).join(' ').toLowerCase();
  const hasFryers = tokens.some((token) => token.includes('fryer') || token.includes('fry'))
    || bodyText.includes('fryer') || bodyText.includes('frying') || bodyText.includes('deep fat') || bodyText.includes('deep-fat');
  const hasThermalOil = tokens.some((token) => token.includes('thermal oil')) || bodyText.includes('thermal oil') || bodyText.includes('hot oil');
  const hasFlammable = tokens.some((token) => token.includes('ignitable') || token.includes('flammable') || token.includes('gas')) || bodyText.includes('flammable') || bodyText.includes('solvent');
  const hasDustExplosion = tokens.some((token) => token.includes('dust') || token.includes('explosive')) || bodyText.includes('dust') || bodyText.includes('powder');
  const hasBatteryRisk = tokens.some((token) => token.includes('lithium') || token.includes('battery')) || bodyText.includes('lithium') || bodyText.includes('battery');
  // Ammonia and cold-chain detection — common in food processing, cold storage, brewing
  const hasAmmonia = tokens.some((token) => token.includes('ammonia') || token.includes('refrigerat'))
    || bodyText.includes('ammonia') || bodyText.includes('refrigerat');
  const hasColdChain = tokens.some((token) => token.includes('cold') || token.includes('freez') || token.includes('chill'))
    || bodyText.includes('cold store') || bodyText.includes('freezer') || bodyText.includes('chilled') || bodyText.includes('cold chain');
  const highHazardCount = [hasFlammable, hasDustExplosion, hasBatteryRisk, hasFryers, hasThermalOil, hasAmmonia].filter(Boolean).length;

  const ignitionLikelihood = highHazardCount >= 2 ? 'high ignition likelihood' : highHazardCount === 1 ? 'moderate ignition likelihood' : 'baseline ignition likelihood';
  const fireLoadSeverity = hasFlammable || hasDustExplosion || hasFryers || hasThermalOil ? 'elevated fire load/severity potential' : 'moderate fire load/severity potential';
  const controlsDependency = highHazardCount >= 2 ? 'high dependency on engineered and procedural controls' : 'moderate dependency on controls';
  const hazardSummary = tokens.length ? tokens.slice(0, 4).join(', ') : 'no explicit hazard entries';
  // biSensitivity: qualifies whether process interruption is expected to extend well beyond physical repair
  const biSensitivity = (hasAmmonia || hasColdChain || hasFryers)
    ? 'high process-BI sensitivity — interruption is likely to extend beyond physical repair timescales'
    : 'moderate process-BI sensitivity';
  const processSpecificNarrative = [
    hasFryers ? 'Industrial fryers introduce sustained high-temperature ignition sources and oil-fire severity potential.' : '',
    hasThermalOil ? 'Thermal oil systems introduce high-temperature leak scenarios that can accelerate escalation behaviour.' : '',
    hasAmmonia ? 'Ammonia refrigeration systems introduce toxic release risk — a fire or mechanical failure can cause site evacuation, product contamination, and cold-chain disruption that extends well beyond physical repair timescales.' : '',
    hasColdChain && !hasAmmonia ? 'Cold-chain dependency means expected business interruption extends beyond physical repair, pending refrigeration reinstatement and thermal restabilisation of stored product.' : '',
  ].filter(Boolean).join(' ');

  return { hazardSummary, ignitionLikelihood, fireLoadSeverity, controlsDependency, processSpecificNarrative, biSensitivity };
}

function getConstructionBuildingEvidenceRows(module: ModuleInstance): Row[] {
  const construction = (module.data as any)?.construction || module.data || {};
  const buildings = getConstructionBuildings(construction);
  return compactRows(buildings.map((building: any): Row => {
    const refOrName = building.ref || building.building_name || building.name || building.id;
    const roofArea = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzArea = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    // Active RE_02 completion snapshot persists these geometry fields directly:
    //   construction.buildings[].total_floor_area_m2  — explicit GIA entered by assessor
    //   construction.buildings[].storeys
    //   construction.buildings[].basements
    const totalFloorArea = building?.total_floor_area_m2 ?? null;
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
  const totals = buildings.reduce((acc: { roof: number; mezz: number; gia: number; hasRoof: boolean; hasMezz: boolean; hasGia: boolean }, building: any) => {
    const roofRaw = building?.roof?.area_sqm ?? building?.roof_area_m2;
    const mezzRaw = building?.upper_floors_mezzanine?.area_sqm ?? building?.mezzanine_area_m2;
    // Use explicit GIA only — do not infer from roof × storeys or roof + mezz
    const giaRaw = building?.total_floor_area_m2 ?? null;
    const hasRoof = Number.isFinite(Number(roofRaw));
    const hasMezz = Number.isFinite(Number(mezzRaw));
    const hasGia = Number.isFinite(Number(giaRaw));
    acc.hasRoof = acc.hasRoof || hasRoof;
    acc.hasMezz = acc.hasMezz || hasMezz;
    acc.hasGia = acc.hasGia || hasGia;
    if (hasRoof) acc.roof += numericOrZero(roofRaw);
    if (hasMezz) acc.mezz += numericOrZero(mezzRaw);
    if (hasGia) acc.gia += numericOrZero(giaRaw);
    return acc;
  }, { roof: 0, mezz: 0, gia: 0, hasRoof: false, hasMezz: false, hasGia: false });

  return [
    ['Total roof area (m²)', formatDataValue(totals.hasRoof ? totals.roof : null)],
    ['Total mezzanine / upper floor area (m²)', formatDataValue(totals.hasMezz ? totals.mezz : null)],
    ['Total floor area / GIA (m²)', formatDataValue(totals.hasGia ? totals.gia : null)],
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
  const siteTotalsLabel = context.totalFloorArea !== null
    ? 'Site totals (GIA m² / roof m²)'
    : 'Site totals (roof m²)';
  const siteTotalsValue = context.totalFloorArea !== null
    ? `${formatDataValue(context.totalFloorArea)} / ${formatDataValue(context.totalRoofArea)}`
    : `${formatDataValue(context.totalRoofArea)}`;
  return compactRows([
    [siteTotalsLabel, siteTotalsValue],
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
    // 'Process / use overview' is omitted here — it is rendered as a standalone
    // paragraph immediately before this table and must not be duplicated.
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
  ];
  const rows = compactRows(Object.entries(buildings).map(([buildingId, buildingData]: [string, any], index: number): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    const displayName = resolveBuildingDisplayName(buildingId, buildingData, index);
    const installedStatus = String(sprinklerData?.sprinklers_installed ?? '').trim();
    const warrantedStatus = String(sprinklerData?.sprinklers_warranted ?? '').trim();

    // Coverage cells depend on whether sprinklers actually exist.
    let installedCoverageCell: string;
    let requiredCoverageCell: string;
    if (installedStatus === 'Yes' || installedStatus === 'Partial') {
      // Installed system — show actual coverage percentages (null shows as "Data not provided").
      installedCoverageCell = resolveFireProtectionField(formatDataPercent(sprinklerData?.sprinkler_coverage_installed_pct));
      requiredCoverageCell  = resolveFireProtectionField(formatDataPercent(sprinklerData?.sprinkler_coverage_required_pct));
    } else if (installedStatus === 'No') {
      if (warrantedStatus === 'Yes') {
        installedCoverageCell = 'Not applicable - system absent';
        requiredCoverageCell  = 'Not applicable - system absent';
      } else {
        installedCoverageCell = 'Not applicable';
        requiredCoverageCell  = 'Not applicable';
      }
    } else {
      // Unknown or unset
      installedCoverageCell = 'Not assessed';
      requiredCoverageCell  = 'Not assessed';
    }

    return [
      formatDataValue(displayName),
      resolveFireProtectionField(sprinklerData?.sprinklers_installed),
      installedCoverageCell,
      requiredCoverageCell,
      resolveFireProtectionField(sprinklerData?.system_type),
      resolveFireProtectionField(sprinklerData?.standard ?? sprinklerData?.sprinkler_standard),
    ];
  }), ['sprinklers present', 'installed coverage', 'required coverage']);

  const widthMap: Record<string, number> = {
    Building: 88,
    'Sprinklers present': 72,
    'Installed coverage': 72,
    'Required coverage': 72,
    'System type': 88,
  };
  const fixedWidth = baseHeaders
    .filter((header) => header !== 'Design standard')
    .reduce((sum, header) => sum + (widthMap[header] ?? 70), 0);
  const colWidths = baseHeaders.map((header) => (
    header === 'Design standard' ? Math.max(86, CONTENT_WIDTH - fixedWidth) : (widthMap[header] ?? 70)
  ));

  return { headers: baseHeaders, rows, colWidths };
}

function getFireProtectionDesignHydraulicTable(module: ModuleInstance): { headers: string[]; rows: Row[]; colWidths: number[] } {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = fp?.buildings || {};
  const baseHeaders = ['Building', 'Hazard class', 'Density / area', 'Pressure', 'No. of heads'];
  const rawRows = Object.entries(buildings).map(([buildingId, buildingData]: [string, any], index: number): Row => {
    const sprinklerData = buildingData?.sprinklerData || {};
    return [
      formatDataValue(resolveBuildingDisplayName(buildingId, buildingData, index)),
      resolveFireProtectionField(sprinklerData?.hazard_class),
      resolveFireProtectionField(sprinklerData?.density_area),
      resolveFireProtectionField(sprinklerData?.pressure),
      resolveFireProtectionField(sprinklerData?.number_of_heads),
    ];
  });
  const rows = compactRows(rawRows, ['density / area', 'pressure', 'no. of heads']);
  const retainedIndexes = baseHeaders
    .map((_, index) => index)
    .filter((index) => index === 0 || rows.some((row) => !isNotProvidedValue(row[index])));
  const headers = retainedIndexes.map((index) => baseHeaders[index]);
  const rowsByHeader = rows.map((row) => retainedIndexes.map((index) => row[index]) as Row);

  const widthMap: Record<string, number> = {
    Building: 100,
    'Hazard class': 90,
    'Density / area': 108,
    Pressure: 86,
  };
  const fixedWidth = headers
    .filter((header) => header !== 'No. of heads')
    .reduce((sum, header) => sum + (widthMap[header] ?? 90), 0);
  const colWidths = headers.map((header) => (
    header === 'No. of heads' ? Math.max(80, CONTENT_WIDTH - fixedWidth) : (widthMap[header] ?? 90)
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
  const waterSupplies = Array.isArray(water?.water_supplies) ? water.water_supplies : [];
  const hasMultipleSupplies = waterSupplies.length > 1;
  const rows: Row[] = [
    ['Water reliability', resolveFireProtectionField(water?.water_reliability)],
    ...(hasMultipleSupplies ? [['Water supplies recorded', resolveFireProtectionField(waterSupplies.length)]] : []),
    ['Power resilience / testing regime', resolveFireProtectionField(water?.power_resilience, water?.testing_regime)],
    ['Hydrant/fire main/hose reels', resolveFireProtectionField(water?.hydrant_coverage, water?.fire_main_condition, water?.hose_reels_present)],
    ['Flow test evidence / date', resolveFireProtectionField(water?.flow_test_evidence, water?.flow_test_date)],
    ['Water weaknesses / site comments', resolveFireProtectionField(water?.key_weaknesses, fp?.site?.comments)],
    ['Site water score (1-5)', resolveFireProtectionField(fp?.site?.water_score_1_5)],
    ['Impairment management notes', resolveFireProtectionField((module.data as any)?.management?.impairment_management, (module.data as any)?.management?.impairment_management_notes)],
  ];
  return rows.filter(([label, value]) => {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel === 'site water score (1-5)') return true;
    return !isNotProvidedValue(value);
  });
}

function getFireProtectionWaterSupplyRows(module: ModuleInstance): Row[] {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const water = fp?.site?.water || {};
  const waterSupplies = Array.isArray(water?.water_supplies) ? water.water_supplies : [];

  if (waterSupplies.length > 0) {
    return compactRows(
      waterSupplies.map((supply: any, index: number): Row => [
        `Supply ${index + 1}`,
        resolveFireProtectionField(supply?.type),
        resolveFireProtectionField(supply?.capacity_m3),
      ]),
      ['type', 'capacity']
    );
  }

  const legacyType = water?.supply_type;
  const legacyCapacity = water?.capacity;
  if (isNotProvidedValue(legacyType) && isNotProvidedValue(legacyCapacity)) return [];
  return compactRows([
    ['Supply 1', resolveFireProtectionField(legacyType, water?.supply_type_other), resolveFireProtectionField(legacyCapacity)],
  ], ['type', 'capacity']);
}

function getFireProtectionPumpTable(module: ModuleInstance): { headers: string[]; rows: Row[] } {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const water = fp?.site?.water || {};
  const pumps = Array.isArray(water?.pumps) ? water.pumps : [];
  if (pumps.length > 0) {
    const rows = compactRows(
      pumps.map((pump: any, index: number): Row => [
        `Pump ${index + 1}`,
        resolveFireProtectionField(pump?.driver_type),
        resolveFireProtectionField(pump?.rated_flow),
        resolveFireProtectionField(pump?.rated_pressure),
        resolveFireProtectionField(pump?.rated_rpm),
      ]),
      ['driver type', 'rated flow', 'rated pressure', 'rated rpm']
    );
    const hasDriverType = rows.some((row) => !isNotProvidedValue(row[1]));
    const headers = hasDriverType
      ? ['Pump', 'Driver type', 'Rated flow (m³/h)', 'Rated pressure (bar)', 'Rated RPM']
      : ['Pump', 'Rated flow (m³/h)', 'Rated pressure (bar)', 'Rated RPM'];
    return {
      headers,
      rows: hasDriverType ? rows : rows.map((row) => [row[0], row[2], row[3], row[4]] as Row),
    };
  }

  const legacyFlow = water?.pump_flow ?? water?.pump_rating;
  const legacyPressure = water?.pump_pressure;
  const legacyRpm = water?.pump_rpm;
  const hasLegacyPump = [legacyFlow, legacyPressure, legacyRpm].some((value) => !isNotProvidedValue(value));
  if (!hasLegacyPump) return { headers: [], rows: [] };
  return {
    headers: ['Pump', 'Rated flow (m³/h)', 'Rated pressure (bar)', 'Rated RPM'],
    rows: compactRows([
      ['Pump 1', resolveFireProtectionField(legacyFlow), resolveFireProtectionField(legacyPressure), resolveFireProtectionField(legacyRpm)],
    ], ['rated flow', 'rated pressure', 'rated rpm']),
  };
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
  // Only emit a coverage statement when at least one building has sprinklers installed.
  // When sprinklers are absent or all fields are N/A, there is no coverage to characterise —
  // stating "aligned" would be misleading.
  const anyInstalled = buildings.some((b: any) => {
    const s = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
    return s === 'Yes' || s === 'Partial';
  });
  if (!anyInstalled) return '';
  // Also suppress when no building has numeric coverage entries — "aligned" is only meaningful
  // where installed% and required% have been entered.
  const hasCoverageData = buildings.some((b: any) => {
    return Number.isFinite(Number(b?.sprinklerData?.sprinkler_coverage_installed_pct))
      || Number.isFinite(Number(b?.sprinklerData?.sprinkler_coverage_required_pct));
  });
  if (!hasCoverageData) return '';
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

  const averageScore = scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length;
  const lowCount = scored.filter((entry) => entry.score <= 2).length;
  const opening = averageScore >= 4
    ? `${group === 'adequacy' ? 'Adequacy appears strong overall' : 'Reliability appears strong overall'} based on the current Q${group === 'adequacy' ? '1–Q4' : '5–Q7'} scoring pattern.`
    : averageScore >= 3
      ? `${group === 'adequacy' ? 'Adequacy is generally acceptable but mixed' : 'Reliability is generally acceptable but mixed'} across the current Q${group === 'adequacy' ? '1–Q4' : '5–Q7'} scoring profile.`
      : `${group === 'adequacy' ? 'Adequacy is constrained by low-scoring controls' : 'Reliability is constrained by low-scoring controls'} in the current dataset.`;

  const strongest = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      label: sanitizePdfText(formatDataValue(entry.question?.prompt ?? entry.question?.factor_key)).replace(/^Q\d+\s*[-:]\s*/i, ''),
      note: String(entry.question?.notes ?? entry.question?.comment ?? '').trim(),
      score: entry.score,
    }))
    .find((entry) => entry.score >= 4) || null;
  const supporting = strongest
    ? `Best evidence is in ${strongest.label}${strongest.note ? ` (${sanitizePdfText(strongest.note)})` : ''}.`
    : '';

  const caveatEntry = [...scored]
    .sort((a, b) => a.score - b.score)
    .map((entry) => ({
      label: sanitizePdfText(formatDataValue(entry.question?.prompt ?? entry.question?.factor_key)).replace(/^Q\d+\s*[-:]\s*/i, ''),
      note: String(entry.question?.notes ?? entry.question?.comment ?? '').trim(),
      score: entry.score,
    }))
    .find((entry) => entry.score <= 2 || (entry.score <= 3 && entry.note.length > 0)) || null;
  const caveat = caveatEntry
    ? `Key caveat: ${caveatEntry.label} remains weaker (score ${formatScore(caveatEntry.score)}/5)${caveatEntry.note ? ` — ${sanitizePdfText(caveatEntry.note)}` : ''}.`
    : '';
  const uncertainty = group === 'reliability' && hasWaterSupplyDataUncertainty(module) && (lowCount > 0 || !caveatEntry)
    ? 'Water supply reliability cannot be confirmed due to limited available information.'
    : '';

  return [opening, supporting, caveat, uncertainty].filter(Boolean).join(' ');
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
  // processOverview is rendered separately as a paragraph in the PDF body — omit from interpretation to avoid repetition
  const contextParts = [formatDataValue(occupancyType), hazardLabels || null]
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
  // Call the hazard-signal analyser to derive process-specific loss-mechanism commentary.
  const signals = describeOccupancyHazardSignals(hazards, occupancy);
  const processNarrative = signals.processSpecificNarrative
    ? signals.processSpecificNarrative + ' '
    : '';
  const closing = `Overall occupancy score is ${formatScoreOutOfFive(overallRating)}. ${implication} ${processNarrative}This profile represents ${signals.ignitionLikelihood} with ${signals.fireLoadSeverity} and ${signals.biSensitivity} — directly relevant to underwriting assessment of ignition frequency, severity potential, and business interruption duration.`;

  return [opening, weaknessNarrative, resilienceNarrative, closing].filter(Boolean).join('\n\n');
}

export function buildSectionInterpretation(module: ModuleInstance, breakdown: Breakdown, allModules: ModuleInstance[] = []): string {
  if (module.module_key === 'RE_02_CONSTRUCTION') return buildConstructionEngineeringInterpretation(module, breakdown);
  if (module.module_key === 'RE_03_OCCUPANCY') return buildOccupancyEngineeringInterpretation(module, breakdown);
  if (module.module_key === 'RE_06_FIRE_PROTECTION') return buildFireProtectionEngineeringInterpretation(module, allModules);
  if (module.module_key === 'RE_07_NATURAL_HAZARDS') return buildNaturalHazardsEngineeringInterpretation(module, breakdown);
  if (module.module_key === 'RE_08_UTILITIES') return buildUtilitiesEngineeringInterpretation(module, breakdown, allModules);
  if (module.module_key === 'RE_09_MANAGEMENT') return buildManagementEngineeringInterpretation(module, breakdown, allModules);
  if (module.module_key === 'RE_12_LOSS_VALUES') return buildLossValuesEngineeringInterpretation(module, breakdown);

  const rating = resolveSectionRating(module, breakdown);
  if (!Number.isFinite(Number(rating))) {
    return 'Engineering interpretation is constrained because section rating data is not provided. Conclusions are provisional and should be read as data-limited rather than as a confirmed risk view.';
  }
  const band = getScoreBand(rating);
  return `Engineering interpretation: Current score is ${formatScoreOutOfFive(rating)} (${band.label}). The entered evidence should be reviewed for whether controls are reliable in a severe but credible loss scenario, not just whether fields are present.`;
}

function getExposuresStructuredRows(module: ModuleInstance): Row[] {
  const exposures = (module.data as any)?.exposures || module.data || {};
  const perils = exposures?.environmental?.perils || {};
  const rows: Row[] = [];

  const environmental = [
    ['Flood', perils?.flood?.rating, perils?.flood?.notes],
    ['Windstorm', perils?.wind?.rating, perils?.wind?.notes],
    ['Earthquake', perils?.earthquake?.rating, perils?.earthquake?.notes],
    ['Wildfire', perils?.wildfire?.rating, perils?.wildfire?.notes],
  ]
    .map(([label, rating, notes]) => {
      const details = [
        !isMissingDataValue(rating) ? `Rating ${formatDataValue(rating)}` : '',
        !isMissingDataValue(notes) ? `${formatDataValue(notes)}` : '',
      ].filter(Boolean).join(' — ');
      return details ? `${label}: ${details}` : '';
    })
    .filter(Boolean)
    .join('\n');

  const legacyEnvironmental = [
    exposures?.flood_exposure_level,
    exposures?.windstorm_exposure_level,
    exposures?.wildfire_exposure_level,
  ].find((value) => !isMissingDataValue(value));

  const environmentalValue = !isMissingDataValue(environmental) ? environmental : formatDataValue(legacyEnvironmental);
  if (!isMissingDataValue(environmentalValue)) {
    rows.push(['Environmental perils', environmentalValue]);
  }

  const otherPerilParts = [
    perils?.other?.label,
    perils?.other?.rating !== undefined ? `Rating ${formatDataValue(perils?.other?.rating)}` : undefined,
    perils?.other?.notes,
  ]
    .map((value) => formatDataValue(value))
    .filter((value) => !isMissingDataValue(value));
  if (otherPerilParts.length > 0) {
    rows.push(['Other peril', otherPerilParts.join(' | ')]);
  }

  const humanExposureRating = formatDataValue(exposures?.human_exposure?.rating);
  if (!isMissingDataValue(humanExposureRating)) {
    rows.push(['Human exposure rating', humanExposureRating]);
  }
  const humanExposureNotes = formatDataValue(exposures?.human_exposure?.notes);
  if (!isMissingDataValue(humanExposureNotes)) {
    rows.push(['Human exposure notes', humanExposureNotes]);
  }

  const optionalLegacyRows: Array<[string, unknown]> = [
    ['Security / arson controls', exposures?.security?.notes ?? exposures?.arson_controls],
    ['Drainage / site topography notes', exposures?.drainage_notes ?? exposures?.site_topography_notes],
    ['Mitigation / resilience notes', exposures?.resilience_measures ?? exposures?.mitigation_notes],
  ];
  for (const [label, value] of optionalLegacyRows) {
    const formatted = formatDataValue(value);
    if (!isMissingDataValue(formatted)) {
      rows.push([label, formatted]);
    }
  }

  return compactRows(rows);
}

function getUtilitiesStructuredRows(module: ModuleInstance): Row[] {
  const d = module.data || {};
  const power = (d as any).power_resilience || {};
  const services = Array.isArray((d as any).critical_services) ? (d as any).critical_services : [];
  const equipment = Array.isArray((d as any).critical_equipment) ? (d as any).critical_equipment : [];
  return compactRows([
    ['Backup power present', formatDataValue(power?.backup_power_present)],
    ['Generator capacity notes', formatDataValue(power?.generator_capacity_notes)],
    ['Power resilience notes', formatDataValue(power?.notes)],
    ['Critical services', services.length ? services.map((item: any) => `${formatDataValue(item?.custom_label ?? item?.service_name ?? item?.service_type ?? item?.name ?? item)} | present ${formatDataValue(item?.present)} | criticality ${formatDataValue(item?.criticality)} | backup ${formatDataValue(item?.backup_available)} | notes ${formatDataValue(item?.notes)}`).join('\n') : 'Data not provided'],
    ['Critical equipment', equipment.length ? equipment.map((item: any) => `${formatDataValue(item?.custom_label ?? item?.equipment_name ?? item?.equipment_type ?? item?.name ?? item)} (${formatDataValue(item?.tag_or_name)}) | criticality ${formatDataValue(item?.criticality)} | redundancy ${formatDataValue(item?.redundancy)} | spares ${formatDataValue(item?.spares_strategy)} | maintenance ${formatDataValue(item?.maintenance_adequacy_rating)} | condition ${formatDataValue(item?.condition_notes ?? item?.known_issues)} | notes ${formatDataValue(item?.notes)}`).join('\n') : 'Data not provided'],
  ]);
}

function getManagementCategoryRows(module: ModuleInstance): Row[] {
  const management = (module.data as any)?.management || module.data || {};
  const categories = Array.isArray(management?.categories) ? management.categories : [];
  const rows = categories.map((category: any): Row => ([
    formatDataValue(category?.label ?? category?.key),
    formatDataValue(category?.rating_1_5),
    formatDataValue(category?.notes),
  ]));
  return compactRows(rows, []);
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

function getLossExpectancyRows(module: ModuleInstance, event: 'wle' | 'nle' | 'eml'): Row[] {
  const d = module.data || {};
  const expectancy = (d as any)?.[event] || {};
  const bi = expectancy?.business_interruption || {};

  // ── Input rows (what the assessor entered) ────────────────────────────────
  const inputRows: Row[] = compactRows([
    ['Scenario title', formatDataValue(expectancy?.scenario_summary ?? expectancy?.title)],
    ['Scenario description', formatDataValue(expectancy?.scenario_description)],
    ['Buildings damage %', formatDataPercent(expectancy?.property_damage?.buildings_improvements_pct)],
    ['Plant & machinery damage %', formatDataPercent(expectancy?.property_damage?.plant_machinery_contents_pct)],
    ['Stock damage %', formatDataPercent(expectancy?.property_damage?.stock_wip_pct)],
    ['Computers damage %', formatDataPercent(expectancy?.property_damage?.computers_pct)],
    ['BI outage duration', bi?.outage_duration_months !== undefined && bi?.outage_duration_months !== null
      ? `${bi.outage_duration_months} months` : 'Data not provided'],
    ['BI severity %', formatDataPercent(bi?.gross_profit_pct ?? bi?.severity_pct)],
  ], ['scenario title']);

  // ── Calculated rows ───────────────────────────────────────────────────────
  const currency = (d as any)?.currency ?? 'GBP';
  const sumsInsured = (d as any)?.sums_insured as LossCalcSumsInsured | undefined;
  const otherLabel = (d as any)?.sums_insured?.property_damage?.other_label as string | undefined;
  const calc = calculateScenarioLoss(sumsInsured, expectancy, otherLabel);

  const fmtCcy = (amount: number) => formatLossCurrency(amount, currency);

  const calcRows: Row[] = [];

  if (calc.canCalculate) {
    // Property damage components
    for (const comp of calc.pdComponents) {
      if (comp.baseValue === null && (comp.damagePercent === null || comp.damagePercent === 0)) continue;
      if (comp.missingBaseValue) {
        calcRows.push([`  ${comp.label} loss`, `Cannot calculate — missing ${comp.label} declared value`]);
      } else if (comp.loss !== null && comp.loss > 0) {
        const detail = comp.baseValue !== null && comp.damagePercent !== null
          ? `${fmtCcy(comp.baseValue)} × ${comp.damagePercent}% = ${fmtCcy(comp.loss)}`
          : fmtCcy(comp.loss);
        calcRows.push([`  ${comp.label} loss`, detail]);
      }
    }
    calcRows.push(['Property damage total', fmtCcy(calc.pdTotal)]);

    // BI calculation
    if (calc.biLoss === null) {
      const missing = calc.biMissingFields.join(', ');
      calcRows.push(['BI loss', `Cannot calculate — missing ${missing}`]);
    } else if (calc.biLoss > 0) {
      const biDetail = calc.biGrossProfit !== null && calc.biSeverityPct !== null && calc.biDurationMonths !== null
        ? `${fmtCcy(calc.biGrossProfit)} × ${calc.biSeverityPct}% × ${calc.biDurationMonths} months / 12 = ${fmtCcy(calc.biLoss)}`
        : fmtCcy(calc.biLoss);
      calcRows.push(['BI loss', biDetail]);
    }
  } else if (calc.missingFields.length > 0) {
    calcRows.push(['Cannot calculate', `Missing: ${calc.missingFields.join(', ')}`]);
  }

  if (calcRows.length > 0) {
    // Blank separator row between inputs and calculations
    inputRows.push(['', '']);
  }

  return [...inputRows, ...calcRows];
}

/**
 * Draw a highlighted "Total [WLE/NLE/EML]" box below a scenario table.
 * Returns the new yPosition.
 */
function drawLossScenarioTotal(
  page: PDFPage,
  yPosition: number,
  label: string,
  amount: number | null,
  currency: string,
  fonts: { regular: any; bold: any },
): number {
  const boxHeight = 24;
  const y = yPosition - 6;

  if (amount === null) {
    page.drawText(`${label}: Cannot calculate — check missing inputs above`, {
      x: MARGIN + 6,
      y: y - 14,
      size: 9,
      font: fonts.regular,
      color: rgb(0.55, 0.2, 0.1),
    });
    return y - boxHeight - 4;
  }

  page.drawRectangle({
    x: MARGIN,
    y: y - boxHeight + 4,
    width: CONTENT_WIDTH,
    height: boxHeight,
    color: rgb(0.91, 0.94, 0.98),
    borderColor: rgb(0.62, 0.72, 0.87),
    borderWidth: 0.8,
  });
  page.drawText(label, {
    x: MARGIN + 8,
    y: y - 14,
    size: 9.5,
    font: fonts.bold,
    color: rgb(0.1, 0.18, 0.36),
  });
  const amountText = formatLossCurrency(amount, currency);
  const textWidth = amountText.length * 5.6; // rough estimate
  page.drawText(amountText, {
    x: MARGIN + CONTENT_WIDTH - textWidth - 8,
    y: y - 14,
    size: 9.5,
    font: fonts.bold,
    color: rgb(0.1, 0.18, 0.36),
  });
  return y - boxHeight - 4;
}


function getRatingByKey(breakdown: Breakdown, key: string): number | null {
  const direct = breakdown.globalPillars.find((pillar) => pillar.key === key)?.rating;
  if (Number.isFinite(Number(direct))) return Number(direct);
  const driver = breakdown.occupancyDrivers.find((item) => item.key === key)?.rating;
  return Number.isFinite(Number(driver)) ? Number(driver) : null;
}

function buildNaturalHazardsEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown): string {
  // Extract individual named perils so the narrative can say "Flood 1/5" rather than "Environmental perils".
  const exposures = (module.data as any)?.exposures || module.data || {};
  const perils = exposures?.environmental?.perils || {};
  const NAMED_PERILS: Array<[string, string]> = [
    ['Flood', 'flood'],
    ['Windstorm', 'wind'],
    ['Earthquake', 'earthquake'],
    ['Wildfire', 'wildfire'],
  ];

  // Collect all rated perils with their numeric values.
  const ratedPerils: Array<{ label: string; rating: number }> = [];
  for (const [label, key] of NAMED_PERILS) {
    const r = Number(perils?.[key]?.rating);
    if (Number.isFinite(r) && r >= 1) ratedPerils.push({ label, rating: r });
  }
  // Sort worst (lowest score) first so we can lead with the priority peril.
  ratedPerils.sort((a, b) => a.rating - b.rating);

  const weakerPerils = ratedPerils.filter((p) => p.rating <= 2).map((p) => p.label);
  const moderatePerils = ratedPerils.filter((p) => p.rating === 3).map((p) => p.label);

  // Also check human exposure via structured rows for any ratings not captured above.
  const rows = getExposuresStructuredRows(module);
  const humanRow = rows.find(([label]) => /human/i.test(label));
  if (humanRow) {
    const detail = String(humanRow[1]);
    if (/rating\s*[12]\b/i.test(detail)) weakerPerils.push('Human threat exposure');
    else if (/rating\s*3\b/i.test(detail)) moderatePerils.push('Human threat exposure');
  }

  // Deduplicate and cap at 3 for readability.
  const weakUniq = [...new Set(weakerPerils)].slice(0, 3);
  const modUniq = [...new Set(moderatePerils)].slice(0, 3);

  const rating = getRatingByKey(breakdown, 'natural_hazards_and_external_exposures') ?? resolveSectionRating(module, breakdown);
  const aggregateValid = Number.isFinite(Number(rating)) && Number(rating) >= 1;
  const hasPerilRatings = ratedPerils.length > 0;

  // --- Lead sentence ---
  // When the aggregate section score is valid, use it. When it is absent but individual perils
  // are scored, lead with the peril data rather than stating "score is 0/5" — that is contradictory.
  let leadSentence: string;
  if (aggregateValid) {
    leadSentence = `Natural hazards score is ${formatScoreOutOfFive(rating)}.`;
  } else if (hasPerilRatings) {
    // The worst-rated peril (first after sort) drives the lead.
    const worstPeril = ratedPerils[0];
    const otherPerils = ratedPerils.slice(1);
    const othersText = otherPerils.length > 0
      ? ` ${otherPerils.map((p) => `${p.label} is recorded as ${formatScoreOutOfFive(p.rating)}`).join('; ')}.`
      : '';
    leadSentence = `Natural hazard exposure is driven principally by the ${worstPeril.label.toLowerCase()} rating of ${formatScoreOutOfFive(worstPeril.rating)}.${othersText}`;
  } else {
    leadSentence = 'Natural hazards exposure data has not been fully scored — individual peril ratings are required to quantify site exposure.';
  }

  // --- Focus narrative ---
  // When the lead sentence already names the priority peril, the focus narrative adds the
  // underwriting consequence (asset damage, access disruption, BI).
  let focus: string;
  if (weakUniq.length) {
    // If the lead sentence already names the single weakest peril, don't repeat it verbatim.
    const weakList = weakUniq.join(', ');
    focus = `${weakList.charAt(0).toUpperCase() + weakList.slice(1)} should therefore receive priority underwriting attention, particularly in relation to asset damage, site access, utility interruption, stock protection and recovery delay.`;
  } else if (modUniq.length) {
    focus = `${modUniq.join(', ')} are rated at a moderate level and should be tested against realistic worst-case scenarios for site access, utility disruption, and restoration timescales.`;
  } else if (hasPerilRatings) {
    // All rated perils are 4 or 5 — broadly controlled exposure.
    focus = 'All scored perils indicate broadly controlled natural hazard exposure. The residual underwriting concern is tail-event scenarios not represented in historical data.';
  } else {
    focus = 'Site-specific flood, wind, seismic, and human-threat evidence should be validated against local datasets before this section is treated as confirmed low-exposure.';
  }

  // --- Closing ---
  // Use the aggregate rating if valid; otherwise derive from the worst peril rating.
  // Only state "cannot be quantified" when NEITHER aggregate NOR individual peril ratings exist.
  const effectiveRating = aggregateValid ? Number(rating) : (hasPerilRatings ? ratedPerils[0].rating : null);
  const closingByRating = effectiveRating === null
    ? 'No scored peril ratings have been entered — natural hazard exposure cannot be assessed from submitted data. This section should not be read as a confirmed low-risk conclusion.'
    : effectiveRating <= 2
      ? 'At this exposure level the underwriting concern is compounded loss: a single natural-hazard event can simultaneously cause physical damage, disrupt utilities and access, and trigger BI before the main peril has even been resolved.'
      : effectiveRating <= 3.5
        ? 'The primary underwriting consideration is access and utility disruption extending the BI period beyond the physical repair timeline, rather than only the direct property damage quantum.'
        : 'Where exposure is broadly controlled the residual underwriting concern is low-probability, high-consequence tail events — the kind of scenario that may not appear in historical data but is within the site exposure range.';

  return `Engineering interpretation: ${leadSentence} ${focus} ${closingByRating}`;
}

function buildUtilitiesEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown, allModules: ModuleInstance[] = []): string {
  const data = module.data as any;
  const services: any[] = Array.isArray(data?.critical_services) ? data.critical_services : [];
  const equipment: any[] = Array.isArray(data?.critical_equipment) ? data.critical_equipment : [];
  const rating = getRatingByKey(breakdown, 'electrical_and_utilities_reliability') ?? resolveSectionRating(module, breakdown);
  const noBackupPower = data?.power_resilience?.backup_power_present === false;
  const hasBackupPower = data?.power_resilience?.backup_power_present === true;

  // Items labelled high-criticality without adequate redundancy — these drive BI duration directly.
  const highCritWithLimitedRedundancy = equipment.filter((e: any) => {
    const crit = String(e?.criticality || '').toLowerCase();
    const red = String(e?.redundancy || '').toLowerCase();
    return crit === 'high' && (red === 'n+0' || red === 'unknown' || red === '');
  });
  const highCritServices = services.filter((s: any) => String(s?.criticality || '').toLowerCase() === 'high');

  // Detect refrigeration/cold-chain dependency — extends BI well beyond physical repair.
  const allItems = [...services, ...equipment];
  const refrigerationItems = allItems.filter((item: any) => {
    const label = String(
      item?.custom_label ?? item?.service_name ?? item?.equipment_name ?? item?.equipment_type ?? item?.name ?? ''
    ).toLowerCase();
    return label.includes('refrigerat') || label.includes('ammonia') || label.includes('cold store')
      || label.includes('freezer') || label.includes('chiller') || label.includes('cold chain');
  });

  // Lead sentence — score + headline condition.
  const leadText = `Utilities and critical-services resilience is ${formatScoreOutOfFive(rating)}.`;

  // Evidence narrative — describe content, not just count.
  // When no explicit critical services/equipment records exist, cross-reference the
  // occupancy module to identify process dependencies that imply utility criticality.
  let occupancySignals: ReturnType<typeof describeOccupancyHazardSignals> | null = null;
  let occupancyData: any = null;
  if (services.length === 0 && equipment.length === 0 && allModules.length > 0) {
    const occupancyModule = allModules.find(
      (m) => m.module_key === 'RE_03_OCCUPANCY'
    );
    if (occupancyModule) {
      const od = (occupancyModule.data as any)?.occupancy || occupancyModule.data || {};
      occupancyData = od;
      const hazards: any[] = Array.isArray(od?.hazards) ? od.hazards : [];
      occupancySignals = describeOccupancyHazardSignals(hazards, od);
    }
  }
  // Derive occupancy-based cold-chain and ammonia signals from occupancy module
  // (only relevant when utilities module has no explicit service records).
  const occupancyBodyText = occupancyData
    ? [
        occupancyData?.industry_special_hazards_notes,
        occupancyData?.hazards_free_text,
        occupancyData?.process_description ?? occupancyData?.process_overview ?? occupancyData?.operations_description,
      ].filter(Boolean).join(' ').toLowerCase()
    : '';
  const occupancyImpliesAmmonia = occupancyBodyText.includes('ammonia') || occupancyBodyText.includes('refrigerat');
  const occupancyImpliesColdChain = occupancyBodyText.includes('freezer') || occupancyBodyText.includes('cold store')
    || occupancyBodyText.includes('cold chain') || occupancyBodyText.includes('chilled') || occupancyBodyText.includes('frozen');
  const occupancyImpliesFryers = occupancyBodyText.includes('fryer') || occupancyBodyText.includes('frying') || occupancyBodyText.includes('deep fat');

  let evidenceText: string;
  if (services.length === 0 && equipment.length === 0) {
    if (occupancySignals && (occupancyImpliesAmmonia || occupancyImpliesColdChain || occupancyImpliesFryers)) {
      // Build occupancy-informed utilities narrative
      const occupancyImplications: string[] = [];
      if (occupancyImpliesAmmonia) {
        occupancyImplications.push(
          'Ammonia refrigeration plant is indicated by the occupancy profile. Ammonia systems are a critical utility dependency: plant failure causes immediate cold-chain loss, product spoilage, and potential site evacuation. Restart may require specialist refrigeration contractors, integrity checks, pressure testing, recommissioning and, depending on incident severity, regulatory or environmental liaison.'
        );
      }
      if (occupancyImpliesColdChain && !occupancyImpliesAmmonia) {
        occupancyImplications.push(
          'Cold-chain and freezer operations are indicated by the occupancy profile. Refrigeration continuity is a critical utility dependency: power or system failure begins causing product stock deterioration immediately, and thermal restabilisation after reinstatement extends the effective interruption period beyond plant repair timescales.'
        );
      } else if (occupancyImpliesColdChain && occupancyImpliesAmmonia) {
        occupancyImplications.push(
          'Freezer and cold-store operations depend directly on the ammonia refrigeration plant — loss of plant operation means immediate cold-chain failure and progressive product stock loss.'
        );
      }
      if (occupancyImpliesFryers) {
        occupancyImplications.push(
          'Industrial frying lines are indicated by the occupancy profile. These are high-value, long-lead production assets: frying lines, oil management systems, and their utility services (gas, thermal oil, power) are bottleneck dependencies that directly constrain restart timescales.'
        );
      }
      evidenceText = `Critical services and equipment dependencies have not been individually recorded in this section. Cross-referencing the occupancy profile, the following utility dependencies are implied and should be assessed: ${occupancyImplications.join(' ')} Formal critical-services and critical-equipment records are required to support credible maximum probable interruption duration estimates.`;
    } else {
      evidenceText = 'Critical services and equipment dependencies have not been recorded. Without this evidence, maximum probable interruption duration cannot be credibly assessed.';
    }
  } else {
    const parts: string[] = [];
    if (highCritServices.length > 0) {
      parts.push(`${highCritServices.length} high-criticality service(s) are recorded`);
    }
    if (highCritWithLimitedRedundancy.length > 0) {
      const names = highCritWithLimitedRedundancy
        .map((e: any) => String(e?.custom_label ?? e?.equipment_name ?? e?.equipment_type ?? '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      parts.push(`${highCritWithLimitedRedundancy.length} high-criticality equipment item(s) with limited or unconfirmed redundancy${names ? ` (${names})` : ''}`);
    }
    evidenceText = parts.length
      ? `${parts.join('; ')}. These items should be tested against single-point-of-failure, lead-time, and spares assumptions to establish a credible BI duration range.`
      : `${services.length} critical service(s) and ${equipment.length} critical equipment record(s) are entered. Review these against single-point-of-failure and procurement lead-time assumptions.`;
  }

  // Backup power statement — influences both safety systems and process restart.
  // When occupancy implies refrigeration/cold-chain and no backup power is recorded,
  // make the consequence chain explicit.
  const powerText = noBackupPower
    ? (occupancyImpliesAmmonia || occupancyImpliesColdChain)
      ? 'No backup power provision is recorded. For a site with refrigeration and cold-chain operations, mains power loss triggers an immediate cascading failure: refrigeration plant stops, freezer and cold-store temperatures rise, product stock begins to deteriorate, and cold-chain integrity is broken. Backup power for refrigeration continuity is a direct determinant of stock loss quantum and effective business interruption duration.'
      : 'No backup power provision is recorded — this is a direct vulnerability for safety systems, suppression, and process control during a mains failure event.'
    : hasBackupPower
      ? 'Backup power provision is confirmed, supporting safety and critical process systems during mains disruption.'
      : '';

  // Cold-chain/refrigeration addendum — this is the main BI multiplier for food/pharma sites.
  // When explicit services/equipment records exist, name them. When only implied by occupancy,
  // the occupancy cross-reference in evidenceText already covers this — suppress the duplicate.
  const coldChainText = refrigerationItems.length > 0
    ? `Refrigeration/cold-chain dependencies are identified (${refrigerationItems.map((i: any) => String(i?.custom_label ?? i?.service_name ?? i?.equipment_name ?? '').trim() || 'unnamed item').slice(0, 3).join(', ')}). Cold-chain loss begins immediately on power or system failure — expected interruption duration and product-stock loss estimates must account for refrigeration reinstatement and thermal restabilisation time, not just physical repair.`
    : '';

  // Closing UW consequence — scaled to severity of identified weaknesses.
  const closingText = (noBackupPower || highCritWithLimitedRedundancy.length > 0 || refrigerationItems.length > 0)
    ? 'The identified utility dependencies are a direct determinant of maximum probable interruption duration and should be reflected in the loss expectancy assumptions for this site.'
    : 'For insurance purposes this section informs the credibility of stated indemnity periods and restart assumptions — utility dependencies constrain how quickly a site can resume operations after a major incident.';

  return [leadText, evidenceText, powerText, coldChainText, closingText].filter(Boolean).join(' ');
}

function buildManagementEngineeringInterpretation(module: ModuleInstance, breakdown: Breakdown, allModules: ModuleInstance[] = []): string {
  const rows = getManagementCategoryRows(module);
  const moduleRating = getRatingFromModule(module);
  // Use breakdown pillar only for display once state is determined from module data.
  const displayRating = moduleRating ?? (getRatingByKey(breakdown, 'management_systems') ?? resolveSectionRating(module, breakdown));

  // --- Occupancy signals (used to tailor maintenance commentary) ---
  let hasFryerOccupancy = false;
  let hasAmmoniaOccupancy = false;
  let hasColdChainOccupancy = false;
  if (allModules.length > 0) {
    const occupancyModule = allModules.find((m) => m.module_key === 'RE_03_OCCUPANCY');
    if (occupancyModule) {
      const od = (occupancyModule.data as any)?.occupancy || occupancyModule.data || {};
      const bodyText = [
        od?.industry_special_hazards_notes,
        od?.hazards_free_text,
        od?.process_description ?? od?.process_overview ?? od?.operations_description,
      ].filter(Boolean).join(' ').toLowerCase();
      hasFryerOccupancy = bodyText.includes('fryer') || bodyText.includes('frying') || bodyText.includes('deep fat') || bodyText.includes('deep-fat');
      hasAmmoniaOccupancy = bodyText.includes('ammonia') || bodyText.includes('refrigerat');
      hasColdChainOccupancy = bodyText.includes('freezer') || bodyText.includes('cold store') || bodyText.includes('cold chain') || bodyText.includes('chilled') || bodyText.includes('frozen');
    }
  }

  if (rows.length > 0) {
    // Full category-level assessment available.
    // Build typed category rows to compare individual controls against their actual scores.
    const management = (module.data as any)?.management || module.data || {};
    const categories: Array<{ key: string; label: string; rating: number }> = (
      Array.isArray(management.categories) ? management.categories : []
    ).map((c: any) => ({
      key: String(c?.key ?? '').toLowerCase(),
      label: formatIdentifierLabel(c?.label ?? c?.key ?? ''),
      rating: Number(c?.rating_1_5),
    })).filter((c: { key: string; label: string; rating: number }) => Number.isFinite(c.rating) && c.rating >= 1);

    const weakRows = rows.filter(([, r]) => Number(r) <= 2).map(([category]) => formatIdentifierLabel(category)).slice(0, 3);
    const goodRows = rows.filter(([, r]) => Number(r) >= 4).map(([category]) => formatIdentifierLabel(category)).slice(0, 2);

    const weakText = weakRows.length
      ? `Weaknesses requiring immediate management attention are: ${weakRows.join(', ')}.`
      : 'No management category is currently rated poor.';
    const strengthText = goodRows.length && !weakRows.length
      ? ` Relative strength is recorded in ${goodRows.join(' and ')}.`
      : '';

    // Determine whether large-loss controls (hot work, impairment) are genuinely weak or just generically important.
    const hotWorkCategory = categories.find((c) => c.key.includes('hot_work') || c.key.includes('hot work'));
    const impairmentCategory = categories.find((c) => c.key.includes('impairment'));
    const hotWorkWeak = hotWorkCategory ? hotWorkCategory.rating <= 2 : false;
    const impairmentWeak = impairmentCategory ? impairmentCategory.rating <= 2 : false;

    // Is maintenance a rated weakness? (drives occupancy-tailored commentary)
    const maintenanceWeak = categories.some((c) => (c.key.includes('mainten') || c.key.includes('maintenance')) && c.rating <= 2);

    let suffix: string;
    if (weakRows.length) {
      const largeLossControlsWeak = hotWorkWeak || impairmentWeak;
      // Only call out hot work / impairment as priority weaknesses if their scores justify it.
      // Where they are not weak, name them as important large-loss controls but not current deficiencies.
      const largeLossWeaknessClause = largeLossControlsWeak
        ? `${[hotWorkWeak ? 'Hot work controls' : null, impairmentWeak ? 'impairment management' : null].filter(Boolean).join(' and ')} are scored as weak — these categories directly govern the frequency and severity of preventable large-fire losses and warrant immediate corrective attention.`
        : `Hot work and impairment controls remain important large-loss controls, but the current scoring does not identify them as the primary management deficiency.`;

      // Occupancy-tailored maintenance clause — only relevant when maintenance is the key weakness.
      let maintenanceClause = '';
      if (maintenanceWeak) {
        const criticalSystems: string[] = [];
        if (hasFryerOccupancy) criticalSystems.push('fryer systems');
        if (hasFryerOccupancy || hasAmmoniaOccupancy || hasColdChainOccupancy) criticalSystems.push('electrical equipment');
        if (hasAmmoniaOccupancy || hasColdChainOccupancy) criticalSystems.push('refrigeration plant');
        criticalSystems.push('detection');
        if (hasFryerOccupancy || hasAmmoniaOccupancy) criticalSystems.push('localised protection');
        criticalSystems.push('shutdown controls');
        maintenanceClause = ` For this occupancy, maintenance quality is particularly important because ${joinList(criticalSystems)} are all loss-critical.`;
      }

      suffix = `${largeLossWeaknessClause}${maintenanceClause}`;
    } else {
      suffix = `Management controls are loss-frequency and loss-severity modifiers. Where no category is rated poor, the emphasis should be on sustaining evidence quality, audit cadence, and impairment discipline to prevent gradual erosion.`;
    }

    return `Engineering interpretation: Management systems score is ${formatScoreOutOfFive(displayRating)}. ${weakText}${strengthText} ${suffix}`;
  }

  // No category-level records — use module-level rating if present.
  if (moduleRating !== null && Number.isFinite(moduleRating)) {
    return `Engineering interpretation: Management systems are rated ${formatScoreOutOfFive(moduleRating)} based on the site-level management judgement. No category-level breakdown has been recorded. Management controls are loss-frequency and loss-severity modifiers that directly govern housekeeping, hot work, impairments, contractor activity, and emergency response reliability — a category-level assessment would enable a more precise underwriting view.`;
  }

  return 'Engineering interpretation: Management systems have not been assessed for this survey. Without a management rating, the assessment cannot quantify the extent to which procedural and governance controls are modifying the frequency or severity of preventable loss events.';
}

function buildLossValuesEngineeringInterpretation(module: ModuleInstance, _breakdown: Breakdown): string {
  const loss = getLossValuesSummary((module.data as any) || {});
  const currency = (module.data as any)?.currency ?? 'GBP';
  const fmt = (n: number) => n > 0 ? formatLossCurrency(n, currency) : null;

  // Property value summary — formatted for readability.
  const propParts = [
    loss.buildings     ? `buildings ${fmt(loss.buildings)}`            : null,
    loss.plantMachinery? `plant/machinery ${fmt(loss.plantMachinery)}` : null,
    loss.stock         ? `stock ${fmt(loss.stock)}`                    : null,
  ].filter(Boolean) as string[];
  const propText = propParts.length
    ? `Declared property values: ${propParts.join(', ')} (effective total ${fmt(loss.effectivePropertyTotal) ?? 'not stated'}).`
    : 'Property sums insured have not been fully declared.';

  // BI assessment.
  let biText: string;
  if (loss.grossProfitAnnual && loss.indemnityMonths) {
    const biMax = formatLossCurrency(loss.grossProfitAnnual * (loss.indemnityMonths / 12), currency);
    biText = `BI: gross profit ${fmt(loss.grossProfitAnnual)}, indemnity period ${loss.indemnityMonths} months (maximum BI exposure circa ${biMax}).`;
  } else if (loss.grossProfitAnnual) {
    biText = `BI gross profit is declared at ${fmt(loss.grossProfitAnnual)} but the indemnity period has not been stated — maximum BI exposure cannot be calculated.`;
  } else {
    biText = 'BI values or indemnity period assumptions are not fully evidenced — the BI exposure profile cannot be assessed.';
  }

  // Indemnity period adequacy — flag short periods relative to process-restart complexity.
  let indemnityFlag = '';
  if (loss.indemnityMonths > 0 && loss.indemnityMonths < 18) {
    indemnityFlag = `The stated indemnity period of ${loss.indemnityMonths} months should be reviewed against the reinstatement and restart complexity for this occupancy type. For sites with specialist process plant, cold-chain dependencies, or lengthy procurement lead times, periods under 18 months carry a material risk of under-insurance.`;
  } else if (loss.indemnityMonths >= 36) {
    indemnityFlag = `The ${loss.indemnityMonths}-month indemnity period indicates the assessor or client has recognised extended reinstatement or restart exposure — the loss expectancy scenarios should confirm the basis for this assumption.`;
  }

  // BI/PD ratio flag — a dominant BI relative to PD suggests high process sensitivity.
  let ratioFlag = '';
  if (loss.grossProfitAnnual > 0 && loss.effectivePropertyTotal > 0) {
    const biFullYear = loss.grossProfitAnnual;
    const ratio = biFullYear / loss.effectivePropertyTotal;
    if (ratio > 1.5) {
      ratioFlag = `Business interruption exposure (annual GP ${fmt(loss.grossProfitAnnual)}) is materially larger than the declared property sum insured — this profile indicates high process-sensitivity and suggests that controlling fire spread speed and enabling rapid restart are more material to total loss outcome than the property damage alone.`;
    }
  }

  // Closing — links financial data to engineering findings.
  const closing = loss.effectivePropertyTotal > 0 || loss.grossProfitAnnual > 0
    ? 'These values frame the financial materiality of the construction, fire-protection, and occupancy findings — loss expectancy percentages should be applied against the declared sums to translate engineering risk judgements into expected loss quantum.'
    : 'Without complete declared values, loss expectancy scenarios cannot be translated into financial quantum. Obtaining complete sums insured — including BI — is necessary before the engineering findings can be assessed for underwriting adequacy.';

  return [propText, biText, indemnityFlag, ratioFlag, closing].filter(Boolean).join(' ');
}

function buildFireProtectionEngineeringInterpretation(module: ModuleInstance, allModules: ModuleInstance[] = []): string {
  const fp = ((module.data as any)?.fire_protection || module.data || {}) as any;
  const buildings = Object.values((fp?.buildings || {}) as Record<string, any>);
  const water = fp?.site?.water || {};
  const reliability = formatDataValue(water?.water_reliability).toLowerCase();
  const reliabilityNarrative = reliability.includes('reliable')
    ? 'Water supply reliability appears broadly resilient'
    : reliability.includes('unreliable')
      ? 'Water supply reliability is a material weakness'
      : 'Water supply reliability is uncertain from submitted evidence';

  if (buildings.length === 0) {
    return `Engineering Interpretation: No building-level fire protection records have been entered for this module. Fixed-protection coverage, detection and localised protection cannot be quantified from submitted data. ${reliabilityNarrative}. Assessor narrative and any supplementary inputs should be reviewed to judge installed protection adequacy and suppression reliability.`;
  }

  // Classify by actual installation status — never infer from coverage percentages alone.
  const installedBuildings = buildings.filter((b: any) => {
    const s = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
    return s === 'Yes' || s === 'Partial';
  });
  const warrantedAbsent = buildings.filter((b: any) => {
    const s = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
    const w = String(b?.sprinklerData?.sprinklers_warranted ?? '').trim();
    return s === 'No' && w === 'Yes';
  });
  const localisedPresent = buildings.some(
    (b: any) => String(b?.sprinklerData?.localised_present ?? '').trim() === 'Yes'
  );
  const localisedMissing = buildings.filter(
    (b: any) => b?.sprinklerData?.localised_required === 'Yes' && b?.sprinklerData?.localised_present === 'No'
  ).length;

  // --- Cross-module risk signals (used to judge warranted status independently of the surveyor flag) ---
  // Construction: combustible panel construction, no/low compartmentation, large site area
  let hasCombustiblePanel = false;
  let hasNoCompartmentation = false;
  let largeAreaM2: number | null = null;
  if (allModules.length > 0) {
    const constructionModule = allModules.find((m) => m.module_key === 'RE_02_CONSTRUCTION');
    if (constructionModule) {
      const constr = (constructionModule.data as any)?.construction || constructionModule.data || {};
      const constrBuildings: any[] = getConstructionBuildings(constr);
      const perBldgText = constrBuildings
        .map((b: any) => [b?.roof_construction, b?.wall_construction, b?.construction_type, b?.primary_construction_type].filter(Boolean).join(' '))
        .join(' ');
      const flatConstrText = [
        constr?.wall_construction, constr?.roof_construction, constr?.primary_construction_type,
        constr?.cladding_description, constr?.site_notes, perBldgText,
      ].filter(Boolean).join(' ');
      const sandwichRx = /\b(pur|pir|phenolic|foam core|eps|xps)\b|\b(sandwich panels?|composite panels?|insulated panels?)\b/i;
      hasCombustiblePanel = sandwichRx.test(flatConstrText);
      const firstCB = constrBuildings[0];
      const compRaw = constr?.compartmentation_quality ?? firstCB?.compartmentation_quality ?? firstCB?.compartmentation ?? firstCB?.fire_compartmentation ?? firstCB?.compartmentation_minutes;
      const compMins = typeof compRaw === 'number' ? compRaw : null;
      const compStr = typeof compRaw === 'string' ? compRaw.trim().toLowerCase() : null;
      hasNoCompartmentation = compMins === 0 || compStr === 'low' || compStr === 'none' || compStr === 'no' || compStr === '0';
      const giaVals = constrBuildings.map((b: any) => b?.total_floor_area_m2).filter((v: any) => Number.isFinite(Number(v)));
      const totalGia = giaVals.length > 0 ? giaVals.reduce((s: number, v: any) => s + Number(v), 0) : null;
      const roofVals = constrBuildings.map((b: any) => b?.roof?.area_sqm ?? b?.roof_area_m2).filter((v: any) => Number.isFinite(Number(v)));
      const totalRoof = roofVals.length > 0 ? roofVals.reduce((s: number, v: any) => s + Number(v), 0) : 0;
      largeAreaM2 = totalGia ?? (totalRoof > 0 ? totalRoof : null);
    }
  }
  const hasLargeArea = largeAreaM2 !== null && largeAreaM2 >= 5000;
  // Occupancy: fryers/oil, ammonia refrigeration, cold-chain (BI multipliers)
  let hasFryerHazard = false;
  let hasAmmoniaHazard = false;
  let hasColdChainHazard = false;
  if (allModules.length > 0) {
    const occupancyModule = allModules.find((m) => m.module_key === 'RE_03_OCCUPANCY');
    if (occupancyModule) {
      const od = (occupancyModule.data as any)?.occupancy || occupancyModule.data || {};
      const bodyText = [
        od?.industry_special_hazards_notes,
        od?.hazards_free_text,
        od?.process_description ?? od?.process_overview ?? od?.operations_description,
      ].filter(Boolean).join(' ').toLowerCase();
      hasFryerHazard = bodyText.includes('fryer') || bodyText.includes('frying') || bodyText.includes('deep fat') || bodyText.includes('deep-fat');
      hasAmmoniaHazard = bodyText.includes('ammonia') || bodyText.includes('refrigerat');
      hasColdChainHazard = bodyText.includes('freezer') || bodyText.includes('cold store') || bodyText.includes('cold chain') || bodyText.includes('chilled') || bodyText.includes('frozen');
    }
  }
  // FP own score — if supplementary_assessment overall score ≤ 1, protection is objectively weak
  const fpSupplementaryScore = Number(fp?.supplementary_assessment?.overall_score);
  const hasWeakFpScore = Number.isFinite(fpSupplementaryScore) && fpSupplementaryScore <= 1;
  // Risk profile warrants automatic sprinkler protection if ANY material indicator is present.
  // This overrides a surveyor-level "not warranted" flag when the risk evidence says otherwise.
  const riskProfileWarrantsProtection =
    hasCombustiblePanel || hasNoCompartmentation || hasLargeArea ||
    hasFryerHazard || hasAmmoniaHazard || hasColdChainHazard || hasWeakFpScore;

  const parts: string[] = [];

  if (installedBuildings.length > 0) {
    const reqCount = installedBuildings.filter(
      (b: any) => Number(b?.sprinklerData?.sprinkler_coverage_required_pct) > 0
    ).length;
    parts.push(
      `${installedBuildings.length} of ${buildings.length} building(s) have automatic sprinkler systems installed; ${reqCount} show a stated coverage requirement.`
    );
  }

  if (warrantedAbsent.length > 0) {
    parts.push(
      `${warrantedAbsent.length} building(s) have no automatic sprinklers installed. Protection is considered warranted based on the assessed hazard profile — this represents a material protection deficiency.`
    );
  }

  if (installedBuildings.length === 0 && warrantedAbsent.length === 0) {
    // All buildings are either not warranted or status unknown
    const unknownCount = buildings.filter((b: any) => {
      const s = String(b?.sprinklerData?.sprinklers_installed ?? '').trim();
      return s === 'Unknown' || s === '';
    }).length;
    if (unknownCount === buildings.length) {
      parts.push(`Sprinkler status unknown across ${buildings.length} building(s). Clarify installation status to enable a protection coverage assessment.`);
    } else if (riskProfileWarrantsProtection) {
      // Risk signals override the surveyor's "not warranted" assessment —
      // state the absence and the material weakness directly.
      const riskFactors: string[] = [];
      if (hasCombustiblePanel) riskFactors.push('combustible insulated panel construction');
      if (hasNoCompartmentation) riskFactors.push('the absence of effective fire compartmentation');
      if (hasLargeArea && largeAreaM2 !== null) riskFactors.push(`large uncompartmented fire area (${formatDataValue(largeAreaM2)} m²)`);
      if (hasFryerHazard) riskFactors.push('fryer/oil process hazards');
      if (hasAmmoniaHazard) riskFactors.push('ammonia refrigeration dependency');
      if (hasColdChainHazard && !hasAmmoniaHazard) riskFactors.push('cold-chain and freezer dependency');
      if (hasWeakFpScore) riskFactors.push('low overall fire protection score');
      const factorList = riskFactors.length > 0
        ? `Given ${riskFactors.join(', ')}, `
        : '';
      parts.push(
        `Automatic sprinkler protection is not installed. ${factorList}the absence of automatic sprinkler protection is a material loss-control weakness for this site.`
      );
      if (localisedPresent) {
        parts.push(
          'Localised protection is recorded for special hazards, but this should not be treated as equivalent to building-wide automatic suppression. Localised systems are designed to control a specific process hazard at source — they do not provide the area-coverage needed to intercept a developing fire that has spread beyond the initial hazard zone.'
        );
      }
      parts.push(
        'Reliance is therefore placed on detection, localised systems, emergency response and fire service intervention, with limited ability to control a developed fire'
        + (hasCombustiblePanel ? ' involving combustible panel construction.' : ' at this site.')
      );
    } else {
      parts.push(`Automatic sprinkler protection is not installed across ${buildings.length} building(s). Sprinklers are not considered warranted for the assessed occupancy and construction profile.`);
    }
  }

  parts.push(`${reliabilityNarrative}.`);

  if (localisedMissing > 0) {
    parts.push(`Localised/special protection gaps are identified in ${localisedMissing} building(s) — these should be prioritised where high-value plant, hazardous processes or high-challenge fuels are present, as localised systems are the last line of defence before general-area escalation.`);
  }

  // Closing — varies by dominant protection status to name the specific UW exposure.
  if (warrantedAbsent.length > 0 && installedBuildings.length === 0) {
    // All buildings lack warranted suppression — most severe scenario.
    parts.push('The absence of warranted suppression is the primary underwriting exposure for this site. An unchecked fire in this occupancy profile would be expected to develop to full area involvement before effective manual intervention is achievable, with direct damage likely to approach or exceed the maximum foreseeable loss.');
  } else if (warrantedAbsent.length > 0) {
    // Mixed — some installed, some warranted-absent.
    parts.push('The warranted-absent buildings represent material protection gaps within the overall site — a fire originating in or spreading to an unprotected area would not benefit from the suppression installed elsewhere.');
  } else if (installedBuildings.length > 0) {
    // All buildings have systems — focus on reliability and coverage.
    parts.push('Where suppression is installed, the underwriting concern shifts from presence to performance: ITM quality, water supply resilience and impairment governance are the controls that determine whether the system operates as rated under a severe, real-event demand.');
  }

  return `Engineering Interpretation: ${parts.join(' ')}`;
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
  // Compartmentation — read from the same field resolution used by the Section Snapshot.
  const firstBuilding = buildings[0];
  const compartmentationRaw =
    construction?.compartmentation_quality ??
    firstBuilding?.compartmentation_quality ??
    firstBuilding?.compartmentation ??
    firstBuilding?.fire_compartmentation ??
    firstBuilding?.compartmentation_minutes;
  const compartmentationMins = typeof compartmentationRaw === 'number' ? compartmentationRaw : null;
  const compartmentationStr = typeof compartmentationRaw === 'string' ? compartmentationRaw.trim().toLowerCase() : null;
  const noEffectiveCompartmentation =
    compartmentationMins === 0 ||
    compartmentationStr === 'low' ||
    compartmentationStr === 'none' ||
    compartmentationStr === 'no' ||
    compartmentationStr === '0 min' ||
    compartmentationStr === '0';
  const areaRef = context.totalFloorArea !== null
    ? `${formatDataValue(context.totalFloorArea)} m² GIA`
    : context.totalRoofArea > 0
      ? `${formatDataValue(context.totalRoofArea)} m² (roof area)`
      : null;
  const mezzSuffix = context.totalMezzArea > 0
    ? ` Mezzanine construction (${formatDataValue(context.totalMezzArea)} m²) adds a multi-level spread vector within the same uncompartmented envelope.`
    : '';
  const compartmentationText = noEffectiveCompartmentation
    ? `No effective fire compartmentation is recorded for this site.${areaRef ? ` The recorded site area of ${areaRef} therefore represents a single uncontrolled fire zone — lateral fire and smoke spread are constrained only by the suppression system and response time.` : ''}${mezzSuffix}`
    : compartmentationRaw !== null && compartmentationRaw !== undefined
      ? `Compartmentation is recorded as ${normalizeCompartmentationLabel(compartmentationRaw)}.`
      : '';
  const claddingPresentCount = buildings.filter((building: any) => resolveCladdingDescriptor(building).toLowerCase().startsWith('yes')).length;
  // Detect combustible material references in flat construction text fields.
  // These fields capture site-level construction notes that often name specific materials
  // (PUR, phenolic, sandwich panels) that are combustible regardless of how the surveyor
  // classified the per-building cladding_present flag.
  // Note: the regex uses `s?` to match both singular ("panel") and plural ("panels").
  const COMBUSTIBLE_KEYWORDS = /\b(pur|pir|phenolic|eps|xps|polystyrene|foam core)\b|\b(sandwich panels?|composite panels?|insulated panels?|metal[\s-]faced)\b/i;
  // Also aggregate per-building roof/wall construction material descriptions so that
  // PUR/phenolic text stored in building-level fields (not module-level flat fields)
  // is picked up by the combustible-keyword test below.
  const perBuildingConstructionText = buildings
    .map((b: any) => [
      b?.roof_construction ?? b?.roof?.construction_desc ?? b?.roof?.construction_type,
      b?.wall_construction ?? b?.walls?.construction_desc ?? b?.walls?.construction_type,
      b?.construction_type ?? b?.primary_construction_type,
    ].filter(Boolean).join(' '))
    .join(' ');
  const flatConstructionText = [
    construction?.wall_construction,
    construction?.roof_construction,
    construction?.primary_construction_type,
    construction?.cladding_description,
    construction?.site_notes,
    perBuildingConstructionText || undefined,
  ].filter(Boolean).join(' ');
  const flatTextIndicatesCombustible = COMBUSTIBLE_KEYWORDS.test(flatConstructionText);
  // Identify PUR/PIR/phenolic sandwich-panel systems specifically — highest concealed-spread risk.
  const sandwichPanelKeywords = /\b(pur|pir|phenolic|foam core|eps|xps)\b|\b(sandwich panels?|composite panels?|insulated panels?)\b/i;
  const sandwichPanelInDescription = sandwichPanelKeywords.test(flatConstructionText);
  // --- External cladding statement ---
  // This is based solely on the dedicated per-building cladding-present boolean flag
  // (combustible_cladding.present / cladding_present). It refers specifically to
  // combustible external façade/cladding systems (e.g. ACM/EWI retrofits), not to
  // the primary construction material of the building envelope.
  // "Not assessed" is materially different from "confirmed absent" — do not state
  // "no combustible cladding" unless the surveyor has explicitly confirmed absence.
  const externalCladdingText = claddingPresentCount > 0
    ? `Combustible external cladding systems are confirmed on ${claddingPresentCount} of ${context.buildingCount} building(s).`
    : context.buildingCount > 0
      // Regardless of keyword detection, the non-reducing statement is always the correct
      // insurer risk-engineering language when no external cladding system has been confirmed.
      ? 'No separate combustible external cladding system has been recorded. This does not reduce the primary construction concern, which arises from the recorded combustible insulated panel roof and wall construction within a large uncompartmented building envelope.'
      : 'Building-level records are not available; combustible external cladding status has not been assessed.';

  // --- Insulated sandwich panel construction ---
  // Sandwich panel construction (PUR/PIR/phenolic foam-core panels used as the primary
  // building envelope — roof and walls) is a distinct engineering issue from external cladding.
  // It is identified from construction material descriptions, not from the cladding flag.
  const sandwichPanelText = sandwichPanelInDescription
    ? 'The building envelope incorporates insulated sandwich panel systems (PUR/PIR and/or phenolic foam-core panels). Sandwich panel construction presents a distinct fire risk independent of external cladding status: combustion within the panel core can propagate concealed from view and detectors, producing dense toxic smoke and rapid structural degradation. Panel-core fires are not reliably controlled by conventional suppression and may require specialist intervention to access the burning core. Reinstatement of damaged sandwich panel structures requires specialist contractors and extended lead times, materially prolonging the business interruption period beyond physical repair timescales.'
    : flatTextIndicatesCombustible
      ? 'Construction descriptions reference materials with combustible components; the extent of combustible construction should be confirmed in per-building records.'
      : '';
  const giaText = context.totalFloorArea !== null
    ? `total floor area (GIA) ${formatDataValue(context.totalFloorArea)} m²`
    : `roof area ${formatDataValue(context.totalRoofArea)} m²`;
  const mezzNote = context.totalMezzArea > 0
    ? `, mezzanine / upper floor area ${formatDataValue(context.totalMezzArea)} m² (elevated fire-load and multi-level spread exposure)`
    : '';
  const geometryText = `Recorded geometry: ${giaText}${mezzNote} across ${context.buildingCount} building(s).`;
  // Closing: UW consequence statement — references sandwich panel risk when detected.
  const constructionConsequence = sandwichPanelInDescription
    ? 'The primary underwriting consequence is elevated fire spread velocity due to concealed panel-core propagation, smoke-contamination scope extending well beyond the immediate area of origin, and disproportionate reinstatement complexity relative to the apparent damage quantum.'
    : claddingPresentCount > 0
      ? 'The primary underwriting consequence is elevated fire spread velocity, smoke-contamination scope extending beyond directly damaged areas, and disproportionate reinstatement complexity relative to initial ignition size.'
      : scoreBand.resilienceLabel === 'weaker'
        ? 'The primary underwriting consequence is elevated escalation risk and non-trivial reinstatement complexity under a severe fire scenario.'
        : 'The underwriting relevance is reinstatement complexity and business interruption duration — both are sensitive to frame type, compartment integrity, and roof construction performance under fire conditions.';
  const panelSection = sandwichPanelText ? ` ${sandwichPanelText}` : '';
  const compartmentSection = compartmentationText ? ` ${compartmentationText}` : '';
  return `Engineering Interpretation: Site construction score is ${scoreText} (${scoreBand.label}). ${scoreBand.constructionImplication} Site combustible proportion is ${combustibleText}. ${geometryText}${compartmentSection} ${externalCladdingText}${panelSection} ${constructionConsequence}`;
}

function buildExecutiveSignificanceNarrative(breakdown: Breakdown): { level: SignificanceLevel; narrative: string } {
  const percent = breakdown.maxScore > 0 ? (breakdown.totalScore / breakdown.maxScore) * 100 : 0;
  const level = levelFromPercent(percent);
  const industryLabel = breakdown.industryLabel.toLowerCase();
  // Build the drivers clause from top contributors (up to 3 for the significance narrative).
  const drivers = breakdown.topContributors.slice(0, 3).map(t => t.label.toLowerCase());
  const driversClause = drivers.length > 0 ? joinList(drivers) : 'the assessed engineering pillars';
  const narrative =
    `The site achieves ${percent.toFixed(0)}% of the available weighted risk-control score for the ${industryLabel} benchmark, resulting in a ${level} overall risk rating. ` +
    `The ${level} rating is driven principally by ${driversClause}.`;
  return { level, narrative };
}

export function sectionSignificance(module: ModuleInstance, breakdown: Breakdown, allModules: ModuleInstance[] = []): { level: SignificanceLevel; narrative: string } | null {
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
    const data = module.data as any;
    const services = Array.isArray(data?.critical_services) ? data.critical_services : [];
    const equipment = Array.isArray(data?.critical_equipment) ? data.critical_equipment : [];
    const noBackupPower = data?.power_resilience?.backup_power_present === false;
    const highCriticalityServices = services.filter((entry: any) => String(entry?.criticality || '').toLowerCase() === 'high').length;
    const weakCriticalityEquipment = equipment.filter((entry: any) => (
      String(entry?.criticality || '').toLowerCase() === 'high' &&
      (String(entry?.redundancy || '').toLowerCase() === 'n+0' || String(entry?.redundancy || '').toLowerCase() === 'unknown')
    )).length;

    // When no formal utility records exist, cross-reference the occupancy module to detect
    // inferred dependencies. An empty utility register for a site with refrigeration, cold-chain
    // and fryer-line occupancy is an information gap, not evidence of low dependency.
    const hasNoRecords = services.length === 0 && equipment.length === 0;
    let inferredAmmonia = false;
    let inferredColdChain = false;
    let inferredFryers = false;
    if (hasNoRecords && allModules.length > 0) {
      const occupancyModule = allModules.find((m) => m.module_key === 'RE_03_OCCUPANCY');
      if (occupancyModule) {
        const od = (occupancyModule.data as any)?.occupancy || occupancyModule.data || {};
        const bodyText = [
          od?.industry_special_hazards_notes,
          od?.hazards_free_text,
          od?.process_description ?? od?.process_overview ?? od?.operations_description,
        ].filter(Boolean).join(' ').toLowerCase();
        inferredAmmonia = bodyText.includes('ammonia') || bodyText.includes('refrigerat');
        inferredColdChain = bodyText.includes('freezer') || bodyText.includes('cold store')
          || bodyText.includes('cold chain') || bodyText.includes('chilled') || bodyText.includes('frozen');
        inferredFryers = bodyText.includes('fryer') || bodyText.includes('frying') || bodyText.includes('deep fat') || bodyText.includes('deep-fat');
      }
    }
    const hasInferredDependencies = inferredAmmonia || inferredColdChain || inferredFryers;

    let level: SignificanceLevel;
    let narrative: string;

    if (hasNoRecords && hasInferredDependencies) {
      // Treat as High significance — inferred critical dependencies from occupancy profile.
      level = 'High';
      const inferredItems: string[] = [];
      if (inferredAmmonia) inferredItems.push('ammonia refrigeration');
      if (inferredColdChain && !inferredAmmonia) inferredItems.push('cold storage');
      else if (inferredColdChain) inferredItems.push('cold storage');
      if (inferredFryers) inferredItems.push('fryer-line utilities');
      inferredItems.push('power supply');
      const inferredList = joinList(inferredItems);
      const backupPowerClause = noBackupPower
        ? ' No backup power provision is recorded.'
        : '';
      narrative = `No formal critical service or critical equipment records have been entered in the utilities section. However, the occupancy description identifies material dependencies on ${inferredList}. The absence of structured resilience records should therefore be treated as an information gap, not as evidence of low dependency.${backupPowerClause} Structured critical-services records are required to support credible maximum probable interruption duration estimates.`;
    } else {
      level = (noBackupPower || weakCriticalityEquipment > 0) ? 'High' : levelFromRating(rating);
      narrative = `Utilities resilience is informed by ${services.length} critical service record(s) and ${equipment.length} critical equipment record(s), with ${highCriticalityServices} service(s) and ${weakCriticalityEquipment} equipment item(s) recorded as high criticality with limited/uncertain redundancy. Backup power is ${formatDataValue(data?.power_resilience?.backup_power_present).toLowerCase()}. This profile is a direct indicator of restart dependence and interruption duration following a major incident.`;
    }

    return { level, narrative };
  }

  if (module.module_key === 'RE_09_MANAGEMENT') {
    const management = (module.data as any)?.management || module.data || {};
    const categories = Array.isArray(management.categories) ? management.categories : [];
    // Use only the module's own stored rating to determine state — the breakdown
    // pillar is layout data and must not promote an "unassessed" module to "site-level rated".
    const moduleRating = getRatingFromModule(module);
    // Once we have a confirmed state we can augment display with breakdown data.
    const displayRating = moduleRating ?? breakdown.globalPillars.find(p => p.key === 'management_systems')?.rating;

    if (categories.length > 0) {
      // Full category breakdown recorded.
      const weakerControls = categories
        .filter((category: any) => Number(category?.rating_1_5) > 0 && Number(category?.rating_1_5) <= 2)
        .map((category: any) => formatDataValue(category?.label ?? category?.key));
      const level = levelFromRating(displayRating);
      const narrative = `Management systems are rated ${formatScoreOutOfFive(displayRating)} across ${categories.length} category assessment(s). ${weakerControls.length > 0 ? `Lower-scored controls are concentrated in ${weakerControls.slice(0, 3).join(', ')}.` : 'No materially weak management category ratings are recorded.'} Governance quality controls how consistently permitting, impairment, housekeeping and emergency processes reduce both incident likelihood and post-loss severity.`;
      return { level, narrative };
    }

    if (moduleRating !== null && Number.isFinite(moduleRating)) {
      // Site-level rating recorded on the module, no category breakdown.
      const level = levelFromRating(moduleRating);
      const narrative = `Management systems are rated ${formatScoreOutOfFive(moduleRating)} based on the site-level management judgement. No category-level breakdown has been recorded. Governance quality controls how consistently permitting, impairment, housekeeping and emergency processes reduce both incident likelihood and post-loss severity.`;
      return { level, narrative };
    }

    // Neither category assessments nor module-level site rating available.
    return { level: 'Moderate', narrative: 'Management systems have not been assessed for this survey. No category-level or site-level management rating is recorded.' };
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

async function fetchEvidenceImageBytes(
  storagePath: string,
  bytesCache?: Map<string, Promise<Uint8Array | null>>
): Promise<Uint8Array | null> {
  const cached = bytesCache?.get(storagePath);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from('evidence')
        .createSignedUrl(storagePath, 300);
      if (error || !data?.signedUrl) {
        if (import.meta.env.DEV) console.warn('[PDF RE Survey] Failed to sign evidence asset:', storagePath, error);
        return null;
      }
      const response = await fetch(data.signedUrl);
      if (!response.ok) {
        if (import.meta.env.DEV) console.warn('[PDF RE Survey] Failed to fetch evidence asset:', storagePath, response.status);
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[PDF RE Survey] Error loading evidence asset:', storagePath, error);
      return null;
    }
  })();

  if (bytesCache) bytesCache.set(storagePath, promise);
  return promise;
}

async function embedEvidenceImage(
  pdfDoc: PDFDocument,
  storagePath: string,
  cache?: {
    bytes: Map<string, Promise<Uint8Array | null>>;
    embedded: Map<string, Promise<any | null>>;
  }
) {
  const cached = cache?.embedded.get(storagePath);
  if (cached) return cached;

  const promise = (async () => {
    const bytes = await fetchEvidenceImageBytes(storagePath, cache?.bytes);
    if (!bytes) return null;
    if (/\.png$/i.test(storagePath)) {
      return pdfDoc.embedPng(bytes);
    }
    return pdfDoc.embedJpg(bytes);
  })();

  cache?.embedded.set(storagePath, promise);
  return promise;
}

/**
 * Join a list with Oxford comma and "and" before the last item.
 * ["a"] → "a"
 * ["a", "b"] → "a and b"
 * ["a", "b", "c"] → "a, b, and c"
 */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Factor-key prefixes that always warrant P1 priority regardless of the stored priority_band.
// This corrects legacy records created before the HIGH_PRIORITY_FACTOR_PREFIXES list was complete.
// Returns 'P1' (not 'High') so that priority is consistent with all other recommendations in
// the register, which use P1/P2/P3/P4 via the DocumentPreviewPage priorityToBand mapping.
const HIGH_PRIORITY_RENDER_PREFIXES = [
  're06_fp_sprinklers_warranted_absent',
  're06_fp_adequacy_fixed_protection',   // covers _required, _required_provided, _provided, etc.
  're06_fp_adequacy_fixed_protection_required',
  're06_fp_localised_required_installation',
];

function resolveRecommendationPriority(action: Action): string {
  const fk = action.source_factor_key || '';
  if (fk && HIGH_PRIORITY_RENDER_PREFIXES.some((prefix) => fk.startsWith(prefix))) {
    return 'P1';
  }
  return String(action.priority_band || 'Not provided');
}

// Stale wording signatures that pre-date factor-specific fallback improvements.
// When detected, the current FACTOR_SPECIFIC_FALLBACKS text is substituted at render time.
const STALE_ACTION_TEXT_PREFIXES = [
  OLD_GENERIC_ACTION_PREFIX,
  // re06_fp_localised_required_provided wording updated to verification-focused in 2026-06-09
  // audit — old "Provide or improve" text is no longer appropriate when protection is present.
  'Provide or improve localised/special hazard protection for identified hazards',
];

function getRecommendationBodyText(action: Action): string {
  const stored = action.action_required_text || action.recommended_action || action.description || action.title;
  // Detect stale wording patterns. If a factor key is present, substitute the current specific
  // fallback text so the PDF always shows the best available wording — the DB record is untouched.
  const isStale =
    (typeof stored === 'string' && STALE_ACTION_TEXT_PREFIXES.some((prefix) => stored.startsWith(prefix))) ||
    (action.hazard_text === OLD_GENERIC_HAZARD_TEXT);
  if (isStale && action.source_factor_key) {
    const fallback = resolveFactorFallback(action.source_factor_key);
    if (fallback?.action_required_text) return fallback.action_required_text;
  }
  return String(stored || 'Not provided');
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
  if (import.meta.env.DEV) console.log('[PDF RE Survey] Starting RE Survey PDF build');
  const { moduleInstances, actions, organisation, renderMode, selectedModules, applyTrialWatermark } = options;
  const document = {
    ...options.document,
    assessor_name: resolvePdfPreparedByName(options.preparedByName, organisation?.name),
  };

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isIssuedMode = renderMode === 'issued';
  const isDraft = !isIssuedMode;
  const totalPages: PDFPage[] = [];

  if (import.meta.env.DEV) console.log('[PDF RE Survey] Render mode:', isIssuedMode ? 'ISSUED' : 'DRAFT');

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
  const modulesById = new Map(moduleInstances.map((m) => [m.id, m]));
  const re10SitePhotosModule = modulesByKey.get('RE_10_SITE_PHOTOS');

  // ─── P3: Attachment-first evidence resolution ─────────────────────────────
  //
  // RE-10 photos and site plan are read from the `attachments` table (primary)
  // with a JSONB fallback for documents where the P1 backfill migration has not
  // been run or where uploads pre-date the P2-A.2 migration.
  //
  // Recommendation evidence counts use JSONB action.photos (accurate per-rec)
  // with an attachment-row count as a safety fallback when JSONB is absent.
  // ─────────────────────────────────────────────────────────────────────────

  // Unique module instance IDs from recommendations (for count fallback query).
  const recModuleInstanceIds = [
    ...new Set(
      currentSurveyRecommendations
        .map((a) => a.module_instance_id)
        .filter((id): id is string => !!id),
    ),
  ];

  // Batch-fetch all relevant attachment rows in a single query.
  const attFetchIds: string[] = [];
  const re10ModuleId = re10SitePhotosModule?.id;
  if (re10ModuleId) attFetchIds.push(re10ModuleId);
  attFetchIds.push(...recModuleInstanceIds);

  let allModuleAttachments: Array<{
    id: string;
    file_path: string;
    file_name: string;
    caption: string | null;
    created_at: string;
    module_instance_id: string | null;
  }> = [];
  if (attFetchIds.length > 0) {
    const { data: attData } = await supabase
      .from('attachments')
      .select('id, file_path, file_name, caption, created_at, module_instance_id')
      .in('module_instance_id', attFetchIds)
      .is('deleted_at', null);
    allModuleAttachments = attData || [];
  }

  // ─── RE-10: photos + site plan (attachment-first, JSONB fallback) ─────────
  const SITE_PLAN_PREFIX = 'site_plan_';
  const re10Attachments = re10ModuleId
    ? allModuleAttachments.filter((a) => a.module_instance_id === re10ModuleId)
    : [];

  let sitePhotos: ReSurveySitePhoto[];
  let sitePlan: ReSurveySitePlan | null;
  let sitePlanPath: string | null;

  if (re10Attachments.length > 0) {
    // Primary: attachments table (P2-A.2+ uploads and P1 backfill).
    const photoAtts = re10Attachments.filter((a) => !a.file_name.startsWith(SITE_PLAN_PREFIX));
    const planAtts = [...re10Attachments.filter((a) => a.file_name.startsWith(SITE_PLAN_PREFIX))].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    sitePhotos = photoAtts
      .map((a) => ({ storage_path: a.file_path, caption: a.caption ?? '' }))
      .filter((p) => isSupportedImagePath(p.storage_path ?? ''));

    const planAtt = planAtts[0] ?? null;
    sitePlan = planAtt
      ? { storage_path: planAtt.file_path, description: planAtt.caption ?? '', uploaded_at: planAtt.created_at }
      : null;
    sitePlanPath = planAtt && isSupportedImagePath(planAtt.file_path) ? planAtt.file_path : null;
  } else {
    // Fallback: JSONB mirror (pre-P2 docs or P1 backfill not yet run).
    const re10JsonbData = (re10SitePhotosModule?.data || {}) as Record<string, unknown>;
    sitePhotos = Array.isArray(re10JsonbData.photos)
      ? (re10JsonbData.photos as ReSurveySitePhoto[])
        .map((photo) => ({
          storage_path: photo?.storage_path,
          caption: typeof photo?.caption === 'string' ? photo.caption : '',
          description: typeof photo?.description === 'string' ? photo.description : '',
          notes: typeof photo?.notes === 'string' ? photo.notes : '',
          metadata: photo?.metadata,
        }))
        .filter((photo) => !!photo.storage_path && isSupportedImagePath(String(photo.storage_path)))
      : [];
    sitePlan = ((re10JsonbData.site_plan || null) as ReSurveySitePlan | null);
    sitePlanPath = sitePlan?.storage_path && isSupportedImagePath(sitePlan.storage_path)
      ? sitePlan.storage_path
      : null;
  }

  // ─── Recommendations: attachment count fallback ───────────────────────────
  // JSONB action.photos is the per-recommendation accurate primary source.
  // The attachment map is used only when JSONB photos are absent (safety net
  // for recs where the upload succeeded but the save did not complete).
  const recAttachmentCounts = new Map<string, number>();
  for (const att of allModuleAttachments) {
    if (att.module_instance_id && recModuleInstanceIds.includes(att.module_instance_id)) {
      recAttachmentCounts.set(
        att.module_instance_id,
        (recAttachmentCounts.get(att.module_instance_id) ?? 0) + 1,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  const evidenceImageCache = {
    bytes: new Map<string, Promise<Uint8Array | null>>(),
    embedded: new Map<string, Promise<any | null>>(),
  };
  const evidencePaths = Array.from(
    new Set([
      ...sitePhotos.map((photo) => String(photo.storage_path || '')).filter(Boolean),
      ...(sitePlanPath ? [sitePlanPath] : []),
    ])
  );
  if (evidencePaths.length > 0) {
    await Promise.all(evidencePaths.map((path) => embedEvidenceImage(pdfDoc, path, evidenceImageCache)));
  }
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
  // docControlPage was physically created immediately after coverPage by addIssuedReportPages.
  // Push it here so totalPages order matches the physical PDF page order.
  totalPages.push(docControlPage);
  sectionStartPages.set('Document Control', totalPages.length);

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
      ['Report type', 'Risk Engineering Survey Report'],
      ...(document.title && !/^untitled/i.test(document.title.trim()) ? [['Survey title', formatValue(document.title)] as Row] : []),
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
    const suppressSectionSnapshot = module.module_key === 'RE_08_UTILITIES' || module.module_key === 'RE_09_MANAGEMENT' || module.module_key === 'RE_12_LOSS_VALUES';
    const tableRows = suppressSectionSnapshot ? [] : getSectionTableRows(module, { breakdown, linkedRecommendationCount });
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
      // Resolve process overview text — do NOT fall back to occupancy_type here because
      // occupancy_type is separately rendered in the structured fields table below.
      // Falling back would produce a verbatim duplicate of that row.
      const processOverviewText = formatDataValue(
        (module.data as any)?.occupancy?.process_overview ??
        (module.data as any)?.occupancy?.process_description ??
        (module.data as any)?.occupancy?.operations_description ??
        (module.data as any)?.occupancy?.process_use_overview ??
        (module.data as any)?.occupancyProductsServices ??
        (module.data as any)?.activityOverview
      );
      const hasProcessOverview = processOverviewText && processOverviewText !== 'Data not provided' && processOverviewText !== 'Not provided';
      if (hasProcessOverview) {
        ({ page, yPosition } = ensurePageSpace(100 + occupancyRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Inputs — Process / use overview', fontBold);
        yPosition = drawParagraph(page, yPosition, processOverviewText, font);
        yPosition = sectionBreak(yPosition, 12);
      } else {
        ({ page, yPosition } = ensurePageSpace(100 + occupancyRows.length * 20, page, yPosition, pdfDoc, isDraft, totalPages));
      }
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
      const hydraulicTable = getFireProtectionDesignHydraulicTable(module);
      const hydraulicRows = cleanFireProtectionRows(hydraulicTable.rows);
      if (hydraulicRows.length > 0 && hydraulicTable.headers.length > 1) {
        ({ page, yPosition } = ensurePageSpace(92 + hydraulicRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Fire Protection — Design / Hydraulic Inputs', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, hydraulicTable.headers, hydraulicRows, { regular: font, bold: fontBold }, {
          colWidths: hydraulicTable.colWidths,
          fontSize: 7.5,
          minRowHeight: 18,
          wrapHeader: true,
          headerMinRowHeight: 22,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
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
      const waterSupplyRows = cleanFireProtectionRows(getFireProtectionWaterSupplyRows(module));
      if (waterSupplyRows.length > 0) {
        yPosition = sectionBreak(yPosition, 8);
        yPosition = drawBlockHeading(page, yPosition, 'Water Supply Details', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Supply', 'Type', 'Capacity (m³)'], waterSupplyRows, { regular: font, bold: fontBold }, {
          colWidths: [70, 220, CONTENT_WIDTH - 290],
          fontSize: 8,
          minRowHeight: 18,
          wrapHeader: true,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
      }
      const firePumpTable = getFireProtectionPumpTable(module);
      const firePumpRows = cleanFireProtectionRows(firePumpTable.rows);
      if (firePumpRows.length > 0) {
        yPosition = sectionBreak(yPosition, 8);
        yPosition = drawBlockHeading(page, yPosition, 'Fire Pump Details', fontBold);
        const hasDriverType = firePumpTable.headers.includes('Driver type');
        ({ page, yPosition } = drawSimpleTable(page, yPosition, firePumpTable.headers, firePumpRows, { regular: font, bold: fontBold }, {
          colWidths: hasDriverType ? [55, 90, 115, 110, CONTENT_WIDTH - 370] : [70, 140, 140, CONTENT_WIDTH - 350],
          fontSize: 8,
          minRowHeight: 18,
          wrapHeader: true,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
      }
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
      if (exposuresRows.length > 0) {
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
      const managementRows = getManagementCategoryRows(module);
      if (managementRows.length > 0) {
        ({ page, yPosition } = ensurePageSpace(100 + managementRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Category ratings and notes', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Category', 'Rating (1-5)', 'Notes'], managementRows, { regular: font, bold: fontBold }, {
          colWidths: [130, 80, CONTENT_WIDTH - 210],
          fontSize: 8.5,
          minRowHeight: 18,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        yPosition = sectionBreak(yPosition);
      } else {
        // No category breakdown — show a note so the reader understands the basis for any rating.
        const mgmtSiteRating = getRatingFromModule(module);
        const mgmtNote = (mgmtSiteRating !== null && Number.isFinite(mgmtSiteRating))
          ? `Management Systems rated ${formatScoreOutOfFive(mgmtSiteRating)} — site-level judgement only. No category-level assessment has been recorded.`
          : 'Management Systems — no category assessments or site-level rating recorded.';
        ({ page, yPosition } = ensurePageSpace(60, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawParagraph(page, yPosition, mgmtNote, font);
        yPosition = sectionBreak(yPosition);
      }
    }

    if (module.module_key === 'RE_12_LOSS_VALUES') {
      const d12 = module.data || {};
      const currency12 = (d12 as any)?.currency ?? 'GBP';
      const sumsInsured12 = (d12 as any)?.sums_insured as LossCalcSumsInsured | undefined;
      const otherLabel12 = (d12 as any)?.sums_insured?.property_damage?.other_label as string | undefined;

      // ── Declared Values Summary ───────────────────────────────────────────
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

      // ── WLE ───────────────────────────────────────────────────────────────
      const wleRows = getLossExpectancyRows(module, 'wle');
      const wleCalc = calculateScenarioLoss(sumsInsured12, (d12 as any)?.wle, otherLabel12);
      ({ page, yPosition } = ensurePageSpace(120 + wleRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'WLE — Worst Case Loss Estimate', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], wleRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      ({ page, yPosition } = ensurePageSpace(36, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawLossScenarioTotal(page, yPosition, 'Total WLE', wleCalc.totalLoss, currency12, { regular: font, bold: fontBold });
      yPosition = sectionBreak(yPosition);

      // ── NLE ───────────────────────────────────────────────────────────────
      const nleRows = getLossExpectancyRows(module, 'nle');
      const nleCalc = calculateScenarioLoss(sumsInsured12, (d12 as any)?.nle, otherLabel12);
      ({ page, yPosition } = ensurePageSpace(120 + nleRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawBlockHeading(page, yPosition, 'NLE — Normal Loss Estimate', fontBold);
      ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], nleRows, { regular: font, bold: fontBold }, {
        colWidths: [185, CONTENT_WIDTH - 185],
        fontSize: 8.5,
        minRowHeight: 18,
        onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
      }));
      ({ page, yPosition } = ensurePageSpace(36, page, yPosition, pdfDoc, isDraft, totalPages));
      yPosition = drawLossScenarioTotal(page, yPosition, 'Total NLE', nleCalc.totalLoss, currency12, { regular: font, bold: fontBold });
      yPosition = sectionBreak(yPosition);

      // ── EML ───────────────────────────────────────────────────────────────
      const emlData = (d12 as any)?.eml;
      const emlEqualsNle = emlData?.eml_equals_nle === true;

      if (emlEqualsNle) {
        ({ page, yPosition } = ensurePageSpace(60, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'EML — Estimated Maximum Loss', fontBold);
        yPosition = drawParagraph(page, yPosition, 'EML = NLE. The estimated maximum loss under near-worst-case conditions is equivalent to the normal loss estimate for this site.', font);
        ({ page, yPosition } = ensurePageSpace(36, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawLossScenarioTotal(page, yPosition, 'Total EML (= NLE)', nleCalc.totalLoss, currency12, { regular: font, bold: fontBold });
        yPosition = sectionBreak(yPosition);
      } else if (!isScenarioBlank(emlData)) {
        const emlRows = getLossExpectancyRows(module, 'eml');
        const emlCalc = calculateScenarioLoss(sumsInsured12, emlData, otherLabel12);
        ({ page, yPosition } = ensurePageSpace(120 + emlRows.length * 18, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'EML — Estimated Maximum Loss', fontBold);
        ({ page, yPosition } = drawSimpleTable(page, yPosition, ['Item', 'Detail'], emlRows, { regular: font, bold: fontBold }, {
          colWidths: [185, CONTENT_WIDTH - 185],
          fontSize: 8.5,
          minRowHeight: 18,
          onPageBreak: () => addNewPage(pdfDoc, isDraft, totalPages),
        }));
        ({ page, yPosition } = ensurePageSpace(36, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawLossScenarioTotal(page, yPosition, 'Total EML', emlCalc.totalLoss, currency12, { regular: font, bold: fontBold });
        yPosition = sectionBreak(yPosition);
      }
    }

    if (module.module_key !== 'RE_14_DRAFT_OUTPUTS') {
      const interpretation = buildSectionInterpretation(module, breakdown, moduleInstances);
      if (interpretation) {
        ({ page, yPosition } = ensurePageSpace(90, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Engineering Interpretation', fontBold);
        yPosition = drawParagraph(page, yPosition, interpretation, font);
        yPosition = sectionBreak(yPosition, 44);
      }
    }

    if (module.module_key !== 'RE_14_DRAFT_OUTPUTS') {
      const commentary = getNarrativeCommentaryWithBreakdown(module, breakdown);
      if (commentary) {
        ({ page, yPosition } = ensurePageSpace(120, page, yPosition, pdfDoc, isDraft, totalPages));
        yPosition = drawBlockHeading(page, yPosition, 'Narrative Commentary', fontBold);
        yPosition = drawParagraph(page, yPosition, commentary, font);
        yPosition = sectionBreak(yPosition, 44);
      }
    }

    const significance = sectionSignificance(module, breakdown, moduleInstances);
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
    const rowHeight = 196;
    let column = 0;

    for (const photo of sitePhotos) {
      const image = await embedEvidenceImage(pdfDoc, String(photo.storage_path), evidenceImageCache);
      if (!image) continue;

      if (yPosition < MARGIN + rowHeight) {
        ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
        yPosition = PAGE_TOP_Y;
      }

      const x = MARGIN + (column * (itemWidth + columnGap));
      const availableHeight = 140;
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

      const photoDescription = getPhotoCaptionText(photo);
      if (photoDescription) {
        const captionLines = wrapText(sanitizePdfText(photoDescription), itemWidth - 8, 8, font).slice(0, 3);
        let captionY = yPosition - availableHeight - 14;
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

    const sitePlanImage = await embedEvidenceImage(pdfDoc, sitePlanPath, evidenceImageCache);
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

    // Natural hazard / exposure factor keys: recs carrying these factor keys must always
    // show under the Exposures section regardless of which module created them.
    // This corrects recs created from the RE03 Occupancy form for the cross-cutting
    // natural_hazard_exposure_and_controls driver (module key stored as RE_03_OCCUPANCY).
    const NATURAL_HAZARD_FACTOR_KEY_PATTERNS = [
      /^exposures_/,
      /^natural_hazard/,
    ];
    function resolveRecommendationSectionLabel(action: Action): string {
      const factorKey = action.source_factor_key || '';
      if (factorKey && NATURAL_HAZARD_FACTOR_KEY_PATTERNS.some((rx) => rx.test(factorKey))) {
        return getModuleDisplayName('RE_07_NATURAL_HAZARDS');
      }
      const linkedModule = modulesById.get(action.module_instance_id);
      return getModuleDisplayName(action.source_module_key || linkedModule?.module_key || '');
    }

    // Deduplicate recommendations: within each status group, suppress exact-duplicate
    // (same source_module_key + source_factor_key) entries beyond the first occurrence.
    // This prevents double entries where two module save cycles created the same factor rec.
    function deduplicateRecommendations(recs: Action[]): Action[] {
      // When peril-specific exposures_* recs exist, suppress the general
      // natural_hazard_exposure_and_controls rec — it is redundant and the
      // specific peril recs are more actionable.
      const hasPerilSpecificRec = recs.some(
        (a) => typeof a.source_factor_key === 'string' && a.source_factor_key.startsWith('exposures_')
      );
      const seen = new Set<string>();
      return recs.filter((action) => {
        // Suppress general natural hazard rec when specific peril recs are present
        if (hasPerilSpecificRec && action.source_factor_key === 'natural_hazard_exposure_and_controls') {
          return false;
        }
        const moduleKey = action.source_module_key || '';
        const factorKey = action.source_factor_key || action.id;
        // Only deduplicate when both keys are present — manual/assessor recs (no factor key) always shown
        if (!action.source_factor_key) return true;
        const dedupeKey = `${moduleKey}::${factorKey}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });
    }

    const drawRecommendationSection = (heading: string, rows: Action[]) => {
      const deduped = deduplicateRecommendations(rows);
      yPosition = drawBlockHeading(page, yPosition, heading, fontBold);
      yPosition = sectionBreak(yPosition, 8);
      const tableRows = deduped.map((action) => {
        const sectionLabel = resolveRecommendationSectionLabel(action);
        // JSONB is per-recommendation accurate; attachment count is a fallback
        // for recs where JSONB is absent (upload succeeded, save did not finish).
        const jsonbPhotoCount = Array.isArray(action.photos) ? action.photos.length : 0;
        const evidenceCount = jsonbPhotoCount > 0
          ? jsonbPhotoCount
          : (recAttachmentCounts.get(action.module_instance_id) ?? 0);
        // Suppress "Risk: Not recorded" — omit the label entirely rather than advertise
        // that hazard_text was never populated (common in pre-audit legacy recommendations).
        // Also substitute old generic hazard text (created before wording audit) with the
        // current factor-specific fallback hazard text so the PDF always shows the best wording.
        const resolvedHazardText = (() => {
          if (!action.hazard_text) return '';
          // Substitute old generic or stale hazard text with the current factor-specific fallback.
          const isStaleHazard =
            action.hazard_text === OLD_GENERIC_HAZARD_TEXT ||
            action.hazard_text === 'Uncontrolled special hazards can escalate before general area protection can contain the event.';
          if (isStaleHazard && action.source_factor_key) {
            const fallback = resolveFactorFallback(action.source_factor_key);
            if (fallback?.hazard_text) return fallback.hazard_text;
          }
          return action.hazard_text;
        })();
        const riskImplication = resolvedHazardText ? `Risk: ${resolvedHazardText}` : '';
        const evidenceText = evidenceCount > 0 ? `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}` : 'No evidence attached';
        return [
          sanitizePdfText(String(action.reference_number || action.id || 'Not provided')),
          sanitizePdfText(sectionLabel),
          sanitizePdfText(getRecommendationBodyText(action)),
          sanitizePdfText(riskImplication),
          sanitizePdfText(resolveRecommendationPriority(action)),
          sanitizePdfText(action.target_date ? formatDate(action.target_date) : String(action.timescale || 'Not set')),
          sanitizePdfText(evidenceText),
          sanitizePdfText(String(action.status || 'Not provided')),
        ];
      });
      ({ page, yPosition } = drawSimpleTable(
        page,
        yPosition,
        ['Ref / ID', 'Section', 'Recommendation', 'Risk implication', 'Pri.', 'Target', 'Evidence', 'Status'],
        tableRows,
        { regular: font, bold: fontBold },
        {
          colWidths: [42, 70, 120, 95, 28, 45, 55, 40],
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
    ['Document Control', sectionStartPages.get('Document Control')],
    ['Disclaimer', sectionStartPages.get('Disclaimer')],
    ['Executive Summary', sectionStartPages.get('Executive Summary')],
    ['Risk Scoring Summary', sectionStartPages.get('Risk Scoring Summary')],
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
    drawFooter(totalPages[i], 'Risk Engineering Survey Report', i + 1, totalPages.length, font);
  }

  if (applyTrialWatermark) {
    totalPages.forEach((p) => drawPlanWatermark(p, 'TRIAL'));
  }

  if (document.issue_status === 'superseded') {
    await addSupersededWatermark(pdfDoc);
  }

  const pdfBytes = await pdfDoc.save();
  if (import.meta.env.DEV) console.log('[PDF RE Survey] PDF build complete');
  return pdfBytes;
}
