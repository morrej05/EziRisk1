import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Link2, Plus, RefreshCw } from 'lucide-react';
import AddActionModal from './AddActionModal';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import { bumpActionsVersion } from '../../lib/actions/actionsInvalidation';
import {
  ACTIVE_ACTION_STATUSES,
  areActionTextsNearDuplicate,
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [defaultRecommendationText, setDefaultRecommendationText] = useState('');

  const needsRecommendation = useMemo(() => detailedFindingNeedsRecommendation(assessment), [assessment]);
  const activeLinks = links.filter(isActiveLinkedAction);
  const activeLinkedActionIds = new Set(activeLinks.map((link) => link.action_id));
  const visibleLinks = links.filter((link) => link.actions && !link.actions.deleted_at);
  const unavailableLink = links.find((link) => !link.actions || link.actions.deleted_at);

  const buildLinkedActionUrl = useCallback((actionId: string) => {
    const params = new URLSearchParams({ openAction: actionId });

    if (moduleInstanceId) {
      params.set('m', moduleInstanceId);
    }

    return `/documents/${documentId}/workspace?${params.toString()}`;
  }, [documentId, moduleInstanceId]);

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

  const confirmNearDuplicateForSource = (candidateText: string, currentLinks: ActionSourceLink[], actionLabel = 'recommendation') => {
    const normalizedCandidate = candidateText.trim().toLowerCase();
    const exactDuplicateLink = currentLinks.find((link) =>
      link.actions &&
      !link.actions.deleted_at &&
      link.actions.recommended_action.trim().toLowerCase() === normalizedCandidate
    );

    if (exactDuplicateLink?.actions) {
      setError(`An identical linked recommendation already exists (${formatActionRef(exactDuplicateLink.actions)}). Linked recommendation shown below; change the wording if you need a genuinely different additional recommendation.`);
      return false;
    }

    const duplicateLink = currentLinks.find((link) =>
      link.actions &&
      !link.actions.deleted_at &&
      areActionTextsNearDuplicate(candidateText, link.actions.recommended_action)
    );

    if (!duplicateLink?.actions) return true;

    return window.confirm(
      `A linked recommendation for this finding already has very similar action text (${formatActionRef(duplicateLink.actions)}). ` +
      `Only create or link this additional ${actionLabel} if it is genuinely different. Continue?`
    );
  };

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
    if (links.some((link) => !link.deleted_at && link.action_id === actionId)) {
      throw new Error('This action is already linked to this finding.');
    }

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

  const handleCreateRecommendation = () => {
    const recommendation = buildRecommendationFromFinding({ assessment, sourceAssessmentLabel, moduleKey });
    setDefaultRecommendationText(recommendation.recommendedAction);
    setError(null);
    setShowAddModal(true);
  };

  const handleRecommendationCreated = async (actionId?: string) => {
    setShowAddModal(false);
    if (!actionId) {
      await loadLinks();
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const latestLinks = await fetchFindingLinks({ documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey });
      if (latestLinks.some((link) => !link.deleted_at && link.action_id === actionId)) {
        setLinks(latestLinks);
        return;
      }
      await archiveInactiveFindingLinks(latestLinks);
      await createSourceLink(actionId);
      await loadLinks();
    } catch (createError) {
      console.error('Failed to link recommendation from detailed finding:', createError);
      setError(getLinkedActionCreateErrorMessage(createError));
    } finally {
      setIsCreating(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedActionId) return;
    setIsCreating(true);
    setError(null);
    try {
      const latestLinks = await fetchFindingLinks({ documentId, moduleInstanceId, sourceAssessmentType, sourceAssessmentKey });
      if (latestLinks.some((link) => !link.deleted_at && link.action_id === selectedActionId)) {
        setLinks(latestLinks);
        setError('This action is already linked to this finding.');
        return;
      }
      const selectedAction = existingActions.find((action) => action.id === selectedActionId);
      if (selectedAction && !confirmNearDuplicateForSource(selectedAction.recommended_action, latestLinks, 'existing recommendation')) {
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

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-950">Recommendations</p>
          {visibleLinks.length > 0 ? (
            <div className="mt-1 space-y-1">
              {visibleLinks.map((link) => link.actions && (
                <div key={link.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-blue-900">
                  <span>
                    Linked recommendation: <strong>{formatActionRef(link.actions)}</strong> / {link.actions.status.replace(/_/g, ' ')}
                  </span>
                  <Link
                    to={buildLinkedActionUrl(link.actions.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                  >
                    <ExternalLink className="w-3 h-3" /> View recommendation
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-blue-900">Add a recommendation for this area when action is needed, or add one manually for assessor judgement.</p>
          )}
          {legacyLinkedActionReference && (
            <p className="text-xs text-blue-800 mt-1">Linked recommendation: {legacyLinkedActionReference}</p>
          )}
        </div>
        <button type="button" onClick={loadLinks} disabled={isLoading} className="text-blue-700 hover:text-blue-900" title="Refresh linked recommendations">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {unavailableLink && activeLinks.length === 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          The linked action could not be opened because it is missing, deleted, or no longer active. Refresh the linkage or create a new recommendation.
        </p>
      )}

      {needsRecommendation && activeLinks.length === 0 && (
        <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
          This finding is marked for action but has no linked recommendation.
        </p>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <button type="button" onClick={handleCreateRecommendation} disabled={isCreating} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
          <Plus className="w-4 h-4" /> {activeLinks.length > 0 ? 'Add another recommendation' : 'Add recommendation'}
        </button>
        <div className="flex min-w-0 flex-1 gap-2">
          <select value={selectedActionId} onChange={(event) => setSelectedActionId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-neutral-800">
            <option value="">Link existing open action...</option>
            {existingActions.map((action) => (
              <option key={action.id} value={action.id} disabled={activeLinkedActionIds.has(action.id)}>
                {(action.reference_number || 'No ref')} / {action.status} — {action.recommended_action.slice(0, 90)}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleLinkExisting} disabled={!selectedActionId || isCreating} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
            <Link2 className="w-4 h-4" /> Link existing
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      {showAddModal && (
        <AddActionModal
          documentId={documentId}
          moduleInstanceId={moduleInstanceId}
          defaultAction={defaultRecommendationText}
          source="recommendation"
          sourceModuleKey={moduleKey}
          onClose={() => setShowAddModal(false)}
          onActionCreated={handleRecommendationCreated}
        />
      )}
    </div>
  );
}
