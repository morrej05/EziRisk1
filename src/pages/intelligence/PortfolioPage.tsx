import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Copy, Download, Sparkles, Trash2 } from 'lucide-react';
import PortfolioInsightPanel from '../../components/ai/PortfolioInsightPanel';
import { type PortfolioScope, usePortfolioMetrics } from '../../hooks/usePortfolioMetrics';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  type PortfolioAiInsights,
  type PortfolioAiPayload,
} from '../../lib/ai/generatePortfolioInsights';
import { generatePortfolioExecutiveReport, type PortfolioExecutiveReport } from '../../lib/reports/generatePortfolioExecutiveReport';
import { formatPortfolioGroupLabel, formatPortfolioStatusLabel } from '../../utils/portfolio/formatPortfolioLabels';

interface CardMetric {
  label: string;
  value: number;
  trendValue?: number;
  to?: string;
  state?: Record<string, unknown>;
}

interface AgeingBucketConfig {
  key: 'bucket_0_30' | 'bucket_31_60' | 'bucket_61_90' | 'bucket_90_plus';
  label: string;
}

const AGEING_BUCKETS: AgeingBucketConfig[] = [
  { key: 'bucket_0_30', label: '0–30 days' },
  { key: 'bucket_31_60', label: '31–60 days' },
  { key: 'bucket_61_90', label: '61–90 days' },
  { key: 'bucket_90_plus', label: '90+ days' },
];

const ALL_CLIENTS_VALUE = '__all_clients__';
const ALL_DISCIPLINES_VALUE = '__all_disciplines__';

interface SavedPortfolioViewFilters {
  client: string | null;
  discipline: string | null;
  window: 30 | 90;
  site: string;
  sector?: string | null;
}

interface SavedPortfolioView {
  id: string;
  organisation_id: string;
  name: string;
  filters_json: SavedPortfolioViewFilters;
  created_by: string;
  created_at: string;
}

function encodeScopeValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeScopeValue(value: string | null): string | null {
  if (!value) return null;
  return decodeURIComponent(value);
}

function getCurrentScopeFilters(scope: PortfolioScope): SavedPortfolioViewFilters {
  return {
    client: scope.client,
    discipline: scope.disciplineOrType,
    window: scope.windowDays,
    site: scope.siteQuery || '',
  };
}

function sanitizeSavedScopeFilters(rawFilters: unknown): SavedPortfolioViewFilters | null {
  if (!rawFilters || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) return null;

  const candidate = rawFilters as Record<string, unknown>;
  const rawWindow = candidate.window;
  const windowDays: 30 | 90 = rawWindow === 90 || rawWindow === '90' ? 90 : 30;

  const toNullableString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const site = typeof candidate.site === 'string' ? candidate.site : '';
  const sector = toNullableString(candidate.sector);

  return {
    client: toNullableString(candidate.client),
    discipline: toNullableString(candidate.discipline),
    window: windowDays,
    site,
    sector,
  };
}

function TrendDelta({ value, windowDays }: { value: number; windowDays: 30 | 90 }) {
  const prefix = value > 0 ? '+' : '';
  const colour = value > 0 ? 'text-rose-700' : value < 0 ? 'text-emerald-700' : 'text-slate-500';

  return <p className={`mt-2 text-xs font-medium ${colour}`}>{`${prefix}${value} vs previous ${windowDays} days`}</p>;
}

function InteractiveRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        clickable
          ? 'border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors'
          : 'border-slate-200'
      }`}
    >
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { organisation, user, isPlatformAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const windowParam = searchParams.get('window');
  const clientParam = decodeScopeValue(searchParams.get('client'));
  const disciplineParam = decodeScopeValue(searchParams.get('discipline'));
  const siteParam = searchParams.get('site') || '';
  const selectedWindowDays: 30 | 90 = windowParam === '90' ? 90 : 30;

  const scope: PortfolioScope = {
    client: clientParam,
    disciplineOrType: disciplineParam,
    windowDays: selectedWindowDays,
    siteQuery: siteParam,
  };

  const {
    metrics,
    scopeOptions,
    loading,
    assessmentsLoading,
    actionsLoading,
    assessmentsError,
    actionsError,
    recommendationsError,
  } = usePortfolioMetrics(scope);

  const [showInsightPanel, setShowInsightPanel] = useState(false);
  const [latestAiInsights, setLatestAiInsights] = useState<PortfolioAiInsights | null>(null);
  const [reportAiError, setReportAiError] = useState<string | null>(null);
  const [executiveReport, setExecutiveReport] = useState<PortfolioExecutiveReport | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedPortfolioView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);

  const setScopeParam = (key: 'client' | 'discipline' | 'window' | 'site', value: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!value || !value.trim()) {
      nextParams.delete(key);
    } else {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const setWindowDays = (windowDays: 30 | 90) => {
    setScopeParam('window', String(windowDays));
  };

  const setClient = (value: string) => {
    setScopeParam('client', value === ALL_CLIENTS_VALUE ? null : encodeScopeValue(value));
  };

  const setDisciplineOrType = (value: string) => {
    setScopeParam('discipline', value === ALL_DISCIPLINES_VALUE ? null : encodeScopeValue(value));
  };

  const setSiteQuery = (value: string) => {
    setScopeParam('site', value || null);
  };

  const clearScope = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('client');
    nextParams.delete('discipline');
    nextParams.delete('site');
    nextParams.delete('window');
    setSearchParams(nextParams, { replace: true });
    setSelectedSavedViewId('');
  };

  const loadSavedViews = useCallback(async () => {
    if (!organisation?.id) {
      setSavedViews([]);
      setSavedViewsLoading(false);
      return;
    }

    setSavedViewsLoading(true);
    setSavedViewsError(null);

    const { data, error } = await supabase
      .from('saved_portfolio_views')
      .select('id, organisation_id, name, filters_json, created_by, created_at')
      .eq('organisation_id', organisation.id)
      .order('created_at', { ascending: false });

    if (error) {
      setSavedViewsError('Unable to load saved views right now.');
      setSavedViews([]);
      setSavedViewsLoading(false);
      return;
    }

    const parsedViews = (data || []).flatMap((row) => {
      const parsedFilters = sanitizeSavedScopeFilters(row.filters_json);
      if (!parsedFilters) return [];

      return [{
        id: row.id,
        organisation_id: row.organisation_id,
        name: row.name,
        filters_json: parsedFilters,
        created_by: row.created_by,
        created_at: row.created_at,
      } satisfies SavedPortfolioView];
    });

    setSavedViews(parsedViews);
    setSavedViewsLoading(false);
  }, [organisation?.id]);

  useEffect(() => {
    void loadSavedViews();
  }, [loadSavedViews]);

  const saveCurrentView = async () => {
    if (!organisation?.id || !user?.id) return;

    const name = window.prompt('Name this saved view');
    if (!name) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    const filters = getCurrentScopeFilters(scope);

    const { error } = await supabase
      .from('saved_portfolio_views')
      .insert({
        organisation_id: organisation.id,
        name: trimmedName,
        filters_json: filters,
        created_by: user.id,
        created_at: new Date().toISOString(),
      });

    if (error) {
      setSavedViewsError('Unable to save this view right now.');
      return;
    }

    setSavedViewsError(null);
    await loadSavedViews();
  };

  const applySavedView = (view: SavedPortfolioView) => {
    const parsedFilters = sanitizeSavedScopeFilters(view.filters_json);
    if (!parsedFilters) {
      setSavedViewsError('This saved view contains invalid filters and could not be applied.');
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (parsedFilters.client) {
      nextParams.set('client', encodeScopeValue(parsedFilters.client));
    } else {
      nextParams.delete('client');
    }

    if (parsedFilters.discipline) {
      nextParams.set('discipline', encodeScopeValue(parsedFilters.discipline));
    } else {
      nextParams.delete('discipline');
    }

    if (parsedFilters.site.trim()) {
      nextParams.set('site', parsedFilters.site);
    } else {
      nextParams.delete('site');
    }

    nextParams.set('window', String(parsedFilters.window));
    setSearchParams(nextParams, { replace: true });
    setSelectedSavedViewId(view.id);
    setSavedViewsError(null);
  };

  const deleteSavedView = async () => {
    if (!selectedSavedViewId || !user?.id) return;

    const selectedView = savedViews.find((view) => view.id === selectedSavedViewId);
    if (!selectedView) return;

    const canDelete = selectedView.created_by === user.id || isPlatformAdmin;
    if (!canDelete) {
      setSavedViewsError('You can only delete views you created.');
      return;
    }

    const confirmed = window.confirm(`Delete saved view "${selectedView.name}"?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from('saved_portfolio_views')
      .delete()
      .eq('id', selectedView.id)
      .eq('organisation_id', organisation?.id || '');

    if (error) {
      setSavedViewsError('Unable to delete this saved view right now.');
      return;
    }

    setSelectedSavedViewId('');
    setSavedViewsError(null);
    await loadSavedViews();
  };

  const activeScopeCount = Number(Boolean(scope.client)) + Number(Boolean(scope.disciplineOrType)) + Number(Boolean(scope.siteQuery?.trim()));

  const appendScopeToPath = (path: string) => {
    const next = new URLSearchParams();
    const [basePath, existingQuery = ''] = path.split('?');
    const existing = new URLSearchParams(existingQuery);
    existing.forEach((v, k) => next.append(k, v));

    if (scope.client) next.set('client', scope.client);
    if (scope.disciplineOrType) {
      if (scope.disciplineOrType === 'RISK_ENGINEERING') {
        next.set('discipline', 'risk');
      } else {
        next.set('type', scope.disciplineOrType === 'FSD' ? 'Fire Strategy' : scope.disciplineOrType);
      }
    }
    if (scope.siteQuery?.trim()) next.set('site', scope.siteQuery.trim());

    const q = next.toString();
    return q ? `${basePath}?${q}` : basePath;
  };

  const appendScopeToRecommendationsPath = (path: string) => {
    const next = new URLSearchParams();
    const [basePath, existingQuery = ''] = path.split('?');
    const existing = new URLSearchParams(existingQuery);
    existing.forEach((v, k) => next.append(k, v));

    if (scope.client) next.set('client', scope.client);
    if (scope.siteQuery?.trim()) next.set('site', scope.siteQuery.trim());

    const q = next.toString();
    return q ? `${basePath}?${q}` : basePath;
  };

  const getActionAgeingDrillThrough = (bucketKey: AgeingBucketConfig['key']): string | null => {
    if (bucketKey !== 'bucket_0_30') return null;
    return appendScopeToPath('/dashboard/action-register?status=open&status=in_progress&sourceType=assessment_action&openedWithinDays=30');
  };

  const getReAgeingDrillThrough = (bucketKey: AgeingBucketConfig['key']): string | null => {
    if (bucketKey !== 'bucket_0_30') return null;
    return appendScopeToRecommendationsPath('/recommendations?status=Active&createdWithinDays=30');
  };


  const getOldestUnresolvedDrillThrough = (row: (typeof metrics.oldestUnresolvedRemediation)[number]) => {
    if (row.sourceType === 'assessment_action') {
      const params = new URLSearchParams();
      params.append('status', 'open');
      params.append('status', 'in_progress');
      params.set('sourceType', 'assessment_action');
      if (row.documentId) params.set('document', row.documentId);
      return appendScopeToPath(`/dashboard/action-register?${params.toString()}`);
    }

    const params = new URLSearchParams();
    params.set('status', 'Active');
    if (row.clientLabel) params.set('client', row.clientLabel);
    if (row.siteLabel) params.set('site', row.siteLabel);
    return `/recommendations?${params.toString()}`;
  };

  const statusDistributionRows = useMemo(
    () => Object.entries(metrics.assessmentStatusCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    [metrics.assessmentStatusCounts]
  );

  const actionPriorityRows = useMemo(
    () => Object.entries(metrics.priorityCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        const order = ['P1', 'P2', 'P3', 'P4'];
        const aIndex = order.indexOf(a.label);
        const bIndex = order.indexOf(b.label);

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return b.count - a.count;
      }),
    [metrics.priorityCounts]
  );

  const actionStatusRows = useMemo(
    () => Object.entries(metrics.statusCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    [metrics.statusCounts]
  );

  const portfolioAiPayload = useMemo<PortfolioAiPayload>(() => ({
    selectedWindowDays,
    scope: {
      client: scope.client,
      disciplineOrType: scope.disciplineOrType,
      siteQuery: scope.siteQuery || '',
      windowDays: selectedWindowDays,
    },
    summary: {
      totalSites: metrics.totalSites,
      totalAssessments: metrics.totalAssessments,
      totalActions: metrics.totalActions,
      openP1Actions: metrics.openHighPriorityActions,
      updatedWithinWindowDays: metrics.updatedWithinWindowDays,
      createdCurrentWindow: metrics.createdCurrentWindow,
      createdPreviousWindow: metrics.createdPreviousWindow,
      updatedCurrentWindow: metrics.updatedCurrentWindow,
      updatedPreviousWindow: metrics.updatedPreviousWindow,
      openReRecommendations: metrics.openReRecommendations,
      openHighPriorityReRecommendations: metrics.openHighPriorityReRecommendations,
    },
    assessmentTrends: {
      createdCurrentWindow: metrics.createdCurrentWindow,
      createdPreviousWindow: metrics.createdPreviousWindow,
      updatedCurrentWindow: metrics.updatedCurrentWindow,
      updatedPreviousWindow: metrics.updatedPreviousWindow,
    },
    remediationTrends: {
      bySource: metrics.remediationTrends,
      combined: metrics.combinedRemediation,
    },
    assessmentActionAgeing: metrics.assessmentActionAgeing,
    reRecommendationAgeing: metrics.reRecommendationAgeing,
    assessmentActionVelocity: metrics.assessmentActionVelocity,
    reRecommendationVelocity: metrics.reRecommendationVelocity,
    assessmentStatusDistribution: statusDistributionRows
      .slice(0, 6)
      .map((row) => ({ label: row.label, count: row.count })),
    commonActionModules: metrics.commonActionGroups
      .slice(0, 5)
      .map((row) => ({ label: row.label, count: row.count })),
    actionProfile: {
      byPriority: actionPriorityRows
        .slice(0, 6)
        .map((row) => ({ label: row.label, count: row.count })),
      byStatus: actionStatusRows
        .slice(0, 6)
        .map((row) => ({ label: row.label, count: row.count })),
    },
    sitesRequiringAttention: metrics.topSites
      .slice(0, 5)
      .map((site) => ({
        siteName: site.siteName,
        clientName: site.clientName,
        openActions: site.openActions,
        overdueActions: site.overdueActions,
        p1OpenActions: site.p1OpenActions,
      })),
    hotspots: {
      rankingModel: {
        type: 'weighted_burden',
        disclaimer: metrics.hotspotConfig.description,
        weights: metrics.hotspotConfig.weights,
      },
      topSiteHotspots: metrics.siteHotspots
        .slice(0, 5)
        .map((row) => ({
          siteName: row.siteName,
          clientName: row.clientName,
          openP1AssessmentActions: row.openP1AssessmentActions,
          openHighReRecommendations: row.openHighReRecommendations,
          ageing90PlusItems: row.ageing90PlusItems,
          totalOpenItems: row.totalOpenItems,
          hotspotScore: row.hotspotScore,
        })),
      topModuleHotspots: metrics.moduleHotspots
        .slice(0, 5)
        .map((row) => ({
          moduleKey: row.moduleKey,
          openP1AssessmentActions: row.openP1AssessmentActions,
          openHighReRecommendations: row.openHighReRecommendations,
          ageing90PlusItems: row.ageing90PlusItems,
          totalOpenItems: row.totalOpenItems,
          openAssessmentActions: row.openAssessmentActions,
          openReRecommendations: row.openReRecommendations,
          moduleAlignmentNote: row.moduleKey === 'RE recommendations'
            ? 'Source-specific RE grouping; no strict module-key alignment to assessment actions.'
            : 'Assessment action module key grouping.',
          hotspotScore: row.hotspotScore,
        })),
      topClientHotspots: metrics.showClientHotspots
        ? metrics.clientHotspots
          .slice(0, 5)
          .map((row) => ({
            clientName: row.clientName,
            openP1AssessmentActions: row.openP1AssessmentActions,
            openHighReRecommendations: row.openHighReRecommendations,
            ageing90PlusItems: row.ageing90PlusItems,
            totalOpenItems: row.totalOpenItems,
            hotspotScore: row.hotspotScore,
          }))
        : undefined,
    },
  }), [
    actionPriorityRows,
    actionStatusRows,
    metrics.commonActionGroups,
    metrics.openHighPriorityActions,
    metrics.hotspotConfig.description,
    metrics.hotspotConfig.weights,
    metrics.siteHotspots,
    metrics.moduleHotspots,
    metrics.clientHotspots,
    metrics.showClientHotspots,
    metrics.topSites,
    metrics.totalActions,
    metrics.totalAssessments,
    metrics.totalSites,
    metrics.createdCurrentWindow,
    metrics.createdPreviousWindow,
    metrics.updatedCurrentWindow,
    metrics.updatedPreviousWindow,
    metrics.openReRecommendations,
    metrics.openHighPriorityReRecommendations,
    metrics.remediationTrends,
    metrics.combinedRemediation,
    metrics.assessmentActionAgeing,
    metrics.reRecommendationAgeing,
    metrics.assessmentActionVelocity,
    metrics.reRecommendationVelocity,
    metrics.updatedWithinWindowDays,
    selectedWindowDays,
    statusDistributionRows,
    scope.client,
    scope.disciplineOrType,
    scope.siteQuery,
  ]);

  const payloadSignature = useMemo(() => JSON.stringify(portfolioAiPayload), [portfolioAiPayload]);

  useEffect(() => {
    setExecutiveReport(null);
    setCopiedReport(false);
    setReportAiError(null);
    setLatestAiInsights(null);
  }, [payloadSignature]);

  const assessmentActionTrend = useMemo(
    () => metrics.remediationTrends.find((row) => row.sourceType === 'assessment_action' && !row.discipline),
    [metrics.remediationTrends]
  );

  const reRecommendationTrend = useMemo(
    () => metrics.remediationTrends.find((row) => row.sourceType === 're_recommendation' && row.discipline === 'risk_engineering'),
    [metrics.remediationTrends]
  );

  const summaryCards: CardMetric[] = [
    { label: 'Total Sites', value: metrics.totalSites, to: appendScopeToPath('/assessments') },
    {
      label: 'Total Assessments',
      value: metrics.totalAssessments,
      trendValue: metrics.createdCurrentWindow - metrics.createdPreviousWindow,
      to: appendScopeToPath(`/assessments?createdWithinDays=${selectedWindowDays}`),
    },
    {
      label: 'Open Assessment Actions',
      value: assessmentActionTrend?.totalOpen ?? 0,
      trendValue: (assessmentActionTrend?.openedCurrentWindow ?? 0) - (assessmentActionTrend?.openedPreviousWindow ?? 0),
      to: appendScopeToPath(`/dashboard/action-register?status=open&status=in_progress&sourceType=assessment_action`),
    },
    {
      label: 'Open Risk Engineering Recommendations',
      value: reRecommendationTrend?.totalOpen ?? 0,
      trendValue: (reRecommendationTrend?.openedCurrentWindow ?? 0) - (reRecommendationTrend?.openedPreviousWindow ?? 0),
      to: appendScopeToRecommendationsPath('/recommendations?status=Active'),
    },
    {
      label: `Updated Last ${selectedWindowDays} Days`,
      value: metrics.updatedWithinWindowDays,
      trendValue: metrics.updatedCurrentWindow - metrics.updatedPreviousWindow,
      to: appendScopeToPath(`/assessments?updatedWithinDays=${selectedWindowDays}`),
    },
  ];

  const generateExecutiveReport = () => {
    const report = generatePortfolioExecutiveReport({
      payload: portfolioAiPayload,
      aiInsights: latestAiInsights,
      aiError: reportAiError,
    });
    setExecutiveReport(report);
  };

  const copyExecutiveReport = async () => {
    if (!executiveReport) return;

    try {
      await navigator.clipboard.writeText(executiveReport.markdown);
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 1500);
    } catch {
      setCopiedReport(false);
    }
  };

  const downloadExecutiveReport = () => {
    if (!executiveReport) return;

    const blob = new Blob([executiveReport.markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-executive-report-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-slate-900">Portfolio</h1>
        <p className="mt-3 text-slate-600">Loading portfolio intelligence…</p>
      </div>
    );
  }

  const hasNoData = metrics.totalAssessments === 0 && metrics.totalActions === 0 && metrics.totalReRecommendations === 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Portfolio</h1>
          <p className="mt-2 text-slate-600">
            Read-only cross-site insight from existing assessments and action register data.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={generateExecutiveReport}
            disabled={hasNoData}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-md hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate Executive Report
          </button>
          <button
            type="button"
            onClick={() => setShowInsightPanel((current) => !current)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Analyse Portfolio
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <label className="text-sm text-slate-700 w-full md:min-w-72">
              <span className="block mb-1 font-medium">Saved Views</span>
              <select
                value={selectedSavedViewId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSelectedSavedViewId(nextId);
                  if (!nextId) return;
                  const nextView = savedViews.find((view) => view.id === nextId);
                  if (nextView) applySavedView(nextView);
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={savedViewsLoading || savedViews.length === 0}
              >
                <option value="">{savedViewsLoading ? 'Loading views...' : 'Select saved view'}</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>{view.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void deleteSavedView()}
              disabled={!selectedSavedViewId}
              className="inline-flex mt-6 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
          <button
            type="button"
            onClick={() => void saveCurrentView()}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800"
          >
            Save View
          </button>
        </div>
        {savedViewsError && (
          <p className="text-xs text-amber-700">{savedViewsError}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Client</span>
            <select
              value={scope.client || ALL_CLIENTS_VALUE}
              onChange={(event) => setClient(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value={ALL_CLIENTS_VALUE}>All clients</option>
              {scopeOptions.clients.map((client) => (
                <option key={client} value={client}>{client}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Discipline / type</span>
            <select
              value={scope.disciplineOrType || ALL_DISCIPLINES_VALUE}
              onChange={(event) => setDisciplineOrType(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value={ALL_DISCIPLINES_VALUE}>All disciplines</option>
              {scopeOptions.disciplineOrTypes.map((item) => (
                <option key={item} value={item}>{item === 'RISK_ENGINEERING' ? 'Risk Engineering' : item}</option>
              ))}
            </select>
          </label>
          <div className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Trend window</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setWindowDays(30)} className={`px-3 py-2 text-xs rounded-md border ${selectedWindowDays === 30 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>30D</button>
              <button type="button" onClick={() => setWindowDays(90)} className={`px-3 py-2 text-xs rounded-md border ${selectedWindowDays === 90 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>90D</button>
            </div>
          </div>
          <label className="text-sm text-slate-700">
            <span className="block mb-1 font-medium">Site search</span>
            <input
              value={scope.siteQuery || ''}
              onChange={(event) => setSiteQuery(event.target.value)}
              placeholder="Site or client"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Client: {scope.client || 'All clients'}</span>
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Discipline: {scope.disciplineOrType ? (scope.disciplineOrType === 'RISK_ENGINEERING' ? 'Risk Engineering' : scope.disciplineOrType) : 'All disciplines'}</span>
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Window: {selectedWindowDays}D</span>
            {scope.siteQuery?.trim() && <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Site: {scope.siteQuery.trim()}</span>}
          </div>
          {activeScopeCount > 0 && (
            <button type="button" onClick={clearScope} className="text-xs text-slate-600 hover:text-slate-900">Reset scope</button>
          )}
        </div>
      </div>

      {showInsightPanel && (
        <PortfolioInsightPanel
          isOpen={showInsightPanel}
          onClose={() => setShowInsightPanel(false)}
          payload={portfolioAiPayload}
          canGenerate={!hasNoData}
          initialInsights={latestAiInsights}
          onInsightsGenerated={(insights) => {
            setLatestAiInsights(insights);
            setReportAiError(null);
          }}
          onGenerationError={(message) => {
            setReportAiError(message);
          }}
        />
      )}

      {executiveReport && (
        <section className="bg-white rounded-lg border border-slate-200 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Portfolio Executive Report (Draft)</h2>
              <p className="text-sm text-slate-600 mt-1">Generated for the current visible scope. Review before external sharing.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyExecutiveReport()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                {copiedReport ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedReport ? 'Copied' : 'Copy report'}
              </button>
              <button
                type="button"
                onClick={downloadExecutiveReport}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                Download .md
              </button>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {executiveReport.scopeSummary}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Portfolio Overview</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {executiveReport.sections.portfolioOverview.map((item) => (<li key={item}>{item}</li>))}
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Key Risk Themes</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {executiveReport.sections.keyRiskThemes.map((item) => (<li key={item}>{item}</li>))}
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Remediation Status</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {executiveReport.sections.remediationStatus.map((item) => (<li key={item}>{item}</li>))}
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Major Risk Hotspots</h3>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {executiveReport.sections.majorRiskHotspots.map((item) => (<li key={item}>{item}</li>))}
              </ul>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Engineering Commentary</h3>
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              {executiveReport.sections.engineeringCommentary.map((item) => (<li key={item}>{item}</li>))}
            </ul>
          </div>

          <p className="text-xs text-slate-500">{executiveReport.limitations.join(' ')}</p>
        </section>
      )}

      {(assessmentsError || actionsError || recommendationsError) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          {assessmentsError && <p>Assessment data could not be fully loaded: {assessmentsError}</p>}
          {actionsError && <p>Action data could not be fully loaded: {actionsError}</p>}
          {recommendationsError && <p>Risk engineering recommendation data could not be fully loaded: {recommendationsError}</p>}
        </div>
      )}

      {hasNoData ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No portfolio data yet</h2>
          <p className="mt-2 text-slate-600">Create your first assessment to begin seeing portfolio-level analytics.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link
              to="/assessments"
              className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Go to Assessments
            </Link>
            <Link
              to="/assessments/new"
              className="px-4 py-2 bg-slate-900 rounded-md text-sm font-medium text-white hover:bg-slate-800"
            >
              New Assessment
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Portfolio Summary</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {summaryCards.map((card) => {
                const isClickable = Boolean(card.to);
                return (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => card.to && navigate(card.to, card.state ? { state: card.state } : undefined)}
                    className={`bg-white rounded-lg border p-5 text-left ${
                      isClickable
                        ? 'border-slate-300 hover:border-slate-400 hover:shadow-sm cursor-pointer transition'
                        : 'border-slate-200'
                    }`}
                  >
                    <p className="text-sm text-slate-500">{card.label}</p>
                    <p className={`mt-2 text-3xl font-bold ${card.label === 'Open P1 Actions' ? 'text-rose-700' : 'text-slate-900'}`}>
                      {card.value}
                    </p>
                    {typeof card.trendValue === 'number' && <TrendDelta value={card.trendValue} windowDays={selectedWindowDays} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Remediation Ageing</h2>
            <p className="text-sm text-slate-600 mt-1">Open-item ageing based on created date for each remediation source.</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Assessment Actions Ageing</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {AGEING_BUCKETS.map((bucket) => {
                    const to = getActionAgeingDrillThrough(bucket.key);
                    return (
                      <InteractiveRow
                        key={bucket.key}
                        label={bucket.label}
                        value={String(metrics.assessmentActionAgeing[bucket.key])}
                        onClick={to ? () => navigate(to, { state: { source: 'portfolio' } }) : undefined}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Risk Engineering Recommendations Ageing</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {AGEING_BUCKETS.map((bucket) => {
                    const to = getReAgeingDrillThrough(bucket.key);
                    return (
                      <InteractiveRow
                        key={bucket.key}
                        label={bucket.label}
                        value={String(metrics.reRecommendationAgeing[bucket.key])}
                        onClick={to ? () => navigate(to, { state: { source: 'portfolio' } }) : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">Drill-through is enabled where register filters can represent the bucket honestly.</p>
          </section>


          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Oldest Unresolved Remediation</h2>
            <p className="text-sm text-slate-600 mt-1">Showing the 10 oldest unresolved items in the current scope.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Site / Property</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Priority</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Age</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {metrics.oldestUnresolvedRemediation.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-sm text-center text-slate-500">
                        No unresolved remediation items found in the current scope.
                      </td>
                    </tr>
                  ) : (
                    metrics.oldestUnresolvedRemediation.map((row) => (
                      <tr key={`${row.sourceType}:${row.id}`} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-slate-700">{row.siteLabel || 'Unknown site'}</td>
                        <td className="px-4 py-3 text-sm text-slate-900 font-medium max-w-xs">
                          <p className="truncate" title={row.itemLabel || 'Untitled item'}>{row.itemLabel || 'Untitled item'}</p>
                          {scope.client ? null : (
                            <p className="text-xs text-slate-500 mt-0.5">{row.clientLabel || 'Unassigned client'}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{row.sourceLabel}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{row.priorityLabel || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{row.ageDays} days</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <button
                            type="button"
                            onClick={() => navigate(getOldestUnresolvedDrillThrough(row), { state: { source: 'portfolio' } })}
                            className="inline-flex items-center rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Remediation Velocity</h2>
            <p className="text-sm text-slate-600 mt-1">Opened versus closed/completed movement in the selected window.</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Assessment Actions</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <InteractiveRow
                    label={`Opened (${selectedWindowDays}D)`}
                    value={String(metrics.assessmentActionVelocity.openedCurrentWindow)}
                    onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?status=open&status=in_progress&openedWithinDays=${selectedWindowDays}&sourceType=assessment_action`), { state: { source: 'portfolio' } })}
                  />
                  <InteractiveRow
                    label={`Closed (${selectedWindowDays}D)`}
                    value={String(metrics.assessmentActionVelocity.closedCurrentWindow)}
                    onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?status=closed&closedWithinDays=${selectedWindowDays}&sourceType=assessment_action`), { state: { source: 'portfolio' } })}
                  />
                  <InteractiveRow
                    label="Net backlog change"
                    value={`${metrics.assessmentActionVelocity.netChange > 0 ? '+' : ''}${metrics.assessmentActionVelocity.netChange}`}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Risk Engineering Recommendations</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <InteractiveRow
                    label={`Opened (${selectedWindowDays}D)`}
                    value={String(metrics.reRecommendationVelocity.openedCurrentWindow)}
                    onClick={() => navigate(appendScopeToRecommendationsPath(`/recommendations?createdWithinDays=${selectedWindowDays}`), { state: { source: 'portfolio' } })}
                  />
                  <InteractiveRow
                    label={`Completed (${selectedWindowDays}D)`}
                    value={String(metrics.reRecommendationVelocity.closedCurrentWindow)}
                    onClick={() => navigate(appendScopeToRecommendationsPath(`/recommendations?status=Completed&completedWithinDays=${selectedWindowDays}`), { state: { source: 'portfolio' } })}
                  />
                  <InteractiveRow
                    label="Net backlog change"
                    value={`${metrics.reRecommendationVelocity.netChange > 0 ? '+' : ''}${metrics.reRecommendationVelocity.netChange}`}
                  />
                </div>
                <p className="mt-3 text-xs text-slate-500">Completed movement uses Completed status with updated_at timestamps because a dedicated RE completion timestamp is not currently exposed.</p>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Assessment Status Distribution</h2>
            <p className="text-sm text-slate-600 mt-1">Breakdown uses assessment status values currently available in the documents model.</p>
            <div className="mt-4 space-y-3">
              {statusDistributionRows.length === 0 ? (
                <p className="text-sm text-slate-500">No assessments available for status distribution.</p>
              ) : (
                statusDistributionRows.map((row) => {
                  const percentage = metrics.totalAssessments > 0 ? Math.round((row.count / metrics.totalAssessments) * 100) : 0;
                  return (
                    <div
                      key={row.label}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(appendScopeToPath(`/assessments?status=${encodeURIComponent(row.label)}`))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(appendScopeToPath(`/assessments?status=${encodeURIComponent(row.label)}`));
                        }
                      }}
                      className="rounded-md border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-slate-700">{formatPortfolioStatusLabel(row.label)}</span>
                        <span className="text-slate-600">{row.count} ({percentage}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-slate-700" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Common Action Modules</h2>
            <p className="text-sm text-slate-600 mt-1">Top module keys from action register entries (frequency-based).</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Module</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {metrics.commonActionGroups.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-sm text-center text-slate-500">
                        {actionsLoading ? 'Loading actions…' : 'No action groups available.'}
                      </td>
                    </tr>
                  ) : (
                    metrics.commonActionGroups.map((row, index) => (
                      <tr
                        key={row.label}
                        onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?module=${encodeURIComponent(row.label)}`))}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-slate-600">#{index + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{formatPortfolioGroupLabel(row.label)}</td>
                        <td className="px-4 py-3 text-sm text-right text-slate-700">{row.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Action Profile</h2>
            <p className="text-sm text-slate-600 mt-1">Priority and status profile from the organisation-level action register.</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">By Priority</h3>
                <div className="mt-3 space-y-2">
                  {actionPriorityRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No actions available.</p>
                  ) : (
                    actionPriorityRows.map((row) => (
                      <InteractiveRow
                        key={row.label}
                        label={row.label}
                        value={String(row.count)}
                        onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?priority=${encodeURIComponent(row.label)}`))}
                      />
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">By Status</h3>
                <div className="mt-3 space-y-2">
                  {actionStatusRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No actions available.</p>
                  ) : (
                    actionStatusRows.map((row) => (
                      <InteractiveRow
                        key={row.label}
                        label={formatPortfolioStatusLabel(row.label)}
                        value={String(row.count)}
                        onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?status=${encodeURIComponent(row.label)}`))}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Risk Hotspots</h2>
              <p className="text-sm text-slate-600 mt-1">
                Prioritisation aid for remediation burden. Weighted by open P1 assessment actions, open high-priority RE recommendations, 90+ day open backlog, and total open items.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                This hotspot ranking is not a validated engineering risk score.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900">Top Sites Requiring Attention</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Site</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Client</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">P1 Actions</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">High RE Recs</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">90+ Day Backlog</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Total Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {metrics.siteHotspots.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-sm text-center text-slate-500">
                          No site hotspots found in the current scope.
                        </td>
                      </tr>
                    ) : (
                      metrics.siteHotspots.map((site) => (
                        <tr
                          key={`${site.documentId}-${site.clientName}`}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => navigate(appendScopeToPath(`/dashboard/action-register?document=${encodeURIComponent(site.documentId)}&status=open&status=in_progress&sourceType=assessment_action`))}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{site.siteName}</td>
                          <td className="px-4 py-3 text-sm text-slate-700">{site.clientName}</td>
                          <td className="px-4 py-3 text-sm text-right text-rose-700 font-semibold">{site.openP1AssessmentActions}</td>
                          <td className="px-4 py-3 text-sm text-right text-amber-700 font-semibold">{site.openHighReRecommendations}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-700">{site.ageing90PlusItems}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900 font-semibold">{site.totalOpenItems}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900">Hotspot Modules</h3>
              <p className="text-xs text-slate-500 mt-1">
                Module hotspots use assessment action module keys plus a separate RE recommendations grouping where direct module alignment is not available.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Module / Theme</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">P1 Actions</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">High RE Recs</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">90+ Day Backlog</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Total Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {metrics.moduleHotspots.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-sm text-center text-slate-500">
                          No module hotspots found in the current scope.
                        </td>
                      </tr>
                    ) : (
                      metrics.moduleHotspots.map((row) => (
                        <tr
                          key={row.moduleKey}
                          className={row.moduleKey === 'RE recommendations' ? 'bg-slate-50' : 'hover:bg-slate-50 cursor-pointer transition-colors'}
                          onClick={row.moduleKey === 'RE recommendations'
                            ? undefined
                            : () => navigate(appendScopeToPath(`/dashboard/action-register?module=${encodeURIComponent(row.moduleKey)}&status=open&status=in_progress&sourceType=assessment_action`))}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{formatPortfolioGroupLabel(row.moduleKey)}</td>
                          <td className="px-4 py-3 text-sm text-right text-rose-700 font-semibold">{row.openP1AssessmentActions}</td>
                          <td className="px-4 py-3 text-sm text-right text-amber-700 font-semibold">{row.openHighReRecommendations}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-700">{row.ageing90PlusItems}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900 font-semibold">{row.totalOpenItems}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {metrics.showClientHotspots && (
              <div>
                <h3 className="text-base font-semibold text-slate-900">Client Hotspots</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Client</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">P1 Actions</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">High RE Recs</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">90+ Day Backlog</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Total Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {metrics.clientHotspots.map((clientRow) => (
                        <tr
                          key={clientRow.clientName}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => setClient(clientRow.clientName)}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{clientRow.clientName}</td>
                          <td className="px-4 py-3 text-sm text-right text-rose-700 font-semibold">{clientRow.openP1AssessmentActions}</td>
                          <td className="px-4 py-3 text-sm text-right text-amber-700 font-semibold">{clientRow.openHighReRecommendations}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-700">{clientRow.ageing90PlusItems}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900 font-semibold">{clientRow.totalOpenItems}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {(assessmentsLoading || actionsLoading) && (
            <p className="text-sm text-slate-500">
              Some sections may update as remaining data loads.
            </p>
          )}
        </>
      )}
    </div>
  );
}
