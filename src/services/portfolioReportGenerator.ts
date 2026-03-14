import { PDFDocument, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { PortfolioAiInsights, PortfolioAiPayload } from '../lib/ai/generatePortfolioInsights';
import { formatPortfolioGroupLabel } from '../utils/portfolio/formatPortfolioLabels';
import type { OldestUnresolvedRemediationRow, PortfolioScope } from '../hooks/usePortfolioMetrics';
import {
  CONTENT_WIDTH,
  MARGIN,
  addNewPage,
  drawFooter,
  ensurePageSpace,
  sanitizePdfText,
  wrapText,
} from '../lib/pdf/pdfUtils';

export interface PortfolioReportMetrics {
  payload: PortfolioAiPayload;
  oldestUnresolvedRemediation: OldestUnresolvedRemediationRow[];
}

export interface PortfolioReportInput {
  portfolioScope: PortfolioScope;
  portfolioMetrics: PortfolioReportMetrics;
  portfolioInsights?: PortfolioAiInsights | null;
  aiError?: string | null;
  generatedAt?: Date;
}

export interface PortfolioReport {
  title: string;
  generatedAtIso: string;
  scopeSummary: string;
  scope: {
    client: string;
    discipline: string;
    window: string;
    site: string;
  };
  overview: string[];
  trends: string[];
  remediation: string[];
  hotspots: string[];
  oldestUnresolved: string[];
  commentary: string[];
  safeguards: string[];
}

function formatScopeLabel(value: string | null | undefined, fallback: string): string {
  if (!value || !value.trim()) return fallback;
  if (value === 'RISK_ENGINEERING') return 'Risk Engineering';
  return formatPortfolioGroupLabel(value);
}

function formatSignedValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function withFallback(lines: string[], fallback: string): string[] {
  return lines.length > 0 ? lines : [fallback];
}

export function generatePortfolioReport(input: PortfolioReportInput): PortfolioReport {
  const generatedAt = input.generatedAt || new Date();
  const { payload } = input.portfolioMetrics;
  const { portfolioInsights } = input;

  const scope = {
    client: formatScopeLabel(input.portfolioScope.client, 'All clients'),
    discipline: formatScopeLabel(input.portfolioScope.disciplineOrType, 'All disciplines'),
    window: `${input.portfolioScope.windowDays} days`,
    site: input.portfolioScope.siteQuery?.trim() ? input.portfolioScope.siteQuery.trim() : 'All sites',
  };

  const scopeSummary = `This report summarises the currently selected portfolio scope: ${scope.client}, ${scope.discipline}, ${scope.site}, last ${input.portfolioScope.windowDays} days.`;

  const combinedOpen = payload.remediationTrends.combined?.totalOpen ?? 0;
  const combinedFlow = payload.remediationTrends.combined?.netFlowCurrentWindow ?? 0;

  const overview = withFallback([
    `Total sites: ${payload.summary.totalSites}`,
    `Total assessments: ${payload.summary.totalAssessments}`,
    `Assessment actions: ${payload.summary.totalActions}`,
    `Open RE recommendations: ${payload.summary.openReRecommendations}`,
    `Combined open remediation volume: ${combinedOpen}`,
    `Updated in window: ${payload.summary.updatedWithinWindowDays}`,
  ], 'Portfolio metrics unavailable for current scope.');

  const trends = withFallback([
    `Assessments created this window: ${payload.assessmentTrends.createdCurrentWindow} (${formatSignedValue(payload.assessmentTrends.createdCurrentWindow - payload.assessmentTrends.createdPreviousWindow)} vs previous).`,
    `Assessments updated this window: ${payload.assessmentTrends.updatedCurrentWindow} (${formatSignedValue(payload.assessmentTrends.updatedCurrentWindow - payload.assessmentTrends.updatedPreviousWindow)} vs previous).`,
    `Assessment action net change this window: ${formatSignedValue(payload.assessmentActionVelocity.netChange)} (opened ${payload.assessmentActionVelocity.openedCurrentWindow}, closed ${payload.assessmentActionVelocity.closedCurrentWindow}).`,
    `RE recommendation net change this window: ${formatSignedValue(payload.reRecommendationVelocity.netChange)} (opened ${payload.reRecommendationVelocity.openedCurrentWindow}, completed ${payload.reRecommendationVelocity.closedCurrentWindow}).`,
    `Combined remediation net flow this window: ${formatSignedValue(combinedFlow)}.`,
  ], 'Trend metrics are unavailable for the selected scope.');

  const remediation = withFallback([
    `Assessment actions ageing: 0-30 (${payload.assessmentActionAgeing.bucket_0_30}), 31-60 (${payload.assessmentActionAgeing.bucket_31_60}), 61-90 (${payload.assessmentActionAgeing.bucket_61_90}), 90+ (${payload.assessmentActionAgeing.bucket_90_plus}).`,
    `RE recommendations ageing: 0-30 (${payload.reRecommendationAgeing.bucket_0_30}), 31-60 (${payload.reRecommendationAgeing.bucket_31_60}), 61-90 (${payload.reRecommendationAgeing.bucket_61_90}), 90+ (${payload.reRecommendationAgeing.bucket_90_plus}).`,
    payload.remediationTrends.combined?.caveat || '',
  ].filter(Boolean), 'No remediation profile data is available.');

  const hotspots = withFallback([
    ...(payload.hotspots?.topSiteHotspots.slice(0, 3).map((row) => `Site hotspot: ${row.siteName} (${row.clientName}) with ${row.totalOpenItems} open items, ${row.ageing90PlusItems} aged 90+ days.`) || []),
    ...(payload.hotspots?.topModuleHotspots.slice(0, 3).map((row) => `Module/theme hotspot: ${formatPortfolioGroupLabel(row.moduleKey)} with ${row.totalOpenItems} open items.`) || []),
    ...(payload.hotspots?.topClientHotspots?.slice(0, 3).map((row) => `Client concentration: ${row.clientName} with ${row.totalOpenItems} open items.`) || []),
    payload.hotspots?.rankingModel.disclaimer || '',
  ].filter(Boolean), 'No hotspot concentrations are available for the current scope.');

  const oldestUnresolved = withFallback(
    input.portfolioMetrics.oldestUnresolvedRemediation.slice(0, 5).map((row) => (
      `${row.sourceLabel}: ${row.itemLabel} (${row.siteLabel || 'Unknown site'} / ${row.clientLabel || 'Unassigned client'}) - ${row.ageDays} days open`
    )),
    'No unresolved remediation items in current scope.'
  );

  const commentary = withFallback([
    portfolioInsights?.summary || '',
    portfolioInsights?.draftCommentary || '',
    ...(portfolioInsights?.priorities || []),
    !portfolioInsights && input.aiError ? `AI commentary unavailable: ${input.aiError}` : '',
    !portfolioInsights && !input.aiError ? 'AI commentary has not been generated for this scope.' : '',
  ].filter(Boolean), 'Engineering commentary unavailable.');

  const safeguards = [
    'This report reflects only the currently selected portfolio scope and selected window.',
    'Hotspot outputs are prioritisation heuristics and are not validated engineering risk scores.',
    'No underwriting, loss, premium, or compliance certification conclusions are made in this report.',
    'AI commentary should be reviewed before external circulation.',
  ];

  return {
    title: 'Portfolio Risk Report',
    generatedAtIso: generatedAt.toISOString(),
    scopeSummary,
    scope,
    overview,
    trends,
    remediation,
    hotspots,
    oldestUnresolved,
    commentary,
    safeguards,
  };
}

function markdownBulletList(lines: string[]): string[] {
  return lines.map((line) => `- ${line}`);
}

export function generatePortfolioMarkdown(report: PortfolioReport): string {
  return [
    '# Portfolio Risk Report',
    '',
    `Generated: ${report.generatedAtIso}`,
    '',
    '## Scope Summary',
    report.scopeSummary,
    '',
    '## Scope Fields',
    `- Client: ${report.scope.client}`,
    `- Discipline: ${report.scope.discipline}`,
    `- Window: ${report.scope.window}`,
    `- Site Filter: ${report.scope.site}`,
    '',
    '## Portfolio Overview',
    ...markdownBulletList(report.overview),
    '',
    '## Trend Summary',
    ...markdownBulletList(report.trends),
    '',
    '## Remediation Summary',
    ...markdownBulletList(report.remediation),
    '',
    '## Risk Hotspots',
    ...markdownBulletList(report.hotspots),
    '',
    '## Oldest Unresolved Remediation',
    ...markdownBulletList(report.oldestUnresolved),
    '',
    '## Engineering Commentary',
    ...markdownBulletList(report.commentary),
    '',
    '## Notes and Safeguards',
    ...markdownBulletList(report.safeguards),
    '',
  ].join('\n');
}

export async function generatePortfolioPdf(report: PortfolioReport): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const totalPages: PDFPage[] = [];

  let { page, yPosition } = addNewPage(pdfDoc, false, totalPages);

  const drawHeading = (text: string, size: number) => {
    page.drawText(sanitizePdfText(text), {
      x: MARGIN,
      y: yPosition,
      size,
      font: size >= 16 ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    yPosition -= size + 8;
  };

  const drawSection = (title: string, lines: string[]) => {
    ({ page, yPosition } = ensurePageSpace(36, page, yPosition, pdfDoc, false, totalPages));
    drawHeading(title, 13);

    lines.forEach((line) => {
      const wrapped = wrapText(`• ${line}`, CONTENT_WIDTH, 10.5, font);
      wrapped.forEach((wrappedLine) => {
        ({ page, yPosition } = ensurePageSpace(16, page, yPosition, pdfDoc, false, totalPages));
        page.drawText(sanitizePdfText(wrappedLine), {
          x: MARGIN,
          y: yPosition,
          size: 10.5,
          font,
          color: rgb(0.18, 0.18, 0.18),
        });
        yPosition -= 14;
      });
    });

    yPosition -= 8;
  };

  drawHeading(report.title, 19);
  drawSection('Scope Summary', [
    report.scopeSummary,
  ]);
  drawSection('Scope Fields', [
    `Client: ${report.scope.client}`,
    `Discipline: ${report.scope.discipline}`,
    `Window: ${report.scope.window}`,
    `Site Filter: ${report.scope.site}`,
  ]);
  drawSection('Portfolio Overview', report.overview);
  drawSection('Trend Summary', report.trends);
  drawSection('Remediation Summary', report.remediation);
  drawSection('Risk Hotspots', report.hotspots);
  drawSection('Oldest Unresolved Remediation', report.oldestUnresolved);
  drawSection('Engineering Commentary', report.commentary);
  drawSection('Notes and Safeguards', report.safeguards);

  totalPages.forEach((pdfPage, index) => {
    drawFooter(pdfPage, 'Portfolio Risk Report', index + 1, totalPages.length, font);
  });

  return pdfDoc.save();
}
