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
  addExecutiveSummaryPages,
  ensurePageSpace,
} from './pdfUtils';
import { addIssuedReportPages } from './issuedPdfPages';
import { drawSectionHeaderBar, drawRiskSignificanceBlock, SignificanceLevel } from './pdfPrimitives';
import { buildRiskEngineeringScoreBreakdown } from '../re/scoring/riskEngineeringHelpers';

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
}

type Breakdown = Awaited<ReturnType<typeof buildRiskEngineeringScoreBreakdown>>;

const RE_SECTION_CONFIG: Record<string, { title: string; key: string }> = {
  RE_02_CONSTRUCTION: { title: 'Construction', key: 'construction' },
  RE_03_OCCUPANCY: { title: 'Occupancy', key: 'occupancy' },
  RE_06_FIRE_PROTECTION: { title: 'Fire Protection', key: 'fire_protection' },
  RE_07_NATURAL_HAZARDS: { title: 'Exposures', key: 'exposures' },
  RE_08_UTILITIES: { title: 'Utilities & Critical Services', key: 'utilities' },
  RE_09_MANAGEMENT: { title: 'Management Systems', key: 'management' },
  RE_12_LOSS_VALUES: { title: 'Loss & Values', key: 'loss_values' },
};

function getRatingFromModule(module?: ModuleInstance | null): number | null {
  if (!module?.data) return null;
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
    const propertyTotal = Number(module.data?.property_sums_insured?.total || 0);
    const gp = Number(module.data?.business_interruption?.gross_profit || 0);
    const indemnityMonths = Number(module.data?.business_interruption?.indemnity_period_months || 0);
    const highMagnitude = propertyTotal >= 10000000 || gp >= 3000000 || indemnityMonths >= 12;
    const level: SignificanceLevel = highMagnitude ? 'High' : propertyTotal > 0 || gp > 0 ? 'Moderate' : 'Low';
    const narrative = `Declared loss values indicate property exposure of ${propertyTotal > 0 ? propertyTotal.toLocaleString() : 'not stated'} and BI gross profit of ${gp > 0 ? gp.toLocaleString() : 'not stated'}. This frames potential loss quantum and insurer balance-sheet sensitivity for severe but plausible scenarios.`;
    return { level, narrative };
  }

  return null;
}

export async function buildReSurveyPdf(options: BuildPdfOptions): Promise<Uint8Array> {
  console.log('[PDF RE Survey] Starting RE Survey PDF build');
  const { document, moduleInstances, organisation, renderMode, selectedModules } = options;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isIssuedMode = renderMode === 'issued';
  const isDraft = !isIssuedMode;
  const totalPages: PDFPage[] = [];

  console.log('[PDF RE Survey] Render mode:', isIssuedMode ? 'ISSUED' : 'DRAFT');

  const { coverPage, docControlPage } = await addIssuedReportPages({
    pdfDoc,
    document: {
      id: document.id,
      title: document.title,
      document_type: 'RE',
      version_number: Number(document.version_number || document.version || 1),
      issue_date: String(document.issue_date || new Date().toISOString()),
      issue_status: isIssuedMode ? 'issued' : 'draft',
      assessor_name: document.assessor_name,
      base_document_id: typeof document.base_document_id === 'string' ? document.base_document_id : undefined,
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      branding_logo_path: organisation.branding_logo_path,
    },
    client: {
      name: document.meta?.client?.name || document.responsible_person || '',
      site: document.meta?.site?.name || document.scope_description || '',
      address: document.meta?.site?.address,
    },
    fonts: { bold: fontBold, regular: font },
  });
  totalPages.push(coverPage, docControlPage);

  addExecutiveSummaryPages(
    pdfDoc,
    isDraft,
    totalPages,
    (document.executive_summary_mode as 'ai' | 'author' | 'both' | 'none') || 'none',
    document.executive_summary_ai,
    document.executive_summary_author,
    { bold: fontBold, regular: font }
  );

  const modulesToInclude = selectedModules
    ? moduleInstances.filter(m => selectedModules.includes(m.module_key))
    : moduleInstances;

  const modulesByKey = new Map(modulesToInclude.map(m => [m.module_key, m]));
  const riskEngineeringData = modulesByKey.get('RISK_ENGINEERING')?.data || {};
  const breakdown = await buildRiskEngineeringScoreBreakdown(document.id, riskEngineeringData);

  let { page } = addNewPage(pdfDoc, isDraft, totalPages);
  let yPosition = PAGE_TOP_Y;

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
  const summaryLines = wrapText(
    sanitizePdfText(
      `Weighted total score is ${breakdown.totalScore.toFixed(1)} out of ${breakdown.maxScore.toFixed(1)} (${((breakdown.totalScore / Math.max(1, breakdown.maxScore)) * 100).toFixed(0)}%). Industry context: ${breakdown.industryLabel}.`
    ),
    CONTENT_WIDTH,
    10,
    font
  );

  ({ page, yPosition } = ensurePageSpace(26 + summaryLines.length * 14 + 90, page, yPosition, pdfDoc, isDraft, totalPages));
  for (const line of summaryLines) {
    page.drawText(line, { x: MARGIN, y: yPosition, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    yPosition -= 14;
  }

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

  for (const module of modulesToInclude) {
    if (module.module_key === 'RE_13_RECOMMENDATIONS') {
      continue;
    }

    ({ page, yPosition } = ensurePageSpace(170, page, yPosition, pdfDoc, isDraft, totalPages));

    const sectionTitle = RE_SECTION_CONFIG[module.module_key]?.title || module.module_key;
    yPosition = drawSectionHeaderBar({
      page,
      x: MARGIN,
      y: yPosition,
      w: CONTENT_WIDTH,
      title: sectionTitle,
      product: 're',
      fonts: { regular: font, bold: fontBold },
    });

    if (module.assessor_notes) {
      const lines = wrapText(module.assessor_notes, CONTENT_WIDTH, 10, font);
      ({ page, yPosition } = ensurePageSpace(lines.length * 14 + 20, page, yPosition, pdfDoc, isDraft, totalPages));
      for (const line of lines) {
        page.drawText(line, {
          x: MARGIN,
          y: yPosition,
          size: 10,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        yPosition -= 14;
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

    yPosition -= 10;
  }

  ({ page, yPosition } = ensurePageSpace(130, page, yPosition, pdfDoc, isDraft, totalPages));
  yPosition = drawSectionHeaderBar({
    page,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: 'Final Conclusion',
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
