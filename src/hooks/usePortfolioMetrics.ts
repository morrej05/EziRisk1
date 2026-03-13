import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAssessments } from './useAssessments';
import { getActionRegisterOrgLevel, type ActionRegisterEntry } from '../utils/actionRegister';

export interface SiteAttentionRow {
  siteName: string;
  clientName: string;
  openActions: number;
  overdueActions: number;
  p1OpenActions: number;
  latestAssessmentUpdate: Date | null;
}

export function usePortfolioMetrics() {
  const { organisation } = useAuth();
  const { assessments, loading: assessmentsLoading, error: assessmentsError } = useAssessments();
  const [actions, setActions] = useState<ActionRegisterEntry[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);

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

  const metrics = useMemo(() => {
    const uniqueSites = new Set(assessments.map((assessment) => `${assessment.clientName}::${assessment.siteName}`));
    const draftAssessments = assessments.filter((assessment) => assessment.status === 'Draft').length;
    const issuedAssessments = assessments.filter((assessment) => assessment.status === 'Issued').length;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const updatedLast30Days = assessments.filter((assessment) => assessment.updatedAt >= thirtyDaysAgo).length;

    const assessmentStatusCounts = assessments.reduce<Record<string, number>>((acc, assessment) => {
      acc[assessment.status] = (acc[assessment.status] || 0) + 1;
      return acc;
    }, {});

    const assessmentTypeCounts = assessments.reduce<Record<string, number>>((acc, assessment) => {
      acc[assessment.type] = (acc[assessment.type] || 0) + 1;
      return acc;
    }, {});

    const commonAssessmentTypes = Object.entries(assessmentTypeCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const openActions = actions.filter((action) => action.status !== 'closed');
    const openHighPriorityActions = openActions.filter((action) => action.priority_band === 'P1').length;

    const priorityCounts = actions.reduce<Record<string, number>>((acc, action) => {
      const key = action.priority_band || 'Unspecified';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const statusCounts = actions.reduce<Record<string, number>>((acc, action) => {
      const key = action.status || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const moduleKeyCounts = actions.reduce<Record<string, number>>((acc, action) => {
      const key = action.module_key || 'Unassigned module';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const commonActionGroups = Object.entries(moduleKeyCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const siteMap = new Map<string, SiteAttentionRow>();

    assessments.forEach((assessment) => {
      const siteKey = assessment.id;
      if (!siteMap.has(siteKey)) {
        siteMap.set(siteKey, {
          siteName: assessment.siteName,
          clientName: assessment.clientName,
          openActions: 0,
          overdueActions: 0,
          p1OpenActions: 0,
          latestAssessmentUpdate: assessment.updatedAt,
        });
      }
    });

    actions.forEach((action) => {
      const siteKey = action.document_id;
      const existing = siteMap.get(siteKey) || {
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
      totalAssessments: assessments.length,
      draftAssessments,
      issuedAssessments,
      updatedLast30Days,
      openHighPriorityActions,
      assessmentStatusCounts,
      commonAssessmentTypes,
      totalActions: actions.length,
      priorityCounts,
      statusCounts,
      commonActionGroups,
      topSites,
    };
  }, [actions, assessments]);

  return {
    assessments,
    actions,
    metrics,
    loading: assessmentsLoading || actionsLoading,
    assessmentsLoading,
    actionsLoading,
    assessmentsError,
    actionsError,
  };
}
