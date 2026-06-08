import { useState, useEffect } from "react";
import { Plus, AlertCircle, Upload, X, CheckCircle, Loader2 } from "lucide-react";
import { useInlineEvidenceUpload } from "../../hooks/useInlineEvidenceUpload";
import ModuleEvidenceList from "../evidence/ModuleEvidenceList";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { isDocumentLocked } from "../../utils/documentLock";
import AddActionModal from "../actions/AddActionModal";
import ActionDetailModal from "../actions/ActionDetailModal";
import FeedbackModal from "../FeedbackModal";
import {
  bumpActionsVersion,
  subscribeActionsVersion,
  getActionsVersion,
} from "../../lib/actions/actionsInvalidation";
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
  module_instance_id?: string | null;
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
  summaryOnly?: boolean;
}



const FRA_1_RECOMMENDATION_SCOPE_KEYS = [
  "FRA_1_HAZARDS",
  "fixed_wiring_eicr",
  "dsear_screening",
  "lightning",
  "cooking",
  "battery_charging_lithium_ion",
  "duct_cleaning",
  "hazardous_substances_dsear",
  "electrical",
  "portable_heaters",
  "smoking",
  "laundry",
  "plant_machinery",
  "lighting_high_temp",
  "arson",
  "high_risk_other",
  "other",
];

type ActionLike = {
  module_instance_id?: string | null;
  module_instance?: { id?: string | null; module_key?: string | null } | null;
  recommendation_detail?: Record<string, unknown> | null;
};

type RecommendationMatchContext = {
  moduleInstanceId: string;
  moduleKey: string;
  sectionKey: string;
  sourceKey: string;
};

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getRecommendationDetailRecords = (action: ActionLike): Record<string, unknown>[] => {
  const detail = getRecord(action.recommendation_detail);
  const metadata = getRecord(detail.metadata);
  const recommendationDetail = getRecord(detail.recommendation_detail);
  const nestedRecommendationDetail = getRecord(metadata.recommendation_detail);
  return [detail, metadata, recommendationDetail, nestedRecommendationDetail];
};

const detailMatchesAny = (
  action: ActionLike,
  keys: string[],
  expectedValues: Array<string | null | undefined>,
): boolean => {
  const expected = new Set(expectedValues.map((value) => stringValue(value)).filter(Boolean));
  if (expected.size === 0) return false;

  return getRecommendationDetailRecords(action).some((record) =>
    keys.some((key) => expected.has(stringValue(record[key]))),
  );
};

const matchesRecommendationModule = (
  action: ActionLike,
  moduleInstanceId: string,
  moduleKey?: string | null,
): boolean => {
  const moduleMatches =
    action.module_instance_id === moduleInstanceId ||
    action.module_instance?.id === moduleInstanceId ||
    action.module_instance?.module_key === moduleKey ||
    detailMatchesAny(action, ["moduleInstanceId", "module_instance_id"], [moduleInstanceId]) ||
    detailMatchesAny(action, ["moduleKey", "sourceModuleKey", "module_key", "source_module_key"], [moduleKey]);

  if (moduleMatches) return true;

  if (moduleKey === "FRA_1_HAZARDS") {
    return detailMatchesAny(
      action,
      ["sectionKey", "sourceKey", "source_factor_key"],
      FRA_1_RECOMMENDATION_SCOPE_KEYS,
    );
  }

  return false;
};

const matchesRecommendationSection = (
  action: ActionLike,
  context: RecommendationMatchContext,
): boolean => {
  if (!matchesRecommendationModule(action, context.moduleInstanceId, context.moduleKey)) {
    return false;
  }
  // Prefer precise sourceKey match. Only fall back to sectionKey when no
  // sourceKey is stored on the record (legacy recs created before sourceKey
  // was introduced). This prevents recs from one category (e.g. hot_work)
  // appearing in sibling categories that share the same sectionKey.
  const records = getRecommendationDetailRecords(action);
  const hasStoredSourceKey = records.some((r) => stringValue(r["sourceKey"]) || stringValue(r["source_factor_key"]));
  if (hasStoredSourceKey) {
    return detailMatchesAny(action, ["sourceKey", "source_factor_key"], [context.sourceKey]);
  }
  return detailMatchesAny(action, ["sectionKey"], [context.sectionKey]);
};

const getActionSourceLabel = (action: ActionLike, fallback?: string | null): string | null => {
  const records = getRecommendationDetailRecords(action);
  for (const key of ["sourceLabel", "sectionLabel"]) {
    for (const record of records) {
      const value = stringValue(record[key]);
      if (value) return value;
    }
  }
  return fallback || null;
};

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
  summaryOnly = false,
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
  const [isLocked, setIsLocked] = useState(false);
  const [actionToDelete, setActionToDelete] = useState<string | null>(null);
  const [actionsVersion, setActionsVersion] = useState(getActionsVersion());
  const [evidenceRefreshKey, setEvidenceRefreshKey] = useState(0);

  const hasSectionRecommendationContext = Boolean(
    sectionKey || sectionLabel || sourceKey || sourceLabel || defaultCategory,
  );

  const recommendationContext = sourceModuleKey && hasSectionRecommendationContext
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

  const isModuleFooterRollup = summaryOnly || !hasSectionRecommendationContext;

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
    if (!isModuleTypeLoaded || isModuleFooterRollup) return;
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
    summaryOnly,
    isModuleFooterRollup,
  ]);

  // fetchActions must be declared before useInlineEvidenceUpload so it is
  // already initialised when passed as the onUploaded callback. Declaring it
  // after that hook call would put it in the temporal dead zone and produce
  // "Cannot access 'fetchActions' before initialization" in production builds.
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
              // sourceKey/source_factor_key match is definitive.
              // sectionKey is a fallback only for legacy recs that have no sourceKey,
              // preventing sibling-category cross-contamination.
              const hasSourceKey = rec.source_factor_key || meta.sourceKey;
              if (hasSourceKey) {
                return (
                  rec.source_factor_key === recommendationContext.sourceKey ||
                  meta.sourceKey === recommendationContext.sourceKey
                );
              }
              return meta.sectionKey === recommendationContext.sectionKey;
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
          module_instance_id,
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
        .eq("document_id", documentId)
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

      const scopedActions = actionsWithAttachments.filter((action) =>
        recommendationContext
          ? matchesRecommendationSection(action, recommendationContext)
          : matchesRecommendationModule(action, moduleInstanceId, sourceModuleKey),
      );

      setActions(scopedActions as unknown as Action[]);
    } catch (error) {
      console.error("Error fetching actions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Inline evidence upload — lock-safe path with optional caption.
  const {
    pendingFiles: evidencePendingFiles,
    caption: evidenceCaption,
    setCaption: setEvidenceCaption,
    isUploading: isUploadingEvidence,
    uploadResult: evidenceUploadResult,
    onFilesSelected: onEvidenceFilesSelected,
    upload: uploadEvidence,
    dismiss: dismissEvidenceUpload,
  } = useInlineEvidenceUpload(documentId, moduleInstanceId, fetchActions);

  // Auto-dismiss success indicator after 3 s so the trigger button reappears.
  useEffect(() => {
    if (!evidenceUploadResult?.success) return;
    const t = setTimeout(() => dismissEvidenceUpload(), 3000);
    return () => clearTimeout(t);
  }, [evidenceUploadResult, dismissEvidenceUpload]);

  // Refresh the evidence list whenever an upload completes successfully.
  useEffect(() => {
    if (evidenceUploadResult?.success) {
      setEvidenceRefreshKey((k) => k + 1);
    }
  }, [evidenceUploadResult]);

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
        .select("status, document_type, issue_status")
        .eq("id", documentId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setDocumentStatus(data.status);
        setIsLocked(isDocumentLocked(data.issue_status));
      }
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
    isModuleFooterRollup ||
    sourceModuleKey === "RISK_ENGINEERING" ||
    (sourceModuleKey?.startsWith("RE_") &&
      !hasReRecommendationWorkflow(sourceModuleKey)),
  );

  if (isModuleFooterRollup) {
    return null;
  }

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

  // Section-owned recommendation cards remain available where a section context is provided
  return (
    <div
      id={recommendationContext?.returnAnchor}
      className={`bg-white rounded-lg border border-neutral-200 ${compact ? "p-4 mt-4" : "p-6 mt-6"}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-neutral-900">
            {`Recommendations — ${recommendationContext?.displayLabel || "Assessment section"}`}
          </h3>
          <p className="text-sm text-neutral-500">
            Section-owned finding, evidence, priority and due-date workflow.
          </p>
        </div>
        {documentStatus === "draft" && !summaryOnly && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Evidence trigger — hidden while files are staged or a result toast is showing */}
            {evidencePendingFiles.length === 0 && !evidenceUploadResult && (
              <label className="flex items-center gap-2 px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium cursor-pointer touch-manipulation select-none">
                <Upload className="w-4 h-4 flex-shrink-0" />
                <span>Add evidence</span>
                <input
                  type="file"
                  multiple
                  capture="environment"
                  accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                  onChange={(e) => {
                    if (e.target.files?.length) onEvidenceFilesSelected(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            )}

            {/* Success toast (auto-dismisses via useEffect) */}
            {evidenceUploadResult?.success && (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>{evidenceUploadResult.message}</span>
              </div>
            )}

            {/* Error toast (persists until dismissed) */}
            {evidenceUploadResult && !evidenceUploadResult.success && (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="min-w-0">{evidenceUploadResult.message}</span>
                <button
                  type="button"
                  onClick={dismissEvidenceUpload}
                  className="flex-shrink-0 ml-1 hover:text-red-900 transition-colors"
                  aria-label="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

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

      {/* ── Caption + upload panel — shown while files are staged ── */}
      {evidencePendingFiles.length > 0 && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-blue-900 truncate min-w-0">
              {evidencePendingFiles.length === 1
                ? evidencePendingFiles[0].name
                : `${evidencePendingFiles.length} files selected`}
            </p>
            <button
              type="button"
              onClick={dismissEvidenceUpload}
              disabled={isUploadingEvidence}
              className="flex-shrink-0 text-blue-400 hover:text-blue-700 transition-colors disabled:opacity-40"
              aria-label="Cancel upload"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            value={evidenceCaption}
            onChange={(e) => setEvidenceCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); uploadEvidence(); }
            }}
            placeholder="Add a caption (optional)"
            disabled={isUploadingEvidence}
            className="w-full px-2.5 py-1.5 text-sm border border-blue-300 rounded-md bg-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={uploadEvidence}
            disabled={isUploadingEvidence}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition-colors touch-manipulation"
          >
            {isUploadingEvidence ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Upload</span>
              </>
            )}
          </button>
        </div>
      )}

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
                  getActionSourceLabel(action, recommendationContext?.sourceLabel) ||
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
                // Editing is blocked for issued/superseded documents
                if (!isLocked) {
                  setSelectedAction(action);
                }
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
          sourceModuleKey={sourceModuleKey || undefined}
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

      {!isLocked && selectedAction && selectedAction.source !== "re_recommendations" && (
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
              Delete recommendation?
            </h3>
            <p className="text-neutral-700 mb-6">
              This will permanently delete this recommendation and all its attachments.
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

      {isLocked && actions.length > 0 && (
        <p className="text-xs text-neutral-500 mt-3 italic">
          Document is issued — actions are read-only and cannot be edited or deleted.
        </p>
      )}

      {isValidUUID(moduleInstanceId) && isValidUUID(documentId) && (
        <ModuleEvidenceList
          moduleInstanceId={moduleInstanceId}
          documentId={documentId}
          isLocked={isLocked}
          refreshKey={evidenceRefreshKey}
          className="mt-4 pt-4 border-t border-neutral-100"
        />
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
