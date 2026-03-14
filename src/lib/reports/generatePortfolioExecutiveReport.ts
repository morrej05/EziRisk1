import type { PortfolioAiInsights, PortfolioAiPayload } from '../ai/generatePortfolioInsights';
import { formatPortfolioGroupLabel } from '../../utils/portfolio/formatPortfolioLabels';

export interface PortfolioExecutiveReportInput {
  payload: PortfolioAiPayload;
  aiInsights?: PortfolioAiInsights | null;
  aiError?: string | null;
  generatedAt?: Date;
}

export interface PortfolioExecutiveReport {
  generatedAtIso: string;
  scopeSummary: string;
  limitations: string[];
  sections: {
    portfolioOverview: string[];
    keyRiskThemes: string[];
    remediationStatus: string[];
    majorRiskHotspots: string[];
    engineeringCommentary: string[];
  };
  markdown: string;
}

function formatScopeLabel(value: string | null, fallback: string): string {
  if (!value || !value.trim()) return fallback;
  if (value === 'RISK_ENGINEERING') return 'Risk Engineering';
  return formatPortfolioGroupLabel(value);
}

function formatSignedValue(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function firstOrFallback(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

export function generatePortfolioExecutiveReport(input: PortfolioExecutiveReportInput): PortfolioExecutiveReport {
  const generatedAt = input.generatedAt || new Date();
  const { payload, aiInsights } = input;
  const windowLabel = `${payload.scope.windowDays} days`;
  const clientLabel = formatScopeLabel(payload.scope.client, 'All clients');
  const disciplineLabel = formatScopeLabel(payload.scope.disciplineOrType, 'All disciplines');
  const siteLabel = payload.scope.siteQuery?.trim() ? payload.scope.siteQuery.trim() : 'All sites';

  const scopeSummary = `This report summarises the currently selected portfolio scope: ${clientLabel}, ${disciplineLabel}, ${siteLabel}, last ${windowLabel}.`;

  const assessmentDelta = payload.summary.createdCurrentWindow - payload.summary.createdPreviousWindow;
  const updateDelta = payload.summary.updatedCurrentWindow - payload.summary.updatedPreviousWindow;
  const combinedFlow = payload.remediationTrends.combined?.netFlowCurrentWindow ?? 0;

  const overviewSection = firstOrFallback([
    `Total sites in scope: ${payload.summary.totalSites}.`,
    `Total assessments in scope: ${payload.summary.totalAssessments}; created in window: ${payload.summary.createdCurrentWindow} (${formatSignedValue(assessmentDelta)} vs prior window).`,
    `Open remediation volume: ${payload.remediationTrends.combined?.totalOpen ?? 0} items (${payload.summary.totalActions} assessment actions and ${payload.summary.openReRecommendations} open RE recommendations).`,
    `Assessments updated in the selected window: ${payload.summary.updatedWithinWindowDays} (${formatSignedValue(updateDelta)} vs prior window).`,
  ], 'Portfolio overview metrics are limited for the current scope.');

  const topModules = payload.hotspots?.topModuleHotspots.slice(0, 3) ?? [];
  const moduleThemeLine = topModules
    .map((module) => `${formatPortfolioGroupLabel(module.moduleKey)} (${module.totalOpenItems} open items)`)
    .join(', ');

  const topAttentionSites = payload.sitesRequiringAttention.slice(0, 3);
  const keyThemes = firstOrFallback([
    moduleThemeLine ? `Recurring remediation themes are concentrated in: ${moduleThemeLine}.` : '',
    topAttentionSites.length > 0
      ? `Sites currently requiring attention include: ${topAttentionSites.map((site) => `${site.siteName} (${site.clientName})`).join(', ')}.`
      : '',
    aiInsights?.concentrations?.length
      ? `AI concentration interpretation (review before external use): ${aiInsights.concentrations.slice(0, 2).join(' ')}`
      : '',
  ].filter(Boolean), 'No dominant recurring themes were identified in the current scope data.');

  const remediationStatus = firstOrFallback([
    `Assessment actions in window: opened ${payload.assessmentActionVelocity.openedCurrentWindow}, closed ${payload.assessmentActionVelocity.closedCurrentWindow}, net backlog ${formatSignedValue(payload.assessmentActionVelocity.netChange)}.`,
    `RE recommendations in window: opened ${payload.reRecommendationVelocity.openedCurrentWindow}, completed ${payload.reRecommendationVelocity.closedCurrentWindow}, net backlog ${formatSignedValue(payload.reRecommendationVelocity.netChange)}.`,
    `Combined remediation net flow in window: ${formatSignedValue(combinedFlow)} (${combinedFlow > 0 ? 'backlog accumulation' : combinedFlow < 0 ? 'backlog reduction' : 'flat movement'}).`,
    `Ageing pressure (90+ days): assessment actions ${payload.assessmentActionAgeing.bucket_90_plus}, RE recommendations ${payload.reRecommendationAgeing.bucket_90_plus}.`,
  ], 'Remediation status is partially available for the current scope.');

  const topSiteHotspots = payload.hotspots?.topSiteHotspots.slice(0, 3) ?? [];
  const topClientHotspots = payload.hotspots?.topClientHotspots?.slice(0, 3) ?? [];

  const majorHotspots = firstOrFallback([
    topSiteHotspots.length > 0
      ? `Top site hotspots by weighted burden heuristic: ${topSiteHotspots.map((site) => `${site.siteName} (${site.clientName}, ${site.totalOpenItems} open)`).join('; ')}.`
      : '',
    topClientHotspots.length > 0
      ? `Client concentrations in this scope: ${topClientHotspots.map((client) => `${client.clientName} (${client.totalOpenItems} open)`).join('; ')}.`
      : '',
    payload.hotspots?.rankingModel.disclaimer
      ? `Hotspot interpretation note: ${payload.hotspots.rankingModel.disclaimer}`
      : '',
  ].filter(Boolean), 'No major hotspots were identified in current scoped data.');

  const engineeringCommentary = firstOrFallback([
    aiInsights?.summary || '',
    aiInsights?.draftCommentary || '',
    !aiInsights && input.aiError
      ? `AI commentary unavailable for this report generation: ${input.aiError}`
      : '',
    !aiInsights && !input.aiError
      ? 'AI commentary was not generated. This report is based on deterministic scoped portfolio analytics only.'
      : '',
  ].filter(Boolean), 'Engineering commentary unavailable.');

  const limitations = [
    'This report reflects only the currently selected portfolio scope and selected window.',
    'Hotspot rankings are prioritisation heuristics and are not validated engineering risk scores.',
    'Combined remediation totals are volume-based across different source models and should be interpreted with source context.',
    'AI-generated commentary should be reviewed before external distribution.',
  ];

  const markdownLines = [
    '# Portfolio Executive Report',
    '',
    `Generated: ${generatedAt.toISOString()}`,
    '',
    '## Scope Summary',
    scopeSummary,
    '',
    '## Portfolio Overview',
    ...overviewSection.map((line) => `- ${line}`),
    '',
    '## Key Risk Themes',
    ...keyThemes.map((line) => `- ${line}`),
    '',
    '## Remediation Status',
    ...remediationStatus.map((line) => `- ${line}`),
    '',
    '## Major Risk Hotspots',
    ...majorHotspots.map((line) => `- ${line}`),
    '',
    '## Engineering Commentary',
    ...engineeringCommentary.map((line) => `- ${line}`),
    '',
    '## Notes and Safeguards',
    ...limitations.map((line) => `- ${line}`),
    '',
  ];

  return {
    generatedAtIso: generatedAt.toISOString(),
    scopeSummary,
    limitations,
    sections: {
      portfolioOverview: overviewSection,
      keyRiskThemes: keyThemes,
      remediationStatus,
      majorRiskHotspots: majorHotspots,
      engineeringCommentary,
    },
    markdown: markdownLines.join('\n'),
  };
}
