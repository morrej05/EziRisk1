import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link2, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import { bumpActionsVersion } from '../../lib/actions/actionsInvalidation';
import {
  ACTIVE_ACTION_STATUSES,
  buildFindingHash,
  buildRecommendationFromFinding,
  detailedFindingNeedsRecommendation,
  fetchExistingActionsForFinding,
  fetchFindingLinks,
  type ActionSourceLink,
  type DetailedFindingAssessment,
  type ExistingActionOption,
} from '../../lib/actions/actionSourceLinks';

interface DetailedFindingActionLinkProps {
  documentId: string;
  moduleInstanceId: string;
  moduleKey: string;
  sourceAssessmentType: string;
  sourceAssessmentKey: string;
  sourceAssessmentLabel: string;
  assessment: DetailedFindingAssessment;
  legacyLinkedActionReference?: string;
  onLinked?: () => void;
}

function formatActionRef(action?: ActionSourceLink['actions'] | ExistingActionOption | null): string {
  if (!action) return 'Linked action created';
  return action.reference_number || action.title || 'Linked action created';
}

function isActiveLinkedAction(link: ActionSourceLink): boolean {
  const action = link.actions;
  return Boolean(action && !action.deleted_at && ACTIVE_ACTION_STATUSES.includes(action.status as typeof ACTIVE_ACTION_STATUSES[number]));
}

function isSupabaseError(error: unknown): error is PostgrestError {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

function describeSupabaseError(error: unknown): string {
  if (!isSupabaseError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  return [
    error.code ? `code=${error.code}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean).join('; ');
}

function getLinkedActionCreateErrorMessage(error: unknown): string {
  if (import.meta.env.DEV) {
    return `Could not create the linked recommendation. ${describeSupabaseError(error)}`;
  }
  return 'Could not create the linked recommendation.';
}

function logSupabaseFailure(target: string, payload: Record<string, unknown>, error: unknown) {
  console.error('Detailed finding recommendation write failed', {
    target,
    payload,
    error,
    supabase: isSupabaseError(error)
      ? {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        }
      : null,
  });
}

export default function DetailedFindingActionLink({
  documentId,
  moduleInstanceId,
  moduleKey,
  sourceAssessmentType,
  sourceAssessmentKey,
  sourceAssessmentLabel,
  assessment,
  legacyLinkedActionReference,
  onLinked,
}: DetailedFindingActionLinkProps) {
  const { organisation } = useAuth();
  const [links, setLinks] = useState<ActionSourceLink[]>([]);
  const [existingActions, setExistingActions] = useState<ExistingActionOption[]>([]);
  const [selectedActionId, setSelectedActionId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRecommendation = useMemo(() => detailedFindingNeedsRecommendation(assessment), [assessment]);
  const activeLink = links.find(isActiveLinkedAction);
  const visibleLinks = links.filter((link) => link.actions && !link.actions.deleted_at);

  const loadLinks = useCallback(async () => {
    if (!documentId || !moduleInstanceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [sourceLinks, actions] = await Promise.all([
        fetchFindingLinks({ documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey }),
        fetchExistingActionsForFinding(documentId, moduleInstanceId),
      ]);
      setLinks(sourceLinks);
      setExistingActions(actions);
    } catch (loadError) {
      console.error('Failed to load detailed finding action links:', loadError);
      setError('Could not load linked recommendations.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const archiveInactiveFindingLinks = async (currentLinks: ActionSourceLink[]) => {
    const inactiveLinkIds = currentLinks
      .filter((link) => !isActiveLinkedAction(link))
      .map((link) => link.id);

    if (inactiveLinkIds.length === 0) return;

    const archivePayload = {
      deleted_at: new Date().toISOString(),
      document_id: documentId,
      module_instance_id: moduleInstanceId,
      source_assessment_type: sourceAssessmentType,
      source_assessment_key: sourceAssessmentKey,
      archived_link_ids: inactiveLinkIds,
    };

    const { error: archiveError } = await supabase
      .from('action_source_links')
      .update({ deleted_at: archivePayload.deleted_at })
      .in('id', inactiveLinkIds)
      .eq('document_id', documentId)
      .eq('module_instance_id', moduleInstanceId)
      .eq('source_assessment_type', sourceAssessmentType)
      .eq('source_assessment_key', sourceAssessmentKey)
      .is('deleted_at', null);

    if (archiveError) {
      logSupabaseFailure('action_source_links.update', archivePayload, archiveError);
      throw archiveError;
    }
  };

  const createSourceLink = async (actionId: string) => {
    const organisationId = organisation?.id;
    if (!organisationId) throw new Error('No organisation is selected.');

    const linkPayload = {
      organisation_id: organisationId,
      document_id: documentId,
      module_instance_id: moduleInstanceId,
      action_id: actionId,
      source_assessment_type: sourceAssessmentType,
      source_assessment_key: sourceAssessmentKey,
      source_assessment_label: sourceAssessmentLabel,
      source_finding_hash: buildFindingHash(assessment),
    };

    const { data, error: linkError } = await supabase
      .from('action_source_links')
      .insert([linkPayload])
      .select('*, actions(id, recommended_action, status, priority_band, reference_number, deleted_at)')
      .single();

    if (linkError) {
      logSupabaseFailure('action_source_links.insert', linkPayload, linkError);
      throw linkError;
    }
    setLinks((current) => [...current, data as ActionSourceLink]);
    bumpActionsVersion();
    onLinked?.();
  };

  const handleCreateRecommendation = async () => {
    if (activeLink) return;
    const organisationId = organisation?.id;
    if (!organisationId) {
      setError('No organisation is selected.');
      return;
    }

    setIsCreating(true);
    setError(null);
    let createdActionId: string | null = null;
    try {
      const latestLinks = await fetchFindingLinks({ documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey });
      const existingActive = latestLinks.find(isActiveLinkedAction);
      if (existingActive) {
        setLinks(latestLinks);
        return;
      }
      await archiveInactiveFindingLinks(latestLinks);

      const recommendation = buildRecommendationFromFinding({ assessment, sourceAssessmentLabel, moduleKey });
      const actionPayload = {
        organisation_id: organisationId,
        document_id: documentId,
        source_document_id: documentId,
        module_instance_id: moduleInstanceId,
        recommended_action: recommendation.recommendedAction,
        status: 'open',
        priority_band: recommendation.priority,
        severity_tier: recommendation.severity,
        timescale: recommendation.timescale,
        source: 'recommendation',
        finding_category: 'Other',
        recommendation_detail: recommendation.detail,
      };

      const { data: action, error: actionError } = await supabase
        .from('actions')
        .insert([actionPayload])
        .select('id')
        .single();

      if (actionError) {
        logSupabaseFailure('actions.insert', actionPayload, actionError);
        throw actionError;
      }
      createdActionId = action.id;
      await createSourceLink(action.id);
      createdActionId = null;
      await loadLinks();
    } catch (createError) {
      if (createdActionId) {
        const rollbackPayload = {
          id: createdActionId,
          document_id: documentId,
          module_instance_id: moduleInstanceId,
          deleted_at: new Date().toISOString(),
        };
        const { error: rollbackError } = await supabase
          .from('actions')
          .update({ deleted_at: rollbackPayload.deleted_at })
          .eq('id', createdActionId)
          .eq('document_id', documentId)
          .eq('module_instance_id', moduleInstanceId);

        if (rollbackError) {
          logSupabaseFailure('actions.update.rollback_soft_delete', rollbackPayload, rollbackError);
        }
      }

      console.error('Failed to create recommendation from detailed finding:', createError);
      setError(getLinkedActionCreateErrorMessage(createError));
    } finally {
      setIsCreating(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedActionId || activeLink) return;
    setIsCreating(true);
    setError(null);
    try {
      const latestLinks = await fetchFindingLinks({ documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey });
      const existingActive = latestLinks.find(isActiveLinkedAction);
      if (existingActive) {
        setLinks(latestLinks);
        return;
      }
      await archiveInactiveFindingLinks(latestLinks);
      await createSourceLink(selectedActionId);
      setSelectedActionId('');
      await loadLinks();
    } catch (linkError) {
      console.error('Failed to link existing action to detailed finding:', linkError);
      setError(import.meta.env.DEV ? `Could not link the selected action. ${describeSupabaseError(linkError)}` : 'Could not link the selected action.');
    } finally {
      setIsCreating(false);
    }
  };

  if (!needsRecommendation && visibleLinks.length === 0 && !legacyLinkedActionReference) return null;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-950">Recommendation linkage</p>
          {activeLink?.actions ? (
            <p className="text-sm text-blue-900">
              Linked recommendation: <strong>{formatActionRef(activeLink.actions)}</strong> / {activeLink.actions.status.replace(/_/g, ' ')}
            </p>
          ) : visibleLinks.length > 0 ? (
            visibleLinks.map((link) => link.actions && (
              <p key={link.id} className="text-sm text-blue-900">
                Linked recommendation: <strong>{formatActionRef(link.actions)}</strong> / {link.actions.status.replace(/_/g, ' ')}
              </p>
            ))
          ) : (
            <p className="text-sm text-blue-900">This finding can be linked to the central action register.</p>
          )}
          {legacyLinkedActionReference && (
            <p className="text-xs text-blue-800 mt-1">Legacy linked action reference: {legacyLinkedActionReference}</p>
          )}
        </div>
        <button type="button" onClick={loadLinks} disabled={isLoading} className="text-blue-700 hover:text-blue-900" title="Refresh linked recommendations">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {activeLink?.actions && (
        <a href={`/actions/${activeLink.actions.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900">
          <ExternalLink className="w-4 h-4" /> View/Open action
        </a>
      )}

      {needsRecommendation && !activeLink && (
        <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
          This finding is marked for action but has no linked recommendation.
        </p>
      )}

      {!activeLink && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <button type="button" onClick={handleCreateRecommendation} disabled={isCreating} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
            <Plus className="w-4 h-4" /> Create recommendation from this finding
          </button>
          <div className="flex min-w-0 flex-1 gap-2">
            <select value={selectedActionId} onChange={(event) => setSelectedActionId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-neutral-800">
              <option value="">Link existing open action...</option>
              {existingActions.map((action) => (
                <option key={action.id} value={action.id}>
                  {(action.reference_number || 'No ref')} / {action.status} — {action.recommended_action.slice(0, 90)}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleLinkExisting} disabled={!selectedActionId || isCreating} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
              <Link2 className="w-4 h-4" /> Link
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
