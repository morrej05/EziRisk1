import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAssessments } from './useAssessments';
import { getActionRegisterOrgLevel, type ActionRegisterEntry } from '../utils/actionRegister';
import { supabase } from '../lib/supabase';

type RemediationSourceType = 'assessment_action' | 're_recommendation';

interface ReRecommendationEntry {
  id: string;
  document_id: string;
  status: 'Open' | 'In Progress' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  created_at: string;
  updated_at: string;
  documents?: {
    id: string;
    title: string;
    organisation_id: string;
  };
}

export interface RemediationTrendRow {
  sourceType: RemediationSourceType;
  sourceLabel: string;
  discipline?: 'fra' | 'fsd' | 'dsear' | 'risk_engineering';
  totalOpen: number;
  openedCurrentWindow: number;
  openedPreviousWindow: number;
  closedCurrentWindow: number;
  closedPreviousWindow: number;
  urgentOpen?: number;
}

function getPortfolioWindowBounds(windowDays: 30 | 90) {
  const now = new Date();
  const currentWindowStart = new Date(now);
  currentWindowStart.setDate(now.getDate() - windowDays);

  const previousWindowStart = new Date(currentWindowStart);
  previousWindowStart.setDate(currentWindowStart.getDate() - windowDays);

  return {
    now,
    currentWindowStart,
    previousWindowStart,
  };
}

export interface SiteAttentionRow {
  documentId: string;
  siteName: string;
  clientName: string;
  openActions: number;
  overdueActions: number;
  p1OpenActions: number;
  latestAssessmentUpdate: Date | null;
}

export interface PortfolioScope {
  client: string | null;
  disciplineOrType: string | null;
  windowDays: 30 | 90;
  siteQuery?: string;
}

interface PortfolioScopeOptions {
  clients: string[];
  disciplineOrTypes: string[];
}

function normaliseDisciplineOrType(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toUpperCase().replace(/\s+/g, '_').replace(/[/-]+/g, '_');
}

function toAssessmentTypeToken(rawType: string): string {
  const token = normaliseDisciplineOrType(rawType);
  if (token === 'FIRE_STRATEGY') return 'FSD';
  return token;
}

export function usePortfolioMetrics(scope: PortfolioScope) {
  const { organisation } = useAuth();
  const { assessments, loading: assessmentsLoading, error: assessmentsError } = useAssessments();
  const [actions, setActions] = useState<ActionRegisterEntry[]>([]);
  const [reRecommendations, setReRecommendations] = useState<ReRecommendationEntry[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  useEffect(() => {
    if (!organisation?.id) {
      setActions([]);
      setActionsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchActions() {
      try {
        setActionsLoading(true);
        setActionsError(null);
        const data = await getActionRegisterOrgLevel(organisation.id);

        if (!cancelled) {
          setActions(data);
        }
      } catch (error) {
        if (!cancelled) {
          setActionsError(error instanceof Error ? error.message : 'Failed to load actions');
          setActions([]);
        }
      } finally {
        if (!cancelled) {
          setActionsLoading(false);
        }
      }
    }

    fetchActions();

    return () => {
      cancelled = true;
    };
  }, [organisation?.id]);

  useEffect(() => {
    if (!organisation?.id) {
      setReRecommendations([]);
      setRecommendationsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchRecommendations() {
      try {
        setRecommendationsLoading(true);
        setRecommendationsError(null);

        const { data, error } = await supabase
          .from('re_recommendations')
          .select(`
            id,
            document_id,
            status,
            priority,
            created_at,
            updated_at,
            documents!inner(id, title, organisation_id)
          `)
          .eq('is_suppressed', false)
          .eq('documents.organisation_id', organisation.id);

        if (error) throw error;

        if (!cancelled) {
          setReRecommendations((data || []) as ReRecommendationEntry[]);
        }
      } catch (error) {
        if (!cancelled) {
          setRecommendationsError(error instanceof Error ? error.message : 'Failed to load risk engineering recommendations');
          setReRecommendations([]);
        }
      } finally {
        if (!cancelled) {
          setRecommendationsLoading(false);
        }
      }
    }

    fetchRecommendations();

    return () => {
      cancelled = true;
    };
  }, [organisation?.id]);

  const scopeOptions = useMemo<PortfolioScopeOptions>(() => {
    const clients = new Set<string>();
    const disciplineOrTypes = new Set<string>();

    assessments.forEach((assessment) => {
      if (assessment.clientName) clients.add(assessment.clientName);
      const typeToken = toAssessmentTypeToken(assessment.type);
      if (typeToken) disciplineOrTypes.add(typeToken);
    });

    actions.forEach((action) => {
      const typeToken = toAssessmentTypeToken(action.document_type);
      if (typeToken) disciplineOrTypes.add(typeToken);
    });

    if (reRecommendations.length > 0) {
      disciplineOrTypes.add('RISK_ENGINEERING');
    }

    return {
      clients: Array.from(clients).sort((a, b) => a.localeCompare(b)),
      disciplineOrTypes: Array.from(disciplineOrTypes).sort((a, b) => a.localeCompare(b)),
    };
  }, [actions, assessments, reRecommendations]);

  const metrics = useMemo(() => {
    const selectedClient = scope.client?.trim() || null;
    const selectedDisciplineOrType = normaliseDisciplineOrType(scope.disciplineOrType);
    const selectedSiteQuery = scope.siteQuery?.trim().toLowerCase() || '';

    const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));

    const scopedAssessments = assessments.filter((assessment) => {
      if (selectedClient && assessment.clientName !== selectedClient) return false;

      if (selectedDisciplineOrType) {
        const assessmentTypeToken = toAssessmentTypeToken(assessment.type);
        if (assessmentTypeToken !== selectedDisciplineOrType) return false;
      }

      if (selectedSiteQuery) {
        const siteMatches = assessment.siteName.toLowerCase().includes(selectedSiteQuery);
        const clientMatches = assessment.clientName.toLowerCase().includes(selectedSiteQuery);
        if (!siteMatches && !clientMatches) return false;
      }

      return true;
    });

    const scopedActions = actions.filter((action) => {
      const linkedAssessment = assessmentById.get(action.document_id);

      if (selectedClient) {
        const clientName = linkedAssessment?.clientName || '';
        if (clientName !== selectedClient) return false;
      }

      if (selectedDisciplineOrType) {
        const actionTypeToken = toAssessmentTypeToken(action.document_type);
        if (actionTypeToken !== selectedDisciplineOrType) return false;
      }

      if (selectedSiteQuery) {
        const siteMatches = action.document_title.toLowerCase().includes(selectedSiteQuery);
        const clientMatches = linkedAssessment?.clientName.toLowerCase().includes(selectedSiteQuery) || false;
        if (!siteMatches && !clientMatches) return false;
      }

      return true;
    });

    const scopedReRecommendations = reRecommendations.filter((recommendation) => {
      const linkedAssessment = assessmentById.get(recommendation.document_id);

      if (selectedClient) {
        const clientName = linkedAssessment?.clientName || '';
        if (clientName !== selectedClient) return false;
      }

      if (selectedDisciplineOrType && selectedDisciplineOrType !== 'RISK_ENGINEERING') {
        return false;
      }

      if (selectedSiteQuery) {
        const siteTitle = recommendation.documents?.title || linkedAssessment?.siteName || '';
        const siteMatches = siteTitle.toLowerCase().includes(selectedSiteQuery);
        const clientMatches = linkedAssessment?.clientName.toLowerCase().includes(selectedSiteQuery) || false;
        if (!siteMatches && !clientMatches) return false;
      }

      return true;
    });

    const uniqueSites = new Set(scopedAssessments.map((assessment) => `${assessment.clientName}::${assessment.siteName}`));
    const draftAssessments = scopedAssessments.filter((assessment) => assessment.status === 'Draft').length;
    const issuedAssessments = scopedAssessments.filter((assessment) => assessment.status === 'Issued').length;

    const { now, currentWindowStart, previousWindowStart } = getPortfolioWindowBounds(scope.windowDays);

    const isWithinRange = (date: Date | null, rangeStart: Date, rangeEnd: Date) => {
      if (!date) return false;
      return date >= rangeStart && date < rangeEnd;
    };

    const updatedWithinWindowDays = scopedAssessments.filter((assessment) => assessment.updatedAt >= currentWindowStart).length;
    const createdCurrentWindow = scopedAssessments.filter((assessment) => isWithinRange(assessment.createdAt, currentWindowStart, now)).length;
    const createdPreviousWindow = scopedAssessments.filter((assessment) => isWithinRange(assessment.createdAt, previousWindowStart, currentWindowStart)).length;
    const updatedCurrentWindow = scopedAssessments.filter((assessment) => isWithinRange(assessment.updatedAt, currentWindowStart, now)).length;
    const updatedPreviousWindow = scopedAssessments.filter((assessment) => isWithinRange(assessment.updatedAt, previousWindowStart, currentWindowStart)).length;

    const assessmentStatusCounts = scopedAssessments.reduce<Record<string, number>>((acc, assessment) => {
      acc[assessment.status] = (acc[assessment.status] || 0) + 1;
      return acc;
    }, {});

    const assessmentTypeCounts = scopedAssessments.reduce<Record<string, number>>((acc, assessment) => {
      acc[assessment.type] = (acc[assessment.type] || 0) + 1;
      return acc;
    }, {});

    const commonAssessmentTypes = Object.entries(assessmentTypeCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const openActions = scopedActions.filter((action) => action.status !== 'closed');
    const openHighPriorityActions = openActions.filter((action) => action.priority_band === 'P1').length;

    const openReRecommendations = scopedReRecommendations.filter((rec) => rec.status !== 'Completed');
    const openHighPriorityReRecommendations = openReRecommendations.filter((rec) => rec.priority === 'High').length;

    const parseDate = (value: string | null | undefined) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const actionTrendRowsByDiscipline: RemediationTrendRow[] = [
      { sourceType: 'assessment_action', sourceLabel: 'Assessment Actions', discipline: 'fra' },
      { sourceType: 'assessment_action', sourceLabel: 'Assessment Actions', discipline: 'fsd' },
      { sourceType: 'assessment_action', sourceLabel: 'Assessment Actions', discipline: 'dsear' },
    ].map((seed) => ({
      ...seed,
      totalOpen: 0,
      openedCurrentWindow: 0,
      openedPreviousWindow: 0,
      closedCurrentWindow: 0,
      closedPreviousWindow: 0,
      urgentOpen: 0,
    }));

    const disciplineIndex: Record<string, number> = { FRA: 0, FSD: 1, DSEAR: 2 };

    scopedActions.forEach((action) => {
      const createdAt = parseDate(action.created_at);
      const closedAt = parseDate(action.closed_at);
      const isOpen = action.status !== 'closed';

      const index = disciplineIndex[action.document_type];
      if (index === undefined) return;
      const row = actionTrendRowsByDiscipline[index];

      if (isOpen) row.totalOpen += 1;
      if (isWithinRange(createdAt, currentWindowStart, now)) row.openedCurrentWindow += 1;
      if (isWithinRange(createdAt, previousWindowStart, currentWindowStart)) row.openedPreviousWindow += 1;
      if (isWithinRange(closedAt, currentWindowStart, now)) row.closedCurrentWindow += 1;
      if (isWithinRange(closedAt, previousWindowStart, currentWindowStart)) row.closedPreviousWindow += 1;
      if (isOpen && action.priority_band === 'P1') row.urgentOpen = (row.urgentOpen || 0) + 1;
    });

    const assessmentActionTrend: RemediationTrendRow = actionTrendRowsByDiscipline.reduce((acc, row) => ({
      sourceType: 'assessment_action',
      sourceLabel: 'Assessment Actions',
      totalOpen: acc.totalOpen + row.totalOpen,
      openedCurrentWindow: acc.openedCurrentWindow + row.openedCurrentWindow,
      openedPreviousWindow: acc.openedPreviousWindow + row.openedPreviousWindow,
      closedCurrentWindow: acc.closedCurrentWindow + row.closedCurrentWindow,
      closedPreviousWindow: acc.closedPreviousWindow + row.closedPreviousWindow,
      urgentOpen: (acc.urgentOpen || 0) + (row.urgentOpen || 0),
    }), {
      sourceType: 'assessment_action',
      sourceLabel: 'Assessment Actions',
      totalOpen: 0,
      openedCurrentWindow: 0,
      openedPreviousWindow: 0,
      closedCurrentWindow: 0,
      closedPreviousWindow: 0,
      urgentOpen: 0,
    } satisfies RemediationTrendRow);

    const reRecommendationTrend: RemediationTrendRow = {
      sourceType: 're_recommendation',
      sourceLabel: 'Risk Engineering Recommendations',
      discipline: 'risk_engineering',
      totalOpen: 0,
      openedCurrentWindow: 0,
      openedPreviousWindow: 0,
      closedCurrentWindow: 0,
      closedPreviousWindow: 0,
      urgentOpen: 0,
    };

    scopedReRecommendations.forEach((rec) => {
      const createdAt = parseDate(rec.created_at);
      const updatedAt = parseDate(rec.updated_at);
      const isOpen = rec.status !== 'Completed';

      if (isOpen) reRecommendationTrend.totalOpen += 1;
      if (isWithinRange(createdAt, currentWindowStart, now)) reRecommendationTrend.openedCurrentWindow += 1;
      if (isWithinRange(createdAt, previousWindowStart, currentWindowStart)) reRecommendationTrend.openedPreviousWindow += 1;
      // RE recommendations do not currently expose a dedicated closed_at field.
      // We count "Completed" recommendations updated within the period as closure movement.
      if (rec.status === 'Completed' && isWithinRange(updatedAt, currentWindowStart, now)) reRecommendationTrend.closedCurrentWindow += 1;
      if (rec.status === 'Completed' && isWithinRange(updatedAt, previousWindowStart, currentWindowStart)) reRecommendationTrend.closedPreviousWindow += 1;
      if (isOpen && rec.priority === 'High') reRecommendationTrend.urgentOpen = (reRecommendationTrend.urgentOpen || 0) + 1;
    });

    const remediationTrends: RemediationTrendRow[] = [
      assessmentActionTrend,
      reRecommendationTrend,
      ...actionTrendRowsByDiscipline,
    ];

    const combinedOpenRemediation = assessmentActionTrend.totalOpen + reRecommendationTrend.totalOpen;
    const combinedNetFlowCurrent = (assessmentActionTrend.openedCurrentWindow + reRecommendationTrend.openedCurrentWindow)
      - (assessmentActionTrend.closedCurrentWindow + reRecommendationTrend.closedCurrentWindow);
    const combinedNetFlowPrevious = (assessmentActionTrend.openedPreviousWindow + reRecommendationTrend.openedPreviousWindow)
      - (assessmentActionTrend.closedPreviousWindow + reRecommendationTrend.closedPreviousWindow);

    const priorityCounts = scopedActions.reduce<Record<string, number>>((acc, action) => {
      const key = action.priority_band || 'Unspecified';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const statusCounts = scopedActions.reduce<Record<string, number>>((acc, action) => {
      const key = action.status || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const moduleKeyCounts = scopedActions.reduce<Record<string, number>>((acc, action) => {
      const key = action.module_key || 'Unassigned module';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const commonActionGroups = Object.entries(moduleKeyCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const siteMap = new Map<string, SiteAttentionRow>();

    scopedAssessments.forEach((assessment) => {
      const siteKey = assessment.id;
      if (!siteMap.has(siteKey)) {
        siteMap.set(siteKey, {
          documentId: assessment.id,
          siteName: assessment.siteName,
          clientName: assessment.clientName,
          openActions: 0,
          overdueActions: 0,
          p1OpenActions: 0,
          latestAssessmentUpdate: assessment.updatedAt,
        });
      }
    });

    scopedActions.forEach((action) => {
      const siteKey = action.document_id;
      const existing = siteMap.get(siteKey) || {
        documentId: action.document_id,
        siteName: action.document_title,
        clientName: 'Unassigned',
        openActions: 0,
        overdueActions: 0,
        p1OpenActions: 0,
        latestAssessmentUpdate: null,
      };

      const isOpen = action.status !== 'closed';
      const isOverdue = action.tracking_status === 'overdue' && isOpen;
      const isP1Open = isOpen && action.priority_band === 'P1';

      siteMap.set(siteKey, {
        ...existing,
        openActions: existing.openActions + (isOpen ? 1 : 0),
        overdueActions: existing.overdueActions + (isOverdue ? 1 : 0),
        p1OpenActions: existing.p1OpenActions + (isP1Open ? 1 : 0),
      });
    });

    const topSites = Array.from(siteMap.values())
      .filter((site) => site.openActions > 0)
      .sort((a, b) => {
        if (b.p1OpenActions !== a.p1OpenActions) return b.p1OpenActions - a.p1OpenActions;
        if (b.overdueActions !== a.overdueActions) return b.overdueActions - a.overdueActions;
        return b.openActions - a.openActions;
      })
      .slice(0, 10);

    return {
      totalSites: uniqueSites.size,
      totalAssessments: scopedAssessments.length,
      draftAssessments,
      issuedAssessments,
      selectedWindowDays: scope.windowDays,
      createdCurrentWindow,
      createdPreviousWindow,
      updatedCurrentWindow,
      updatedPreviousWindow,
      updatedWithinWindowDays,
      openHighPriorityActions,
      openReRecommendations: openReRecommendations.length,
      openHighPriorityReRecommendations,
      assessmentStatusCounts,
      commonAssessmentTypes,
      totalActions: scopedActions.length,
      totalReRecommendations: scopedReRecommendations.length,
      priorityCounts,
      statusCounts,
      commonActionGroups,
      topSites,
      remediationTrends,
      combinedRemediation: {
        totalOpen: combinedOpenRemediation,
        netFlowCurrentWindow: combinedNetFlowCurrent,
        netFlowPreviousWindow: combinedNetFlowPrevious,
        safeToCombine: true,
        caveat: 'Combined remediation counts are volume-only because assessment actions and RE recommendations use different status and urgency models.',
      },
    };
  }, [actions, assessments, reRecommendations, scope.client, scope.disciplineOrType, scope.siteQuery, scope.windowDays]);

  return {
    assessments,
    actions,
    scopeOptions,
    metrics,
    loading: assessmentsLoading || actionsLoading || recommendationsLoading,
    assessmentsLoading,
    actionsLoading,
    recommendationsLoading,
    assessmentsError,
    actionsError,
    recommendationsError,
  };
}
