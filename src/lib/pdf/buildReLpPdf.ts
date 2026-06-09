import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
import {
  MARGIN,
  CONTENT_WIDTH,
  PAGE_TOP_Y,
  sanitizePdfText,
  wrapText,
  formatDate,
  addNewPage,
  drawFooter,
  drawPlanWatermark,
  addSupersededWatermark,
  addExecutiveSummaryPages,
  ensurePageSpace,
  deriveAutoActionTitle,
} from './pdfUtils';
import { addIssuedReportPages } from './issuedPdfPages';
import { getModuleDisplayName } from '../modules/moduleDisplay';
import { resolvePdfPreparedByName } from '../../utils/pdfIdentity';
import { resolveFactorFallback } from '../re/recommendations/recommendationPipeline';
import { OLD_GENERIC_ACTION_PREFIX, OLD_GENERIC_HAZARD_TEXT } from '../re/recommendations/remediationMap';

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
  meta?: Record<string, unknown>;
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
  action_required_text?: string | null;
  title?: string | null;
  description?: string | null;
  priority_band: string;
  status: string;
  owner_user_id: string | null;
  owner_display_name?: string;
  target_date: string | null;
  module_instance_id: string;
  created_at: string;
  reference_number?: string | null;
  source_module_key?: string | null;
  source_factor_key?: string | null;
  hazard_text?: string | null;
  photos?: Array<unknown> | null;
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
  applyTrialWatermark?: boolean;
  preparedByName?: string | null;
}

type LpPriority = 'P1' | 'P2' | 'P3' | 'P4';
type RoadmapBand = 'Immediate' | 'Medium' | 'Long-term';

interface LpRecommendation {
  ref: string;
  shortTitle: string;
  recommendation: string;
  riskArea: string;
  priority: LpPriority;
  effort: 'Low' | 'Medium' | 'High';
  benefit: 'Low' | 'Medium' | 'High';
  timescale: string;
  riskImplication: string;
  evidenceSummary: string;
  roadmapBand: RoadmapBand;
}

const PRIORITY_ORDER: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

const RISK_AREA_BY_MODULE: Record<string, string> = {
  RE_02_CONSTRUCTION: 'Construction',
  RE_03_OCCUPANCY: 'Occupancy',
  RE_06_FIRE_PROTECTION: 'Fire Protection',
  // Use "Exposures" to match Survey Appendix C taxonomy.
  RE_07_NATURAL_HAZARDS: 'Exposures',
  RE_08_UTILITIES: 'Utilities',
  RE_09_MANAGEMENT: 'Management',
  RE_12_LOSS_VALUES: 'Loss & Values',
  RE_14_DRAFT_OUTPUTS: 'Outputs / Documentation',
};

// ── Shared recommendation-quality pipeline (mirrors buildReSurveyPdf.ts) ──────

/** Stale action text prefixes that should be replaced at render time. */
const LP_STALE_ACTION_TEXT_PREFIXES = [
  OLD_GENERIC_ACTION_PREFIX,
  'Provide or improve localised/special hazard protection for identified hazards',
  'Provide or extend fixed fire protection in warranted areas',
];

/** Factor key prefixes whose recommendations are always rendered as P1. */
const LP_HIGH_PRIORITY_FACTOR_PREFIXES = [
  're06_fp_sprinklers_warranted_absent',
  're06_fp_adequacy_fixed_protection',
  're06_fp_localised_required_installation',
];

/** Resolve stale-detection-adjusted body text for an action. */
function lpGetBodyText(action: Action): string {
  const stored =
    action.action_required_text ||
    action.recommended_action ||
    action.description ||
    action.title;
  const isStale =
    (typeof stored === 'string' &&
      LP_STALE_ACTION_TEXT_PREFIXES.some((p) => stored.startsWith(p))) ||
    action.hazard_text === OLD_GENERIC_HAZARD_TEXT;
  if (isStale && action.source_factor_key) {
    const fallback = resolveFactorFallback(action.source_factor_key);
    if (fallback?.action_required_text) return fallback.action_required_text;
  }
  return String(stored || 'Not provided');
}

/** Resolve stale-adjusted hazard text for an action. */
function lpGetHazardText(action: Action): string {
  if (!action.hazard_text) return '';
  const isStale =
    action.hazard_text === OLD_GENERIC_HAZARD_TEXT ||
    action.hazard_text === 'Uncontrolled special hazards can escalate before general area protection can contain the event.';
  if (isStale && action.source_factor_key) {
    const fallback = resolveFactorFallback(action.source_factor_key);
    if (fallback?.hazard_text) return fallback.hazard_text;
  }
  return action.hazard_text;
}

/** Render-time priority override — mirrors resolveRecommendationPriority in Survey. */
function lpResolvePriority(action: Action): LpPriority {
  const fk = action.source_factor_key || '';
  if (fk && LP_HIGH_PRIORITY_FACTOR_PREFIXES.some((p) => fk.startsWith(p))) return 'P1';
  return normalizePriority(action.priority_band);
}

/** Minimum quality threshold — skip very short recs regardless of context. */
function lpMeetsQualityThreshold(action: Action): boolean {
  const body = lpGetBodyText(action).trim();
  if (body.length < 30) return false;
  return true;
}

/** Deduplicate — same logic as Survey deduplicateRecommendations. */
function lpDeduplicateActions(actions: Action[]): Action[] {
  const hasPerilSpecific = actions.some(
    (a) => typeof a.source_factor_key === 'string' && a.source_factor_key.startsWith('exposures_')
  );
  const hasSpecificLocalisedRec = actions.some(
    (a) =>
      typeof a.source_factor_key === 'string' &&
      (a.source_factor_key.startsWith('re06_fp_localised_required_provided') ||
        a.source_factor_key.startsWith('re06_fp_localised_required_installation'))
  );
  const seen = new Set<string>();
  return actions.filter((action) => {
    // Suppress generic natural-hazard rec when peril-specific recs are present
    if (hasPerilSpecific && action.source_factor_key === 'natural_hazard_exposure_and_controls') return false;
    // Suppress generic ITM/testing rec when a more specific localised rec is present
    if (
      hasSpecificLocalisedRec &&
      action.source_factor_key === 're06_fp_localised_reliability_testing_integration'
    ) return false;
    if (!action.source_factor_key) return true;
    const key = `${action.source_module_key || ''}::${action.source_factor_key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Full pre-render action pipeline: quality → deduplication. */
function prepareLpActions(actions: Action[]): Action[] {
  return lpDeduplicateActions(actions.filter(lpMeetsQualityThreshold));
}

function normalizePriority(priorityBand: string | null | undefined): LpPriority {
  const normalized = String(priorityBand || 'P3').toUpperCase().trim();
  if (normalized === 'P1' || normalized === 'P2' || normalized === 'P3' || normalized === 'P4') return normalized;
  return 'P3';
}

function deriveEffortFromPriority(priority: LpPriority): 'Low' | 'Medium' | 'High' {
  if (priority === 'P1') return 'High';
  if (priority === 'P2') return 'Medium';
  return 'Low';
}

function deriveBenefitFromPriority(priority: LpPriority): 'Low' | 'Medium' | 'High' {
  if (priority === 'P1' || priority === 'P2') return 'High';
  if (priority === 'P3') return 'Medium';
  return 'Low';
}

function deriveTimescale(priority: LpPriority): string {
  if (priority === 'P1') return '0-30 days';
  if (priority === 'P2') return '1-3 months';
  if (priority === 'P3') return '3-6 months';
  return '6-12 months';
}

function deriveRoadmapBand(priority: LpPriority): RoadmapBand {
  if (priority === 'P1') return 'Immediate';
  if (priority === 'P2') return 'Medium';
  return 'Long-term';
}

/**
 * Derive a concise action title for use in summary tables and roadmaps (~65 chars max).
 * Priority: stored title (if short) → first sentence of body text → truncated body.
 */
function deriveShortTitle(action: Action, bodyText: string): string {
  const stored = action.title?.trim();
  if (stored && stored.length > 4 && stored.length <= 70) return stored;
  // First sentence of body text
  const firstSentence = bodyText.split(/[.!?]/)[0]?.trim() || bodyText.trim();
  if (firstSentence.length <= 70) return firstSentence;
  // Truncate to last word boundary before 67 chars
  const truncated = firstSentence.slice(0, 67);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

function toLpRecommendations(actions: Action[], moduleInstances: ModuleInstance[]): LpRecommendation[] {
  const moduleById = new Map(moduleInstances.map((m) => [m.id, m]));

  // Apply the full quality/deduplication pipeline before mapping to LP shape.
  const filtered = prepareLpActions(actions);

  return filtered
    .map((action, index) => {
      const priority = lpResolvePriority(action);
      const linkedModule = moduleById.get(action.module_instance_id);
      const moduleKey = action.source_module_key || linkedModule?.module_key || '';
      const riskArea = RISK_AREA_BY_MODULE[moduleKey] || getModuleDisplayName(moduleKey || 'General') || 'General';
      const ref = sanitizePdfText(action.reference_number || `LP-${String(index + 1).padStart(3, '0')}`);
      const evidenceCount = Array.isArray(action.photos) ? action.photos.length : 0;
      // Use stale-adjusted body and hazard text — mirrors Survey rendering.
      const bodyText = lpGetBodyText(action);
      const hazardText = lpGetHazardText(action);
      return {
        ref,
        shortTitle: sanitizePdfText(deriveShortTitle(action, bodyText)),
        recommendation: sanitizePdfText(bodyText),
        riskArea,
        priority,
        riskImplication: sanitizePdfText(hazardText || 'Not recorded'),
        evidenceSummary: evidenceCount > 0 ? `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}` : 'No evidence attached',
        effort: deriveEffortFromPriority(priority),
        benefit: deriveBenefitFromPriority(priority),
        timescale: deriveTimescale(priority),
        roadmapBand: deriveRoadmapBand(priority),
      } as LpRecommendation;
    })
    .sort((a, b) => {
      const priDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priDiff !== 0) return priDiff;
      return a.ref.localeCompare(b.ref);
    });
}

function drawParagraph(page: PDFPage, text: string, y: number, font: PDFFont, size = 10): number {
  const lines = wrapText(sanitizePdfText(text), CONTENT_WIDTH, size, font);
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y: cursor, size, font, color: rgb(0.18, 0.18, 0.18) });
    cursor -= size + 3;
  }
  return cursor;
}

function drawTable(
  page: PDFPage,
  yPosition: number,
  headers: string[],
  rows: string[][],
  fonts: { bold: PDFFont; regular: PDFFont },
  ctx?: { pdfDoc: PDFDocument; isDraft: boolean; totalPages: PDFPage[] },
  colWidths?: number[],
): { page: PDFPage; yPosition: number } {
  const rowHeight = 18;
  // Compute cumulative X offsets from colWidths (or equal split if not provided).
  const defaultW = CONTENT_WIDTH / headers.length;
  const widths = colWidths && colWidths.length === headers.length ? colWidths : headers.map(() => defaultW);
  const colOffsets = widths.reduce<number[]>((acc, w) => { acc.push((acc[acc.length - 1] ?? 0) + w); return acc; }, []);
  const startOffsets = [0, ...colOffsets.slice(0, -1)];

  function drawHeaderRow(p: PDFPage, y: number) {
    p.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: rgb(0.93, 0.95, 0.98) });
    headers.forEach((header, idx) => {
      p.drawText(sanitizePdfText(header), {
        x: MARGIN + startOffsets[idx] + 4,
        y: y - 12,
        size: 8.2,
        font: fonts.bold,
        color: rgb(0.1, 0.1, 0.1),
      });
    });
  }

  drawHeaderRow(page, yPosition);
  let currentPage = page;
  let y = yPosition - rowHeight;

  for (const row of rows) {
    const neededHeight = Math.max(
      rowHeight,
      row.reduce((max, value, idx) => {
        const lines = wrapText(sanitizePdfText(value), widths[idx] - 8, 8.2, fonts.regular);
        return Math.max(max, lines.length * 11 + 6);
      }, rowHeight)
    );

    // Page-break: if this row won't fit, start a new page and re-draw the header
    if (ctx && y - neededHeight < 60) {
      const next = addNewPage(ctx.pdfDoc, ctx.isDraft, ctx.totalPages);
      currentPage = next.page;
      y = next.yPosition;
      drawHeaderRow(currentPage, y);
      y -= rowHeight;
    }

    currentPage.drawRectangle({ x: MARGIN, y: y - neededHeight, width: CONTENT_WIDTH, height: neededHeight, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });

    row.forEach((value, idx) => {
      const lines = wrapText(sanitizePdfText(value), widths[idx] - 8, 8.2, fonts.regular);
      let lineY = y - 11;
      lines.forEach((line) => {
        currentPage.drawText(line, {
          x: MARGIN + startOffsets[idx] + 4,
          y: lineY,
          size: 8.2,
          font: fonts.regular,
          color: rgb(0.2, 0.2, 0.2),
        });
        lineY -= 10;
      });
    });

    y -= neededHeight;
  }

  return { page: currentPage, yPosition: y - 12 };
}

/**
 * Card-style renderer for a single LP recommendation.
 * Draws a header band (ref | risk area | priority | timescale), then
 * Recommendation paragraph, optional Risk implication paragraph, and Evidence line.
 * Handles its own page-break check — never splits mid-card.
 */
function drawActionCard(
  rec: LpRecommendation,
  pageIn: PDFPage,
  yIn: number,
  fonts: { bold: PDFFont; regular: PDFFont },
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
): { page: PDFPage; yPosition: number } {
  const CARD_W = CONTENT_WIDTH;
  const HEADER_H = 18;
  const PAD = 5;
  const BODY_SIZE = 9;
  const LABEL_SIZE = 7.5;

  const recLines = wrapText(sanitizePdfText(rec.recommendation), CARD_W - 16, BODY_SIZE, fonts.regular);
  const showImp = rec.riskImplication !== 'Not recorded' && rec.riskImplication.trim().length > 0;
  const impLines = showImp ? wrapText(sanitizePdfText(rec.riskImplication), CARD_W - 16, BODY_SIZE, fonts.regular) : [];

  // Estimate total card height for page-break check
  const estH = HEADER_H
    + PAD + 12 + recLines.length * 11
    + (showImp ? PAD + 12 + impLines.length * 11 : 0)
    + PAD + 12
    + 6;

  let page = pageIn;
  let y = yIn;

  if (y - estH < 60) {
    const next = addNewPage(pdfDoc, isDraft, totalPages);
    page = next.page;
    y = next.yPosition;
  }

  const cardTop = y;

  // ── Header band ────────────────────────────────────────────────────────────
  page.drawRectangle({ x: MARGIN, y: y - HEADER_H, width: CARD_W, height: HEADER_H, color: rgb(0.91, 0.94, 0.98) });
  page.drawText(rec.ref, { x: MARGIN + 5, y: y - 13, size: 8.5, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(sanitizePdfText(rec.riskArea), { x: MARGIN + 52, y: y - 13, size: 8.5, font: fonts.regular, color: rgb(0.25, 0.25, 0.25) });
  // Priority and timescale pinned to right side of header
  page.drawText(rec.priority, { x: MARGIN + 295, y: y - 13, size: 8.5, font: fonts.bold, color: rgb(0.12, 0.12, 0.12) });
  page.drawText(sanitizePdfText(rec.timescale), { x: MARGIN + 330, y: y - 13, size: 8.5, font: fonts.regular, color: rgb(0.25, 0.25, 0.25) });

  y -= HEADER_H + PAD;

  // ── Recommendation paragraph ───────────────────────────────────────────────
  page.drawText('Recommendation', { x: MARGIN + 5, y, size: LABEL_SIZE, font: fonts.bold, color: rgb(0.15, 0.15, 0.15) });
  y -= 12;
  for (const line of recLines) {
    page.drawText(line, { x: MARGIN + 10, y, size: BODY_SIZE, font: fonts.regular, color: rgb(0.18, 0.18, 0.18) });
    y -= 11;
  }

  // ── Risk implication paragraph ─────────────────────────────────────────────
  if (showImp) {
    y -= PAD;
    page.drawText('Risk implication', { x: MARGIN + 5, y, size: LABEL_SIZE, font: fonts.bold, color: rgb(0.15, 0.15, 0.15) });
    y -= 12;
    for (const line of impLines) {
      page.drawText(line, { x: MARGIN + 10, y, size: BODY_SIZE, font: fonts.regular, color: rgb(0.30, 0.16, 0.16) });
      y -= 11;
    }
  }

  // ── Evidence line ──────────────────────────────────────────────────────────
  y -= PAD;
  page.drawText(sanitizePdfText(`Evidence: ${rec.evidenceSummary}`), { x: MARGIN + 5, y, size: LABEL_SIZE, font: fonts.regular, color: rgb(0.5, 0.5, 0.5) });
  y -= 12;

  // ── Card border outline (drawn last so it sits over background, under text) ─
  const actualH = cardTop - y + 2;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CARD_W, height: actualH, borderColor: rgb(0.76, 0.86, 0.94), borderWidth: 0.6 });

  return { page, yPosition: y - 8 };
}

function getTopPriorityRows(recommendations: LpRecommendation[]): string[][] {
  return recommendations.map((rec) => [
    rec.ref,
    rec.shortTitle,
    rec.riskArea,
    rec.priority,
    rec.timescale,
  ]);
}

export async function buildReLpPdf(options: BuildPdfOptions): Promise<Uint8Array> {
  if (import.meta.env.DEV) console.log('[PDF RE LP] Starting RE Loss Prevention PDF build');
  const { moduleInstances, actions, organisation, renderMode, applyTrialWatermark } = options;
  const document = {
    ...options.document,
    assessor_name: resolvePdfPreparedByName(options.preparedByName, organisation?.name),
  };

  const recommendations = toLpRecommendations(actions, moduleInstances);
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isIssuedMode = renderMode === 'issued';
  const isDraft = !isIssuedMode;
  const totalPages: PDFPage[] = [];

  const assessmentDate = formatDate(document.assessment_date || document.created_at);
  const issueDate = formatDate((document as Partial<{ issue_date: string }>).issue_date || new Date().toISOString());
  const docMeta = document.meta ?? {};
  const clientMeta = (docMeta.client ?? {}) as Record<string, unknown>;
  const siteMeta = (docMeta.site ?? {}) as Record<string, unknown>;
  const summaryMode = document.executive_summary_mode;
  const executiveSummaryMode: 'ai' | 'author' | 'both' | 'none' =
    summaryMode === 'ai' || summaryMode === 'author' || summaryMode === 'both' || summaryMode === 'none'
      ? summaryMode
      : 'none';
  const issueStatus = (document as Partial<{ issue_status: string }>).issue_status;
  const versionNumber = (document as Partial<{ version_number: number }>).version_number || document.version || 1;
  const baseDocumentId = (document as Partial<{ base_document_id: string }>).base_document_id;
  const issueDateIso = (document as Partial<{ issue_date: string }>).issue_date || new Date().toISOString();

  const { coverPage, docControlPage } = await addIssuedReportPages({
    pdfDoc,
    document: {
      id: document.id,
      title: 'Loss Prevention Report',
      document_type: 'RE_LP',
      version_number: versionNumber,
      issue_date: issueDateIso,
      issue_status: isIssuedMode ? 'issued' : 'draft',
      assessor_name: document.assessor_name,
      base_document_id: baseDocumentId,
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      branding_logo_path: organisation.branding_logo_path,
    },
    client: {
      name: String(clientMeta.name || document.responsible_person || ''),
      site: String(siteMeta.name || document.scope_description || ''),
      address: typeof siteMeta.address === 'string' ? siteMeta.address : undefined,
    },
    fonts: { bold: fontBold, regular: font },
  });
  totalPages.push(coverPage);
  // docControlPage was physically created immediately after coverPage by addIssuedReportPages.
  // Push it here so totalPages order matches the physical PDF page order.
  totalPages.push(docControlPage);

  const { page: coverDetailsPage } = addNewPage(pdfDoc, isDraft, totalPages);
  let yPosition = PAGE_TOP_Y;
  coverDetailsPage.drawText('Loss Prevention Report', { x: MARGIN, y: yPosition, size: 18, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 26;

  const coverRows = [
    ['Client', sanitizePdfText(String(clientMeta.name || document.responsible_person || 'Not provided'))],
    ['Site', sanitizePdfText(String(siteMeta.name || document.scope_description || 'Not provided'))],
    ['Assessment date', assessmentDate],
    ['Issue date', issueDate],
    ['Version', String(versionNumber)],
    // Prefer the site/client name from document meta over the internal document title,
    // which may be a placeholder like "Untitled Risk Engineering Site".
    ['Associated RE Survey', sanitizePdfText(
      String(siteMeta.name || clientMeta.name || document.scope_description || document.title || 'Risk Engineering Survey').trim()
    )],
  ];
  ({ yPosition } = drawTable(coverDetailsPage, yPosition, ['Field', 'Value'], coverRows, { bold: fontBold, regular: font }));

  addExecutiveSummaryPages(
    pdfDoc,
    isDraft,
    totalPages,
    executiveSummaryMode,
    document.executive_summary_ai,
    document.executive_summary_author,
    { bold: fontBold, regular: font }
  );

  let section = addNewPage(pdfDoc, isDraft, totalPages);
  let page = section.page;
  yPosition = PAGE_TOP_Y;

  page.drawText('Executive Action Summary', { x: MARGIN, y: yPosition, size: 16, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 24;
  const p1Count = recommendations.filter((r) => r.priority === 'P1').length;
  const p2Count = recommendations.filter((r) => r.priority === 'P2').length;
  const p3PlusCount = recommendations.filter((r) => r.priority !== 'P1' && r.priority !== 'P2').length;
  const priorityParts: string[] = [];
  if (p1Count > 0) priorityParts.push(`${p1Count} P1 immediate action${p1Count === 1 ? '' : 's'}`);
  if (p2Count > 0) priorityParts.push(`${p2Count} P2 medium-term action${p2Count === 1 ? '' : 's'}`);
  if (p3PlusCount > 0) priorityParts.push(`${p3PlusCount} longer-term action${p3PlusCount === 1 ? '' : 's'}`);
  const riskOverview = recommendations.length === 0
    ? 'No actionable recommendations were identified in the current assessment cycle.'
    : `This loss prevention output identifies ${recommendations.length} actionable recommendation${recommendations.length === 1 ? '' : 's'}${priorityParts.length > 0 ? ', including ' + priorityParts.join(' and ') : ''}.`;
  yPosition = drawParagraph(page, riskOverview, yPosition, font, 10);
  yPosition -= 6;

  ({ page, yPosition } = ensurePageSpace(160, page, yPosition, pdfDoc, isDraft, totalPages));
  // Columns: Ref(50) + Action summary(250) + Risk area(95) + Priority(45) + Timescale(55) = 495
  ({ page, yPosition } = drawTable(
    page, yPosition,
    ['Ref', 'Action summary', 'Risk area', 'Priority', 'Timescale'],
    getTopPriorityRows(recommendations),
    { bold: fontBold, regular: font },
    { pdfDoc, isDraft, totalPages },
    [50, 250, 95, 45, 55],
  ));

  ({ page, yPosition } = ensurePageSpace(80, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('Action Register', { x: MARGIN, y: yPosition, size: 15, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 20;
  // Card-style layout: one card per recommendation.
  // Each card shows a coloured header (ref | section | priority | timescale),
  // then the Recommendation paragraph, optional Risk implication paragraph, and Evidence line.
  for (const rec of recommendations) {
    ({ page, yPosition } = drawActionCard(rec, page, yPosition, { bold: fontBold, regular: font }, pdfDoc, isDraft, totalPages));
  }

  const recommendationsByRiskArea = new Map<string, LpRecommendation[]>();
  for (const rec of recommendations) {
    const existing = recommendationsByRiskArea.get(rec.riskArea) || [];
    existing.push(rec);
    recommendationsByRiskArea.set(rec.riskArea, existing);
  }

  section = addNewPage(pdfDoc, isDraft, totalPages);
  page = section.page;
  yPosition = PAGE_TOP_Y;
  page.drawText('Recommendations by Risk Area', { x: MARGIN, y: yPosition, size: 16, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 24;

  const orderedAreas = ['Construction', 'Occupancy', 'Fire Protection', 'Exposures'];
  const allAreas = [...new Set([...orderedAreas, ...Array.from(recommendationsByRiskArea.keys())])];
  for (const area of allAreas) {
    const recs = recommendationsByRiskArea.get(area) || [];
    ({ page, yPosition } = ensurePageSpace(80, page, yPosition, pdfDoc, isDraft, totalPages));
    page.drawText(`${area} (${recs.length})`, { x: MARGIN, y: yPosition, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
    yPosition -= 16;

    if (recs.length === 0) {
      page.drawText('No recommendations currently logged.', { x: MARGIN + 10, y: yPosition, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
      yPosition -= 14;
      continue;
    }

    for (const rec of recs) {
      const headerLine = `${rec.ref}  –  ${rec.priority}  –  ${sanitizePdfText(rec.shortTitle)}`;
      const bodyLines = wrapText(sanitizePdfText(rec.recommendation), CONTENT_WIDTH - 20, 9, font);
      const blockH = 14 + bodyLines.length * 11 + 14 + 4;
      ({ page, yPosition } = ensurePageSpace(blockH + 20, page, yPosition, pdfDoc, isDraft, totalPages));
      // Ref / Priority / short title header
      page.drawText(sanitizePdfText(headerLine), { x: MARGIN + 8, y: yPosition, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.3) });
      yPosition -= 13;
      // Recommendation body
      for (const line of bodyLines) {
        page.drawText(line, { x: MARGIN + 12, y: yPosition, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
        yPosition -= 11;
      }
      // Evidence line
      page.drawText(sanitizePdfText(`Evidence: ${rec.evidenceSummary}`), { x: MARGIN + 12, y: yPosition, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
      yPosition -= 10;
      // Thin separator rule
      page.drawRectangle({ x: MARGIN + 12, y: yPosition, width: CONTENT_WIDTH - 24, height: 0.3, color: rgb(0.8, 0.8, 0.8) });
      yPosition -= 7;
    }
    yPosition -= 4;
  }

  section = addNewPage(pdfDoc, isDraft, totalPages);
  page = section.page;
  yPosition = PAGE_TOP_Y;
  page.drawText('Implementation Roadmap', { x: MARGIN, y: yPosition, size: 16, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 20;

  const roadmapGroups: RoadmapBand[] = ['Immediate', 'Medium', 'Long-term'];
  for (const band of roadmapGroups) {
    const bandRows = recommendations.filter((rec) => rec.roadmapBand === band);
    ({ page, yPosition } = ensurePageSpace(90, page, yPosition, pdfDoc, isDraft, totalPages));
    page.drawText(`${band} (${bandRows.length})`, { x: MARGIN, y: yPosition, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    yPosition -= 16;

    // Columns: Ref(50) + Action summary(255) + Risk area(95) + Timescale(95) = 495
    ({ page, yPosition } = drawTable(
      page,
      yPosition,
      ['Ref', 'Action summary', 'Risk area', 'Timescale'],
      bandRows.length > 0
        ? bandRows.map((rec) => [rec.ref, rec.shortTitle, rec.riskArea, rec.timescale])
        : [['-', 'No actions in this horizon.', '-', '-']],
      { bold: fontBold, regular: font },
      { pdfDoc, isDraft, totalPages },
      [50, 255, 95, 95],
    ));
  }

  ({ page, yPosition } = ensurePageSpace(120, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('Risk Reduction Impact', { x: MARGIN, y: yPosition, size: 14, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 18;
  const impactNarrative = recommendations.length === 0
    ? 'No immediate score movement is expected because no active loss prevention actions are currently raised.'
    : `Expected risk reduction is strongest when ${recommendations.filter((r) => r.priority === 'P1').length} immediate action(s) and ${recommendations.filter((r) => r.priority === 'P2').length} medium-horizon action(s) are delivered first, followed by longer-term resilience improvements.`;
  yPosition = drawParagraph(page, impactNarrative, yPosition, font, 10);

  ({ page, yPosition } = ensurePageSpace(90, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('Disclaimer', { x: MARGIN, y: yPosition, size: 14, font: fontBold, color: rgb(0, 0, 0) });
  yPosition -= 18;
  drawParagraph(
    page,
    'This report is an action-focused companion output to the Risk Engineering Survey. Recommendations require competent review, prioritisation and implementation planning by the duty holder.',
    yPosition,
    font,
    9.5
  );

  for (let i = 0; i < totalPages.length; i++) {
    drawFooter(totalPages[i], 'Loss Prevention Report', i + 1, totalPages.length, font);
  }

  if (applyTrialWatermark) {
    totalPages.forEach((p) => drawPlanWatermark(p, 'TRIAL'));
  }

  if (issueStatus === 'superseded') {
    await addSupersededWatermark(pdfDoc);
  }

  const pdfBytes = await pdfDoc.save();
  if (import.meta.env.DEV) console.log('[PDF RE LP] PDF build complete');
  return pdfBytes;
}
