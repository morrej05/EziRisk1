import { useState, useEffect } from "react";
import { Plus, AlertCircle, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import AddActionModal from "../actions/AddActionModal";
import ActionDetailModal from "../actions/ActionDetailModal";
import FeedbackModal from "../FeedbackModal";
import {
  bumpActionsVersion,
  subscribeActionsVersion,
  getActionsVersion,
} from "../../lib/actions/actionsInvalidation";
import { uploadAttachment } from "../../utils/evidenceManagement";
import {
  filterReRecommendationsByScope,
  hasReRecommendationWorkflow,
  isReRecommendationsRegisterModule,
} from "../../lib/re/recommendations/moduleRecommendationFilters";
import CanonicalReRecommendationModal from "../re/CanonicalReRecommendationModal";
import { RecommendationCard } from "../recommendations/RecommendationWorkflow";
import { buildRecommendationContext } from "../../lib/re/recommendations/sectionRecommendationContext";
import { getModuleDisplayLabel } from "../../lib/modules/moduleCatalog";

interface Action {
  id: string;
  recommended_action: string;
  status: string;
  priority_band: string | null;
  target_date: string | null;
  timescale?: string | null;
  updated_at: string;
  source: string | null;
  owner_user_id: string | null;
  reference_number?: string;
  recommendation_detail?: Record<string, unknown> | null;
  trigger_text?: string | null;
  document: {
    id: string;
    title: string;
    document_type: string;
  } | null;
  module_instance: {
    id: string;
    module_key: string;
    outcome: string | null;
  } | null;
  owner: {
    id: string;
    name: string | null;
  } | null;
  attachment_count: number;
}

interface ModuleActionsProps {
  documentId: string;
  moduleInstanceId: string;
  buttonLabel?: string;
  useInPlaceReRecommendationModal?: boolean;
  sectionKey?: string;
  sectionLabel?: string;
  sourceKey?: string;
  sourceLabel?: string;
  defaultCategory?: string;
  compact?: boolean;
}

const isValidUUID = (id: string | undefined | null): boolean => {
  if (!id) return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

export default function ModuleActions({
  documentId,
  moduleInstanceId,
  buttonLabel = "Add Recommendation",
  sectionKey,
  sectionLabel,
  sourceKey,
  sourceLabel,
  defaultCategory,
  compact = false,
}: ModuleActionsProps) {
  const { user } = useAuth();
  const [actions, setActions] = useState<Action[]>([]);
  const [isReModule, setIsReModule] = useState(false);
  const [sourceModuleKey, setSourceModuleKey] = useState<string | null>(null);
  const [isModuleTypeLoaded, setIsModuleTypeLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showReRecommendationModal, setShowReRecommendationModal] =
    useState(false);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [documentStatus, setDocumentStatus] = useState<string>("draft");
  const [actionToDelete, setActionToDelete] = useState<string | null>(null);
  const [actionsVersion, setActionsVersion] = useState(getActionsVersion());
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);

  const recommendationContext = sourceModuleKey
    ? buildRecommendationContext({
        documentId,
        moduleInstanceId,
        moduleKey: sourceModuleKey,
        sectionKey,
        sectionLabel,
        sourceKey,
        sourceLabel,
        defaultCategory,
        warnOnMissingContext: showReRecommendationModal,
      })
    : null;

  const [feedback, setFeedback] = useState<{
    isOpen: boolean;
    type: "success" | "error" | "warning";
    title: string;
    message: string;
    autoClose?: boolean;
  }>({
    isOpen: false,
    type: "success",
    title: "",
    message: "",
    autoClose: false,
  });

  useEffect(() => {
    const unsubscribe = subscribeActionsVersion(() =>
      setActionsVersion(getActionsVersion()),
    );
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadModuleType = async () => {
      const { data } = await supabase
        .from("module_instances")
        .select("module_key")
        .eq("id", moduleInstanceId)
        .maybeSingle();

      setSourceModuleKey(data?.module_key || null);
      setIsReModule(hasReRecommendationWorkflow(data?.module_key || null));
      setIsModuleTypeLoaded(true);
    };

    loadModuleType();
  }, [moduleInstanceId]);

  useEffect(() => {
    if (!isModuleTypeLoaded) return;
    if (!isValidUUID(documentId)) {
      console.warn("ModuleActions: Invalid documentId provided:", documentId);
      setIsLoading(false);
      return;
    }
    if (!isValidUUID(moduleInstanceId)) {
      console.warn(
        "ModuleActions: Invalid moduleInstanceId provided:",
        moduleInstanceId,
      );
      setIsLoading(false);
      return;
    }
    fetchActions();
    fetchDocumentStatus();
  }, [
    moduleInstanceId,
    documentId,
    actionsVersion,
    isReModule,
    sourceModuleKey,
    isModuleTypeLoaded,
    sectionKey,
    sourceKey,
    defaultCategory,
  ]);

  const handleInlineEvidenceUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !user?.id) return;

    setIsUploadingEvidence(true);
    try {
      const { data: docData, error: docError } = await supabase
        .from("documents")
        .select("organisation_id, base_document_id")
        .eq("id", documentId)
        .single();

      if (docError || !docData)
        throw docError || new Error("Document not found");

      let successCount = 0;
      for (const file of Array.from(files)) {
        const result = await uploadAttachment(
          docData.organisation_id,
          documentId,
          docData.base_document_id,
          file,
          undefined,
          moduleInstanceId,
        );
        if (!result.success) throw new Error(result.error || "Upload failed");
        successCount++;
      }

      setFeedback({
        isOpen: true,
        type: "success",
        title: "Evidence linked",
        message: `${successCount} file${successCount === 1 ? "" : "s"} linked to this module.`,
        autoClose: true,
      });
      fetchActions();
    } catch (error) {
      console.error("Error uploading inline evidence:", error);
      setFeedback({
        isOpen: true,
        type: "error",
        title: "Evidence upload failed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsUploadingEvidence(false);
      event.target.value = "";
    }
  };

  const fetchActions = async () => {
    if (!isValidUUID(moduleInstanceId)) {
      console.error(
        "ModuleActions.fetchActions: Invalid moduleInstanceId:",
        moduleInstanceId,
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      if (isReModule) {
        const { data: recs, error: recError } = await supabase
          .from("re_recommendations")
          .select(
            "id, title, observation_text, action_required_text, status, priority, target_date, updated_at, module_instance_id, source_module_key, source_factor_key, photos, category, metadata, rec_number",
          )
          .eq("document_id", documentId)
          .eq("is_suppressed", false)
          .order("created_at", { ascending: false });

        if (recError) throw recError;

        type ReRecommendationRow = {
          id: string;
          title: string;
          status: string;
          priority: string;
          target_date: string | null;
          updated_at: string;
          module_instance_id: string | null;
          source_module_key: string | null;
          source_factor_key: string | null;
          observation_text?: string | null;
          action_required_text?: string | null;
          photos?: unknown;
          category?: string | null;
          metadata?: Record<string, unknown> | null;
          rec_number?: string | null;
        };

        const moduleScopedRecs = filterReRecommendationsByScope(
          (recs || []) as ReRecommendationRow[],
          {
            scope: "module",
            moduleInstanceId,
            isRegisterModule:
              isReRecommendationsRegisterModule(sourceModuleKey),
          },
        );

        const sectionScopedRecs = recommendationContext
          ? moduleScopedRecs.filter((rec) => {
              const meta = rec.metadata || {};
              return (
                rec.source_factor_key === recommendationContext.sourceKey ||
                meta.sourceKey === recommendationContext.sourceKey ||
                meta.sectionKey === recommendationContext.sectionKey
              );
            })
          : moduleScopedRecs;

        const priorityMap: Record<string, string> = {
          High: "P1",
          Medium: "P2",
          Low: "P3",
        };
        const statusMap: Record<string, string> = {
          Open: "open",
          "In Progress": "in_progress",
          Completed: "closed",
        };

        const mappedReActions: Action[] = sectionScopedRecs.map((rec: ReRecommendationRow) => ({
            id: rec.id,
            recommended_action: rec.action_required_text || rec.title,
            status: statusMap[rec.status] || "open",
            priority_band: priorityMap[rec.priority] || "P3",
            target_date: rec.target_date,
            timescale: null,
            updated_at: rec.updated_at,
            source: "re_recommendations",
            owner_user_id: null,
            reference_number: rec.rec_number || undefined,
            recommendation_detail: {
              observation: rec.observation_text || rec.title,
              category: rec.category,
              metadata: rec.metadata,
            },
            document: null,
            module_instance: null,
            owner: null,
            attachment_count: Array.isArray(rec.photos) ? rec.photos.length : 0,
          }));

        setActions(mappedReActions);
        return;
      }

      const { data, error } = await supabase
        .from("actions")
        .select(
          `
          id,
          recommended_action,
          status,
          priority_band,
          target_date,
          timescale,
          updated_at,
          source,
          owner_user_id,
          reference_number,
          recommendation_detail,
          trigger_text,
          created_at,
          document:documents!actions_document_id_fkey(id,title,document_type),
          module_instance:module_instances(id,module_key,outcome),
          owner:user_profiles(id,name)
        `,
        )
        .eq("module_instance_id", moduleInstanceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const actionIds = (data || []).map((a) => a.id);
      const attachmentCounts: Record<string, number> = {};

      if (actionIds.length > 0) {
        const { data: attachmentData } = await supabase
          .from("attachments")
          .select("action_id")
          .in("action_id", actionIds)
          .not("action_id", "is", null);

        attachmentData?.forEach((att) => {
          if (att.action_id) {
            attachmentCounts[att.action_id] =
              (attachmentCounts[att.action_id] || 0) + 1;
          }
        });
      }

      const actionsWithAttachments = (data || []).map((action) => ({
        ...action,
        attachment_count: attachmentCounts[action.id] || 0,
      }));

      const scopedActions = recommendationContext
        ? actionsWithAttachments.filter((action) => {
            const detail = action.recommendation_detail || {};
            const metadata =
              typeof detail.metadata === "object" && detail.metadata !== null
                ? (detail.metadata as Record<string, unknown>)
                : {};

            return (
              metadata.sourceKey === recommendationContext.sourceKey ||
              metadata.sectionKey === recommendationContext.sectionKey ||
              detail.sourceKey === recommendationContext.sourceKey ||
              detail.sectionKey === recommendationContext.sectionKey
            );
          })
        : actionsWithAttachments;

      setActions(scopedActions as unknown as Action[]);
    } catch (error) {
      console.error("Error fetching actions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDocumentStatus = async () => {
    if (!isValidUUID(documentId)) {
      console.error(
        "ModuleActions.fetchDocumentStatus: Invalid documentId:",
        documentId,
      );
      return;
    }

    try {
      const { data, error } = await supabase
        .from("documents")
        .select("status, document_type")
        .eq("id", documentId)
        .maybeSingle();

      if (error) throw error;
      if (data) setDocumentStatus(data.status);
    } catch (error) {
      console.error("Error fetching document status:", error);
    }
  };

  const handleDeleteAction = async (actionId: string) => {
    if (documentStatus !== "draft") {
      setFeedback({
        isOpen: true,
        type: "warning",
        title: "Cannot delete action",
        message:
          "Actions can only be deleted when the document is in Draft status.",
        autoClose: false,
      });
      return;
    }

    if (!user?.id) {
      setFeedback({
        isOpen: true,
        type: "error",
        title: "User not found",
        message:
          "Unable to identify user. Please refresh the page and try again.",
        autoClose: false,
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("actions")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", actionId);

      if (error) throw error;

      bumpActionsVersion();
      setActionToDelete(null);
      fetchActions();

      setFeedback({
        isOpen: true,
        type: "success",
        title: "Action deleted",
        message: "The action has been successfully removed.",
        autoClose: true,
      });
    } catch (error) {
      console.error("Error deleting action:", error);
      setFeedback({
        isOpen: true,
        type: "error",
        title: "Delete failed",
        message: "Unable to delete the action. Please try again.",
        autoClose: false,
      });
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatStatus = (status: string) => {
    return status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const isDeletable = documentStatus === "draft";
  const hasValidIds = isValidUUID(documentId) && isValidUUID(moduleInstanceId);
  const hideModuleActionsUi = Boolean(
    sourceModuleKey === "RISK_ENGINEERING" ||
    (sourceModuleKey?.startsWith("RE_") &&
      !hasReRecommendationWorkflow(sourceModuleKey)),
  );

  if (!hasValidIds) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-6 mt-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-900 mb-1">
              Invalid Module Configuration
            </h3>
            <p className="text-sm text-red-700">
              Cannot load actions: Missing or invalid document ID or module
              instance ID.
            </p>
            {import.meta.env.DEV && (
              <div className="mt-2 text-xs font-mono text-red-600 space-y-1">
                <div>documentId: {documentId || "(missing)"}</div>
                <div>moduleInstanceId: {moduleInstanceId || "(missing)"}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!isModuleTypeLoaded || hideModuleActionsUi) {
    return null;
  }

  // All document types (including RE modules) show actions UI for the active module instance
  return (
    <div
      id={recommendationContext?.returnAnchor}
      className={`bg-white rounded-lg border border-neutral-200 ${compact ? "p-4 mt-4" : "p-6 mt-6"}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-neutral-900">
            {recommendationContext
              ? `Recommendations — ${recommendationContext.displayLabel}`
              : "Recommendations from this Module"}
          </h3>
          <p className="text-sm text-neutral-500">
            {recommendationContext
              ? "Section-owned finding, evidence, priority and due-date workflow."
              : "Unified finding, evidence, priority and due-date workflow for this module."}
          </p>
        </div>
        {documentStatus === "draft" && (
          <div className="flex items-center gap-2">
            <label
              className={`flex items-center gap-2 px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium ${isUploadingEvidence ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
            >
              <Upload className="w-4 h-4" />
              {isUploadingEvidence ? "Uploading..." : "Add evidence"}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                onChange={handleInlineEvidenceUpload}
                disabled={isUploadingEvidence}
                className="hidden"
              />
            </label>
            <button
              onClick={() => {
                if (isReModule) {
                  setShowReRecommendationModal(true);
                  return;
                }

                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white font-medium rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {buttonLabel}
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-neutral-300 border-t-neutral-900"></div>
        </div>
      ) : actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-300 mb-3" />
          <p className="text-neutral-500 text-sm">
            No recommendations added yet
          </p>
          <p className="text-neutral-400 text-xs">
            Click "{buttonLabel}" to create a recommendation for this section
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((action) => (
            <RecommendationCard
              key={action.id}
              item={{
                id: action.id,
                findingSummary:
                  (action.recommendation_detail?.observation as string) ||
                  action.trigger_text ||
                  action.recommended_action,
                recommendationText: action.recommended_action,
                priority: action.priority_band,
                status: formatStatus(action.status),
                dueDate: formatDate(action.target_date),
                evidenceCount: action.attachment_count,
                sourceLabel:
                  recommendationContext?.sourceLabel ||
                  getModuleDisplayLabel(sourceModuleKey || action.module_instance?.module_key) ||
                  "Linked assessment area",
                referenceNumber: action.reference_number,
              }}
              onOpen={() => {
                if (action.source === "re_recommendations") {
                  window.location.hash =
                    recommendationContext?.returnAnchor ||
                    `recommendation-${action.id}`;
                  return;
                }
                setSelectedAction(action);
              }}
              onDelete={
                isDeletable && action.source !== "re_recommendations"
                  ? () => setActionToDelete(action.id)
                  : undefined
              }
              deleteLabel="Delete"
            />
          ))}
        </div>
      )}

      {!isReModule && showAddModal && (
        <AddActionModal
          documentId={documentId}
          moduleInstanceId={moduleInstanceId}
          onClose={() => setShowAddModal(false)}
          onActionCreated={() => {
            setShowAddModal(false);
            fetchActions();
          }}
          sectionKey={recommendationContext?.sectionKey}
          sectionLabel={recommendationContext?.sectionLabel}
          sourceKey={recommendationContext?.sourceKey}
          sourceLabel={recommendationContext?.sourceLabel}
          defaultCategory={recommendationContext?.defaultCategory}
        />
      )}

      {isReModule && showReRecommendationModal && sourceModuleKey && (
        <CanonicalReRecommendationModal
          isOpen={showReRecommendationModal}
          onClose={() => setShowReRecommendationModal(false)}
          onSaved={async () => {
            bumpActionsVersion();
            await fetchActions();
          }}
          documentId={documentId}
          moduleInstanceId={moduleInstanceId}
          sourceModuleKey={sourceModuleKey}
          sectionKey={recommendationContext?.sectionKey}
          sectionLabel={recommendationContext?.sectionLabel}
          sourceKey={recommendationContext?.sourceKey}
          sourceLabel={recommendationContext?.sourceLabel}
          defaultCategory={recommendationContext?.defaultCategory || defaultCategory}
          metadata={recommendationContext?.metadata}
          createdBy={user?.id || null}
        />
      )}

      {selectedAction && selectedAction.source !== "re_recommendations" && (
        <ActionDetailModal
          returnTo={`/documents/${documentId}/workspace?m=${moduleInstanceId}`}
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          onActionUpdated={() => {
            fetchActions();
          }}
        />
      )}

      {!isReModule && actionToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-neutral-900 mb-3">
              Delete Action?
            </h3>
            <p className="text-neutral-700 mb-6">
              This will permanently delete this action and all its attachments.
              This cannot be undone.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setActionToDelete(null)}
                className="px-4 py-2 text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteAction(actionToDelete)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {!isDeletable && actions.length > 0 && (
        <p className="text-xs text-neutral-500 mt-3 italic">
          Document is issued — actions cannot be deleted. You can close them
          instead.
        </p>
      )}

      <FeedbackModal
        isOpen={feedback.isOpen}
        onClose={() => setFeedback({ ...feedback, isOpen: false })}
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        autoClose={feedback.autoClose}
      />
    </div>
  );
}
