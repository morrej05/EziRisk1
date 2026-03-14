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
  scope: {
    client: string;
    discipline: string;
    window: string;
    site: string;
  };
  executiveSummary: string[];
  portfolioMetrics: string[];
  trendAnalysis: string[];
  remediationProfile: string[];
  oldestRemediation: string[];
  aiCommentary: string[];
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

  const combinedOpen = payload.remediationTrends.combined?.totalOpen ?? 0;
  const combinedFlow = payload.remediationTrends.combined?.netFlowCurrentWindow ?? 0;

  const executiveSummary = withFallback([
    `Scope includes ${payload.summary.totalSites} sites and ${payload.summary.totalAssessments} assessments.`,
    `Open remediation in scope: ${combinedOpen} items across ${payload.summary.totalActions} assessment actions and ${payload.summary.openReRecommendations} RE recommendations.`,
    `Assessment creation delta vs previous window: ${formatSignedValue(payload.summary.createdCurrentWindow - payload.summary.createdPreviousWindow)}.`,
  ], 'No scoped portfolio data is currently available.');

  const portfolioMetrics = withFallback([
    `Total sites: ${payload.summary.totalSites}`,
    `Total assessments: ${payload.summary.totalAssessments}`,
    `Assessment actions: ${payload.summary.totalActions}`,
    `Open RE recommendations: ${payload.summary.openReRecommendations}`,
    `Updated in window: ${payload.summary.updatedWithinWindowDays}`,
  ], 'Portfolio metrics unavailable for current scope.');

  const trendAnalysis = withFallback([
    `Assessments created this window: ${payload.assessmentTrends.createdCurrentWindow} (${formatSignedValue(payload.assessmentTrends.createdCurrentWindow - payload.assessmentTrends.createdPreviousWindow)} vs previous).`,
    `Assessments updated this window: ${payload.assessmentTrends.updatedCurrentWindow} (${formatSignedValue(payload.assessmentTrends.updatedCurrentWindow - payload.assessmentTrends.updatedPreviousWindow)} vs previous).`,
    `Assessment action net change this window: ${formatSignedValue(payload.assessmentActionVelocity.netChange)} (opened ${payload.assessmentActionVelocity.openedCurrentWindow}, closed ${payload.assessmentActionVelocity.closedCurrentWindow}).`,
    `RE recommendation net change this window: ${formatSignedValue(payload.reRecommendationVelocity.netChange)} (opened ${payload.reRecommendationVelocity.openedCurrentWindow}, completed ${payload.reRecommendationVelocity.closedCurrentWindow}).`,
    `Combined remediation net flow this window: ${formatSignedValue(combinedFlow)}.`,
  ], 'Trend metrics are unavailable for the selected scope.');

  const remediationProfile = withFallback([
    `Assessment actions ageing: 0-30 (${payload.assessmentActionAgeing.bucket_0_30}), 31-60 (${payload.assessmentActionAgeing.bucket_31_60}), 61-90 (${payload.assessmentActionAgeing.bucket_61_90}), 90+ (${payload.assessmentActionAgeing.bucket_90_plus}).`,
    `RE recommendations ageing: 0-30 (${payload.reRecommendationAgeing.bucket_0_30}), 31-60 (${payload.reRecommendationAgeing.bucket_31_60}), 61-90 (${payload.reRecommendationAgeing.bucket_61_90}), 90+ (${payload.reRecommendationAgeing.bucket_90_plus}).`,
    payload.remediationTrends.combined?.caveat || '',
  ].filter(Boolean), 'No remediation profile data is available.');

  const oldestRemediation = withFallback(
    input.portfolioMetrics.oldestUnresolvedRemediation.slice(0, 5).map((row) => (
      `${row.sourceLabel}: ${row.itemLabel} (${row.siteLabel || 'Unknown site'} / ${row.clientLabel || 'Unassigned client'}) - ${row.ageDays} days open`
    )),
    'No unresolved remediation items in current scope.'
  );

  const aiCommentary = withFallback([
    portfolioInsights?.summary || '',
    portfolioInsights?.draftCommentary || '',
    ...(portfolioInsights?.priorities || []),
    !portfolioInsights && input.aiError ? `AI commentary unavailable: ${input.aiError}` : '',
    !portfolioInsights && !input.aiError ? 'AI commentary has not been generated for this scope.' : '',
  ].filter(Boolean), 'Engineering commentary unavailable.');

  return {
    title: 'Portfolio Risk Report',
    generatedAtIso: generatedAt.toISOString(),
    scope,
    executiveSummary,
    portfolioMetrics,
    trendAnalysis,
    remediationProfile,
    oldestRemediation,
    aiCommentary,
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
    '## Scope',
    `- Client: ${report.scope.client}`,
    `- Discipline: ${report.scope.discipline}`,
    `- Window: ${report.scope.window}`,
    `- Site Filter: ${report.scope.site}`,
    '',
    '## Executive Summary',
    ...markdownBulletList(report.executiveSummary),
    '',
    '## Portfolio Summary',
    ...markdownBulletList(report.portfolioMetrics),
    '',
    '## Trend Analysis',
    ...markdownBulletList(report.trendAnalysis),
    '',
    '## Remediation Profile',
    ...markdownBulletList(report.remediationProfile),
    '',
    '## Oldest Unresolved Remediation',
    ...markdownBulletList(report.oldestRemediation),
    '',
    '## Engineering Commentary',
    ...markdownBulletList(report.aiCommentary),
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
  drawSection('Scope', [
    `Client: ${report.scope.client}`,
    `Discipline: ${report.scope.discipline}`,
    `Window: ${report.scope.window}`,
    `Site Filter: ${report.scope.site}`,
  ]);
  drawSection('Executive Summary', report.executiveSummary);
  drawSection('Portfolio Summary', report.portfolioMetrics);
  drawSection('Trend Analysis', report.trendAnalysis);
  drawSection('Remediation Profile', report.remediationProfile);
  drawSection('Oldest Unresolved Remediation', report.oldestRemediation);
  drawSection('Engineering Commentary', report.aiCommentary);

  totalPages.forEach((pdfPage, index) => {
    drawFooter(pdfPage, 'Portfolio Risk Report', index + 1, totalPages.length, font);
  });

  return pdfDoc.save();
}
