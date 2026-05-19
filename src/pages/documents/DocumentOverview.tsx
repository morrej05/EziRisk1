import { useState, useEffect } from "react";
import {
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
  Link,
} from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  ArrowLeft,
  FileText,
  Calendar,
  User,
  CheckCircle,
  AlertCircle,
  Clock,
  FileDown,
  Edit3,
  AlertTriangle,
  Info,
  Image,
  List,
  FileCheck,
  Shield,
  Package,
  Trash2,
  PlayCircle,
  Circle,
  Filter,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { withResolvedSectionAssessment } from "../../utils/moduleAssessment";
import { isModuleCompleteForUi } from "../../utils/moduleCompletion";
import {
  getModuleDisplayLabel,
  getReModulesForDocument,
  getUnifiedOutcomeLabel,
  type ModuleInstanceLike,
} from "../../lib/modules/moduleCatalog";
import {
  buildModuleSections,
  getModuleCode,
  getModuleDisplayName,
  isDerivedModule,
} from "../../lib/modules/moduleDisplay";
import { buildFraPdf } from "../../lib/pdf/buildFraPdf";
import { buildFsdPdf } from "../../lib/pdf/buildFsdPdf";
import { buildDsearPdf } from "../../lib/pdf/buildDsearPdf";
import { buildCombinedPdf } from "../../lib/pdf/buildCombinedPdf";
import { buildFraDsearCombinedPdf } from "../../lib/pdf/buildFraDsearCombinedPdf";
import { saveAs } from "file-saver";
import { withTimeout, isTimeoutError } from "../../utils/withTimeout";
import { migrateLegacyFraActions } from "../../lib/modules/fra/migrateLegacyFraActions";
import type { FraContext } from "../../lib/modules/fra/severityEngine";
import { migrateLegacyDsearActions } from "../../lib/dsear/migrateLegacyDsearActions";
import {
  computeExplosionSummary,
  type ExplosionSummary,
} from "../../lib/dsear/criticalityEngine";
import { getAssessmentShortName } from "../../utils/displayNames";
import VersionStatusBanner from "../../components/documents/VersionStatusBanner";
import IssueDocumentModal from "../../components/documents/IssueDocumentModal";
import CreateNewVersionModal from "../../components/documents/CreateNewVersionModal";
import VersionHistoryModal from "../../components/documents/VersionHistoryModal";
import ApprovalManagementModal from "../../components/documents/ApprovalManagementModal";
import ApprovalStatusBadge from "../../components/documents/ApprovalStatusBadge";
import ClientAccessModal from "../../components/documents/ClientAccessModal";
import EditLockBanner from "../../components/EditLockBanner";
import ChangeSummaryPanel from "../../components/documents/ChangeSummaryPanel";
import type { ApprovalStatus } from "../../utils/approvalWorkflow";
import { getLockedPdfInfo, downloadLockedPdf } from "../../utils/pdfLocking";
import {
  ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES,
  validateDocumentForIssue,
  type DocumentIssueStatus,
} from "../../utils/documentVersioning";
import {
  canShareWithClients,
  canUseApprovalWorkflow,
} from "../../utils/entitlements";
import {
  getDefencePack,
  downloadDefencePack,
  formatFileSize,
  type DefencePack,
} from "../../utils/defencePack";
import {
  Button,
  Badge,
  Card,
  Callout,
} from "../../components/ui/DesignSystem";
import {
  getActionRegisterSiteLevel,
  formatActionSourceContext,
  type ActionRegisterEntry,
} from "../../utils/actionRegister";
import ActionDetailModal from "../../components/actions/ActionDetailModal";
import { buildPdfIdentityOptions } from "../../utils/pdfIdentity";
import {
  getValidatorBlockerItems,
  getValidatorReviewItems,
  type IssueReadinessItem,
  type IssueValidatorResult,
  type ReadinessState,
} from "../../utils/issueReadiness";

interface DocumentMeta {
  report_previewed_at?: string | null;
  site?: {
    address?: {
      line1?: string | null;
      postcode?: string | null;
    };
  };
  [key: string]: unknown;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface Document {
  id: string;
  document_type: string;
  enabled_modules?: string[];
  title: string;
  status: string;
  version: number;
  assessment_date: string;
  review_date: string | null;
  assessor_name: string | null;
  assessor_role: string | null;
  responsible_person: string | null;
  scope_description: string | null;
  limitations_assumptions: string | null;
  standards_selected: string[];
  created_at: string;
  updated_at: string;
  base_document_id: string;
  version_number: number;
  issue_status: DocumentIssueStatus;
  issue_date: string | null;
  issued_by: string | null;
  superseded_by_document_id: string | null;
  superseded_date: string | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approval_date: string | null;
  approval_notes: string | null;
  locked_pdf_path: string | null;
  locked_pdf_generated_at: string | null;
  locked_pdf_size_bytes: number | null;
  locked_pdf_sha256: string | null;
  executive_summary_ai?: string | null;
  executive_summary_author?: string | null;
  executive_summary_mode?: "ai" | "author" | "both" | "none" | null;
  jurisdiction: string;
  meta?: DocumentMeta;
}

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  completed_at: string | null;
  updated_at: string;
  assessor_notes?: string | null;
  data?: Record<string, unknown>;
}

interface ReRecommendationEntry {
  id: string;
  rec_number: string | null;
  title: string | null;
  status: string;
  priority: string;
  target_date: string | null;
  source_module_key: string | null;
  created_at: string;
  updated_at: string;
}

const ACTIVE_DRAFT_LIFECYCLE_STATUS_OR_FILTER =
  "status.is.null,status.not.in.(archived,deleted)";

const isRecommendationActiveStatus = (
  status: string | null | undefined,
): boolean => {
  const normalized = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  return normalized === "open" || normalized === "in_progress";
};

const recommendationPriorityToBand = (priority: string | null | undefined): string => {
  const normalized = (priority || "").trim().toLowerCase();
  if (normalized === "high" || normalized === "p1") return "P1";
  if (normalized === "medium" || normalized === "p2") return "P2";
  if (normalized === "low" || normalized === "p3") return "P3";
  if (normalized === "p4") return "P4";
  return "P4";
};

const recommendationPriorityLabel = (priority: string | null | undefined): string => {
  const normalized = (priority || "").trim();
  if (normalized === "High") return "P1 / High";
  if (normalized === "Medium") return "P2 / Medium";
  if (normalized === "Low") return "P3 / Low";
  return recommendationPriorityToBand(priority);
};

export default function DocumentOverview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { organisation, user } = useAuth();
  const [document, setDocument] = useState<Document | null>(null);
  const SHOW_CHANGE_SUMMARY = true;
  const [modules, setModules] = useState<ModuleInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [documentNotFound, setDocumentNotFound] = useState(false);
  const [actionCounts, setActionCounts] = useState({
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  });
  const [totalActions, setTotalActions] = useState(0);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [unlinkedEvidenceCount, setUnlinkedEvidenceCount] = useState(0);
  const [p1P2ActionsWithoutEvidence, setP1P2ActionsWithoutEvidence] =
    useState(0);
  const [issueValidation, setIssueValidation] =
    useState<IssueValidatorResult | null>(null);
  const [isCheckingIssueReadiness, setIsCheckingIssueReadiness] =
    useState(false);
  const [explosionSummary, setExplosionSummary] =
    useState<ExplosionSummary | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showNewVersionModal, setShowNewVersionModal] = useState(false);
  const [showVersionHistoryModal, setShowVersionHistoryModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showClientAccessModal, setShowClientAccessModal] = useState(false);
  const [defencePack, setDefencePack] = useState<DefencePack | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actions, setActions] = useState<ActionRegisterEntry[]>([]);
  const [recommendations, setRecommendations] = useState<
    ReRecommendationEntry[]
  >([]);
  const [filteredActions, setFilteredActions] = useState<ActionRegisterEntry[]>(
    [],
  );
  const [filteredRecommendations, setFilteredRecommendations] = useState<
    ReRecommendationEntry[]
  >([]);
  const [actionStatusFilter, setActionStatusFilter] = useState<"open" | "all">(
    "open",
  );
  const [actionPriorityFilter, setActionPriorityFilter] = useState<string[]>(
    [],
  );
  const [selectedAction, setSelectedAction] =
    useState<ActionRegisterEntry | null>(null);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [activeDraftVersion, setActiveDraftVersion] = useState<{
    id: string;
    version_number: number;
    issue_status?: string;
    status?: string | null;
  } | null>(null);
  const [isCheckingDraftVersion, setIsCheckingDraftVersion] = useState(false);

  const returnToPath = (location.state as { returnTo?: string } | null)?.returnTo || null;

  const getDashboardRoute = () => {
    if (returnToPath === "/dashboard/actions") {
      return "/dashboard/actions";
    }

    const fromParam = searchParams.get("from");
    const pathToCheck = returnToPath || fromParam;

    const legacyPaths = [
      "/common-dashboard",
      "/dashboard/fire",
      "/dashboard/explosion",
      "/legacy-dashboard",
    ];
    if (pathToCheck && legacyPaths.includes(pathToCheck)) {
      return "/dashboard";
    }

    if (returnToPath) {
      return returnToPath;
    }

    if (fromParam) {
      return fromParam;
    }

    return "/dashboard";
  };

  const isReDocument = document?.document_type === "RE";
  const recommendationsRegisterPath = (() => {
    const params = new URLSearchParams({ status: "Active" });
    if (document?.title) {
      params.set("document", document.title);
    }
    return `/remediation/recommendations?${params.toString()}`;
  })();

  useEffect(() => {
    if (id && organisation?.id) {
      fetchDocument();
      fetchModules();
      fetchEvidenceCount();
      fetchEvidenceQuality();
      fetchDefencePack();
    }
  }, [id, organisation?.id]);


  useEffect(() => {
    if (!id || !organisation?.id || !document?.id) {
      setIssueValidation(null);
      setIsCheckingIssueReadiness(false);
      return;
    }

    let cancelled = false;

    const validateReadiness = async () => {
      setIsCheckingIssueReadiness(true);
      try {
        const result = await validateDocumentForIssue(id, organisation.id);
        if (!cancelled) {
          setIssueValidation(result);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Error validating issue readiness:", error);
        }
        if (!cancelled) {
          setIssueValidation({
            valid: false,
            errors: ["Unable to validate issue readiness"],
          });
        }
      } finally {
        if (!cancelled) {
          setIsCheckingIssueReadiness(false);
        }
      }
    };

    validateReadiness();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    organisation?.id,
    document?.id,
    document?.updated_at,
    document?.issue_status,
    document?.approval_status,
  ]);

  useEffect(() => {
    if (!document?.base_document_id || !organisation?.id) {
      setActiveDraftVersion(null);
      setIsCheckingDraftVersion(false);
      return;
    }

    fetchActiveDraftVersion(document.base_document_id, document.id);
  }, [document?.base_document_id, document?.id, organisation?.id]);

  useEffect(() => {
    if (!id || !organisation?.id || !document) return;

    if (document.document_type === "RE") {
      fetchRecommendationCounts();
      fetchRecommendations();
      return;
    }

    fetchActionCounts();
    fetchActions();
    fetchEvidenceQuality();
  }, [id, organisation?.id, document]);

  useEffect(() => {
    if (isReDocument) {
      applyRecommendationFilters();
      return;
    }
    applyActionFilters();
  }, [
    actions,
    recommendations,
    actionStatusFilter,
    actionPriorityFilter,
    isReDocument,
  ]);

  useEffect(() => {
    if (!document || modules.length === 0) return;

    const isDsearDocument =
      document.document_type === "DSEAR" ||
      (document.enabled_modules &&
        document.enabled_modules.some((m) => m.startsWith("DSEAR")));

    if (isDsearDocument) {
      try {
        const modulesForEngine = modules.map((m) => ({
          module_key: m.module_key,
          outcome: m.outcome,
          assessor_notes: m.assessor_notes || "",
          data: m.data || {},
        }));

        const summary = computeExplosionSummary({ modules: modulesForEngine });
        setExplosionSummary(summary);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Error computing explosion summary:", error);
        }
      }
    }
  }, [document, modules]);

  const fetchDocument = async () => {
    if (!id || !organisation?.id) return;

    try {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("id", id)
        .eq("organisation_id", organisation.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setDocument(null);
        setDocumentNotFound(true);
        setIsLoading(false);
        return;
      }

      setDocument(data);
      setDocumentNotFound(false);
      setIsLoading(false);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching document:", error);
      }
      setDocument(null);
      setDocumentNotFound(true);
      setIsLoading(false);
    }
  };

  const fetchActiveDraftVersion = async (
    baseDocumentId: string,
    currentDocumentId: string,
  ) => {
    if (!organisation?.id) return;

    try {
      setIsCheckingDraftVersion(true);

      const { data, error } = await supabase
        .from("documents")
        .select("id, version_number, issue_status, status, deleted_at")
        .eq("base_document_id", baseDocumentId)
        .eq("organisation_id", organisation.id)
        .in("issue_status", [...ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES])
        .is("deleted_at", null)
        .or(ACTIVE_DRAFT_LIFECYCLE_STATUS_OR_FILTER)
        .neq("id", currentDocumentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setActiveDraftVersion(data ?? null);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error checking active draft version:", error);
      }
      setActiveDraftVersion(null);
    } finally {
      setIsCheckingDraftVersion(false);
    }
  };

  const fetchModules = async () => {
    if (!id || !organisation?.id) return;

    setIsLoading(true);
    try {
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .select("document_type")
        .eq("id", id)
        .eq("organisation_id", organisation.id)
        .maybeSingle();

      if (docErr) throw docErr;

      const { data, error } = await supabase
        .from("module_instances")
        .select("*")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id);

      if (error) throw error;

      const moduleInstancesSafe = Array.isArray(data) ? data : [];
      const modulesForUi =
        doc?.document_type === "RE"
          ? getReModulesForDocument(moduleInstancesSafe as ModuleInstanceLike[], {
              documentId: id,
            })
          : moduleInstancesSafe;

      setModules(modulesForUi.map(withResolvedSectionAssessment));
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching modules:", error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchActionCounts = async () => {
    if (!id || !organisation?.id) return;

    try {
      const { data, error } = await supabase
        .from("actions")
        .select("priority_band, status")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id)
        .eq("status", "open")
        .is("deleted_at", null);

      if (error) throw error;

      const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
      (data || []).forEach((action) => {
        if (action.priority_band && action.priority_band in counts) {
          counts[action.priority_band as keyof typeof counts]++;
        }
      });

      setActionCounts(counts);
      setTotalActions((data || []).length);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching action counts:", error);
      }
    }
  };

  const fetchRecommendationCounts = async () => {
    if (!id || !organisation?.id) return;

    try {
      const { data, error } = await supabase
        .from("re_recommendations")
        .select(
          `
          priority,
          status,
          documents!inner(
            organisation_id
          )
        `,
        )
        .eq("document_id", id)
        .eq("documents.organisation_id", organisation.id)
        .or("is_suppressed.is.false,is_suppressed.is.null");

      if (error) throw error;

      const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
      (data || []).forEach((recommendation) => {
        if (!isRecommendationActiveStatus(recommendation.status)) return;
        const band = recommendationPriorityToBand(recommendation.priority);
        if (band in counts) counts[band as keyof typeof counts]++;
      });

      setActionCounts(counts);
      setTotalActions(
        (data || []).filter((recommendation) =>
          isRecommendationActiveStatus(recommendation.status),
        ).length,
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching recommendation counts:", error);
      }
    }
  };

  const fetchEvidenceCount = async () => {
    if (!id || !organisation) return;

    try {
      const { count, error } = await supabase
        .from("attachments")
        .select("*", { count: "exact", head: true })
        .eq("document_id", id)
        .eq("organisation_id", organisation.id)
        .is("deleted_at", null);

      if (error) throw error;
      setEvidenceCount(count || 0);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching evidence count:", error);
      }
    }
  };

  const fetchEvidenceQuality = async () => {
    if (!id || !organisation?.id) return;

    try {
      const { data: attachments, error: attachmentError } = await supabase
        .from("attachments")
        .select("id, module_instance_id, action_id")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id)
        .is("deleted_at", null);

      if (attachmentError) throw attachmentError;

      setUnlinkedEvidenceCount(
        (attachments || []).filter(
          (item) => !item.module_instance_id && !item.action_id,
        ).length,
      );

      if (document?.document_type === "RE") {
        setP1P2ActionsWithoutEvidence(0);
        return;
      }

      const { data: highPriorityActions, error: actionsError } = await supabase
        .from("actions")
        .select("id, priority_band, status")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id)
        .in("priority_band", ["P1", "P2"])
        .in("status", ["open", "in_progress"])
        .is("deleted_at", null);

      if (actionsError) throw actionsError;

      const linkedActionIds = new Set(
        (attachments || []).map((item) => item.action_id).filter(Boolean),
      );
      setP1P2ActionsWithoutEvidence(
        (highPriorityActions || []).filter(
          (action) => !linkedActionIds.has(action.id),
        ).length,
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching evidence quality:", error);
      }
    }
  };

  const fetchDefencePack = async () => {
    if (!id) return;

    try {
      const pack = await getDefencePack(id);
      setDefencePack(pack);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching defence pack:", error);
      }
    }
  };

  const fetchActions = async () => {
    if (!id) return;

    setIsLoadingActions(true);
    try {
      const actionEntries = await getActionRegisterSiteLevel(id);
      setActions(actionEntries);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching actions:", error);
      }
    } finally {
      setIsLoadingActions(false);
    }
  };

  const fetchRecommendations = async () => {
    if (!id || !organisation?.id) return;

    setIsLoadingActions(true);
    try {
      const { data, error } = await supabase
        .from("re_recommendations")
        .select(
          `
          id,
          rec_number,
          title,
          status,
          priority,
          target_date,
          source_module_key,
          created_at,
          updated_at,
          documents!inner(
            organisation_id
          )
        `,
        )
        .eq("document_id", id)
        .eq("documents.organisation_id", organisation.id)
        .or("is_suppressed.is.false,is_suppressed.is.null")
        .order("rec_number", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false });

      if (error) throw error;
      const normalizedRows = ((data || []) as ReRecommendationEntry[]).map(
        (row) => ({
          ...row,
          status: row.status?.trim() || row.status,
        }),
      );
      setRecommendations(normalizedRows);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Error fetching recommendations:", error);
      }
      setRecommendations([]);
    } finally {
      setIsLoadingActions(false);
    }
  };

  const applyActionFilters = () => {
    let filtered = [...actions];

    // Status filter
    if (actionStatusFilter === "open") {
      filtered = filtered.filter(
        (a) => a.status === "open" || a.status === "in_progress",
      );
    }

    // Priority filter
    if (actionPriorityFilter.length > 0) {
      filtered = filtered.filter((a) =>
        actionPriorityFilter.includes(a.priority_band),
      );
    }

    setFilteredActions(filtered);
  };

  const applyRecommendationFilters = () => {
    let filtered = [...recommendations];

    if (actionStatusFilter === "open") {
      filtered = filtered.filter((r) => isRecommendationActiveStatus(r.status));
    }

    if (actionPriorityFilter.length > 0) {
      filtered = filtered.filter((r) =>
        actionPriorityFilter.includes(recommendationPriorityToBand(r.priority)),
      );
    }

    setFilteredRecommendations(filtered);
  };

  const togglePriorityFilter = (priority: string) => {
    setActionPriorityFilter((prev) =>
      prev.includes(priority)
        ? prev.filter((p) => p !== priority)
        : [...prev, priority],
    );
  };

  const getRecommendationPriorityBadgeClass = (priority: string) => {
    return getPriorityColor(recommendationPriorityToBand(priority));
  };

  const handleDownloadDefencePack = async () => {
    if (!defencePack) return;

    try {
      if (!document?.id) return;

      const filename = `defence_pack_${(document.title || "").replace(/[^a-z0-9]/gi, "_")}_v${document.version_number}.zip`;
      const result = await downloadDefencePack(document.id, filename);

      if (!result.success) {
        alert(result.error || "Failed to download defence pack");
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Error downloading defence pack:", error);
      }
      alert(getErrorMessage(error, "Failed to download defence pack"));
    }
  };

  const getOutcomeBadgeVariant = (
    outcome: string | null,
  ): "neutral" | "risk-low" | "risk-medium" | "risk-high" | "info" => {
    switch (outcome) {
      case "compliant":
      case "satisfactory":
        return "risk-low";
      case "minor_def":
        return "risk-medium";
      case "material_def":
        return "risk-high";
      case "info_gap":
        return "info";
      default:
        return "neutral";
    }
  };

  const getOutcomeLabel = (outcome: string | null) => getUnifiedOutcomeLabel(outcome) || 'Pending';

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "No date recorded yet";
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusBadgeVariant = (
    status: string,
  ): "neutral" | "success" | "warning" => {
    switch (status) {
      case "issued":
        return "success";
      case "superseded":
        return "warning";
      default:
        return "neutral";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "P1":
        return "bg-red-100 text-red-800 border-red-300";
      case "P2":
        return "bg-orange-100 text-orange-800 border-orange-300";
      case "P3":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "P4":
        return "bg-neutral-100 text-neutral-700 border-neutral-300";
      default:
        return "bg-neutral-100 text-neutral-600 border-neutral-200";
    }
  };

  const getActionStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="warning">Open</Badge>;
      case "in_progress":
        return <Badge variant="info">In Progress</Badge>;
      case "closed":
        return <Badge variant="success">Closed</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const handleIssueSuccess = () => {
    fetchDocument();
  };

  const handleNewVersionSuccess = async (
    newDocumentId: string,
    newVersionNumber: number,
  ) => {
    setShowNewVersionModal(false);
    await fetchDocument();
    setActiveDraftVersion({
      id: newDocumentId,
      version_number: newVersionNumber,
    });
    navigate(`/documents/${newDocumentId}`);
  };

  const handleNavigateToVersion = (documentId: string) => {
    navigate(`/documents/${documentId}`);
  };

  // Get last visited module from localStorage
  const getLastVisitedModule = (): string | null => {
    if (id) {
      return localStorage.getItem(`ezirisk:lastModule:${id}`);
    }
    return null;
  };

  const handleContinueAssessment = () => {
    if (!id) return;

    // Find first incomplete REQUIRED module
    const firstIncomplete = modules.find((m) => !isModuleCompleteForUi(m));

    if (firstIncomplete) {
      // Don't save to localStorage - let workspace save it when loaded
      // This keeps Continue and Open Workspace destinations separate
      navigate(`/documents/${id}/workspace?m=${firstIncomplete.id}`, {
        state: { returnTo: `/documents/${id}` },
      });
    } else {
      // All modules complete, go to last visited or first module
      const lastVisited = getLastVisitedModule();
      const targetModule =
        lastVisited && modules.find((m) => m.id === lastVisited)
          ? lastVisited
          : modules[0]?.id;

      if (targetModule) {
        navigate(`/documents/${id}/workspace?m=${targetModule}`, {
          state: { returnTo: `/documents/${id}` },
        });
      }
    }
  };

  const handleOpenWorkspace = () => {
    if (!id) return;

    // Check last visited module first, or fall back to first module
    const lastVisited = getLastVisitedModule();
    const targetModule =
      lastVisited && modules.find((m) => m.id === lastVisited)
        ? lastVisited
        : modules[0]?.id;

    if (targetModule) {
      // Don't save to localStorage - let workspace save it when loaded
      navigate(`/documents/${id}/workspace?m=${targetModule}`, {
        state: { returnTo: `/documents/${id}` },
      });
    } else {
      navigate(`/documents/${id}/workspace`, {
        state: { returnTo: `/documents/${id}` },
      });
    }
  };

  const handleDeleteDocument = async () => {
    if (!id || !user?.id || !organisation?.id) return;

    setIsDeleting(true);
    try {
      // Only allow deleting draft documents. This is a soft delete: set status, deleted_at, and deleted_by.
      if (document?.issue_status !== "draft") {
        alert("Only draft documents can be deleted");
        return;
      }

      // Soft delete and move the lifecycle status out of draft so deleted drafts do not block new versions.
      const archivedAt = new Date().toISOString();
      const { error } = await supabase
        .from("documents")
        .update({
          deleted_at: archivedAt,
          deleted_by: user.id,
          status: "deleted",
        })
        .eq("id", id)
        .eq("organisation_id", organisation.id)
        .eq("issue_status", "draft")
        .is("deleted_at", null);

      if (error) {
        if (import.meta.env.DEV) {
          console.error("Error archiving document:", error);
        }
        throw new Error(error.message || "Failed to archive document");
      }

      // Navigate back to dashboard
      navigate(getDashboardRoute(), { replace: true });
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Error archiving document:", error);
      }
      alert(getErrorMessage(error, "Failed to archive document"));
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleGeneratePdf = async () => {
    if (!id || !document || !organisation) return;

    setIsGeneratingPdf(true);
    try {
      const pdfInfo = await getLockedPdfInfo(id);

      // If document has a pre-generated locked PDF, open it via signed URL
      if (document.issue_status !== "draft" && pdfInfo?.locked_pdf_path) {
        const downloadResult = await downloadLockedPdf(id);

        if (downloadResult.success && downloadResult.signedUrl) {
          window.open(
            downloadResult.signedUrl,
            "_blank",
            "noopener,noreferrer",
          );
          setIsGeneratingPdf(false);
          return;
        }

        alert(
          downloadResult.error ||
            "Locked PDF is unavailable. Please contact support.",
        );
        setIsGeneratingPdf(false);
        return;
      } else if (document.issue_status !== "draft") {
        alert(
          "Locked PDF is unavailable for this issued document. Please contact support.",
        );
        setIsGeneratingPdf(false);
        return;
      }

      const { data: moduleInstances, error: moduleError } = await supabase
        .from("module_instances")
        .select("*")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id);

      if (moduleError) throw moduleError;

      const { data: actions, error: actionsError } = await supabase
        .from("actions")
        .select("*")
        .eq("document_id", id)
        .eq("organisation_id", organisation.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (actionsError) throw actionsError;

      // Apply legacy action migration if needed
      let migratedActions = actions || [];
      if (document.document_type === "DSEAR") {
        migratedActions = migrateLegacyDsearActions(migratedActions);
      } else if (
        document.document_type === "FRA" ||
        document.document_type === "FSD"
      ) {
        const buildingProfile = (moduleInstances || []).find(
          (m: ModuleInstance) => m.module_key === "A2_BUILDING_PROFILE",
        );
        const buildingProfileData = buildingProfile?.data || {};
        const occupancyRisk =
          typeof buildingProfileData.occupancy_risk === "string"
            ? buildingProfileData.occupancy_risk
            : "NonSleeping";
        const fraContext: FraContext = {
          occupancyRisk: occupancyRisk as "NonSleeping" | "Sleeping" | "Vulnerable",
          storeys: buildingProfileData.number_of_storeys || null,
        };
        migratedActions = migrateLegacyFraActions(migratedActions, fraContext);
      }

      const actionIds = migratedActions.map((a) => a.id);
      let actionRatings = [];
      if (actionIds.length > 0) {
        const { data: ratings } = await supabase
          .from("action_ratings")
          .select("action_id, likelihood, impact, score, rated_at")
          .in("action_id", actionIds)
          .order("rated_at", { ascending: false });

        actionRatings = ratings || [];
      }

      console.info(
        "[PDF Preview/Download] Executive summary before PDF generation:",
        {
          documentId: document.id,
          mode: document.executive_summary_mode,
          aiLength: String(document.executive_summary_ai || "").trim().length,
          authorLength: String(document.executive_summary_author || "").trim()
            .length,
          keys: Object.keys(document).filter((key) =>
            key.startsWith("executive_summary"),
          ),
        },
      );

      const pdfOptions = {
        document,
        moduleInstances: moduleInstances || [],
        actions: migratedActions,
        actionRatings,
        organisation: {
          id: organisation.id,
          name: organisation.name,
          branding_logo_path: organisation.branding_logo_path,
        },
        renderMode:
          document.issue_status === "issued" ||
          document.issue_status === "superseded"
            ? ("issued" as const)
            : ("preview" as const),
        ...buildPdfIdentityOptions(organisation, user),
      };

      let pdfBytes;
      const enabledModules = document.enabled_modules || [
        document.document_type,
      ];
      const isCombinedFraFsd =
        enabledModules.length > 1 &&
        enabledModules.includes("FRA") &&
        enabledModules.includes("FSD");
      const isCombinedFraDsear =
        enabledModules.length > 1 &&
        enabledModules.includes("FRA") &&
        enabledModules.includes("DSEAR");

      const PDF_GENERATION_TIMEOUT = 30000;

      try {
        if (isCombinedFraDsear) {
          pdfBytes = await withTimeout(
            buildFraDsearCombinedPdf(pdfOptions),
            PDF_GENERATION_TIMEOUT,
            "FRA+DSEAR PDF generation timed out after 30 seconds",
          );
        } else if (isCombinedFraFsd) {
          pdfBytes = await withTimeout(
            buildCombinedPdf(pdfOptions),
            PDF_GENERATION_TIMEOUT,
            "Combined PDF generation timed out after 30 seconds",
          );
        } else if (document.document_type === "FSD") {
          pdfBytes = await withTimeout(
            buildFsdPdf(pdfOptions),
            PDF_GENERATION_TIMEOUT,
            "FSD PDF generation timed out after 30 seconds",
          );
        } else if (document.document_type === "DSEAR") {
          pdfBytes = await withTimeout(
            buildDsearPdf(pdfOptions),
            PDF_GENERATION_TIMEOUT,
            "DSEAR PDF generation timed out after 30 seconds",
          );
        } else {
          pdfBytes = await withTimeout(
            buildFraPdf(pdfOptions),
            PDF_GENERATION_TIMEOUT,
            "FRA PDF generation timed out after 30 seconds",
          );
        }

        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const siteName = document.title
          .replace(/[^a-z0-9]/gi, "_")
          .replace(/_+/g, "_")
          .toLowerCase();
        const dateStr = new Date(document.assessment_date)
          .toISOString()
          .split("T")[0];
        const docType = document.document_type || "FRA";
        const filename = `${docType}_${siteName}_${dateStr}_v${document.version_number}.pdf`;

        saveAs(blob, filename);
      } catch (pdfError) {
        if (isTimeoutError(pdfError)) {
          if (import.meta.env.DEV) {
            console.error("[PDF Download] PDF generation timed out");
          }
          throw new Error(
            "PDF generation timed out. Please try again or contact support if this persists.",
          );
        }
        throw pdfError;
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[PDF Download] Error generating PDF:", error);
      }
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      alert(`Failed to generate PDF: ${errorMessage}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const completedModules = modules.filter((m) =>
    isModuleCompleteForUi(m),
  ).length;
  const totalModules = modules.length;
  const completionPercentage =
    totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
  const firstIncomplete = modules.find((m) => !isModuleCompleteForUi(m));

  if (documentNotFound) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Card className="max-w-md mx-auto text-center">
          <div className="mb-4">
            <AlertCircle className="w-12 h-12 text-amber-600 mx-auto" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900 mb-2">
            Document Not Found
          </h2>
          <p className="text-neutral-600 mb-6">
            This document doesn't exist or you don't have permission to access
            it.
          </p>
          <Button onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  if (isLoading || !document) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-neutral-200 border-t-red-600"></div>
      </div>
    );
  }

  const hasValidatorModuleBlockers = Boolean(
    issueValidation?.errors.some((error) =>
      error.toLowerCase().includes("module"),
    ),
  );
  const hasValidatorApprovalBlockers = Boolean(
    issueValidation?.errors.some((error) =>
      error.toLowerCase().includes("approval"),
    ),
  );
  const highPriorityOpenCount = actionCounts.P1 + actionCounts.P2;
  const reviewAssuranceComplete = modules.some(
    (m) => m.module_key === "A7_REVIEW_ASSURANCE" && isModuleCompleteForUi(m),
  );
  const executiveSummaryPresent = Boolean(
    document.executive_summary_ai || document.executive_summary_author,
  );
  const reportPreviewed = Boolean(
    document.meta?.report_previewed_at || document.locked_pdf_generated_at,
  );

  const approvalReadinessDetail = (() => {
    if (hasValidatorApprovalBlockers) return "Required before issue";
    if (document.approval_status === "approved") return "Ready to issue";
    if (document.approval_status === "not_required") {
      return "Not required for this workflow";
    }
    if (document.approval_status === "pending") {
      return "Awaiting approval. You can still issue if permitted by this workflow.";
    }
    return "Approval not yet recorded. You can still issue if permitted by this workflow.";
  })();

  const reviewGateItems: IssueReadinessItem[] = [
    {
      key: "mandatory-modules",
      label: "Mandatory modules",
      detail:
        completedModules === totalModules
          ? `${completedModules}/${totalModules} complete`
          : hasValidatorModuleBlockers
            ? "See issue validator blocker above"
            : `${completedModules}/${totalModules} complete. Complete remaining enabled modules where professionally required.`,
      state:
        completedModules === totalModules || hasValidatorModuleBlockers
          ? "ready"
          : "needs_review",
    },
    {
      key: "high-priority-actions",
      label: isReDocument
        ? "Open High/Medium recommendations"
        : "Open P1/P2 actions",
      detail:
        highPriorityOpenCount > 0
          ? `${highPriorityOpenCount} open. High-priority recommendations present. Review and confirm before issuing.`
          : "No open high-priority recommendations",
      state: highPriorityOpenCount > 0 ? "needs_review" : "ready",
    },
    {
      key: "high-priority-evidence",
      label: "P1/P2 findings or actions without evidence",
      detail:
        p1P2ActionsWithoutEvidence > 0
          ? `${p1P2ActionsWithoutEvidence} missing evidence. Confirm before issue.`
          : "Evidence attached where recorded",
      state: p1P2ActionsWithoutEvidence > 0 ? "needs_review" : "ready",
    },
    {
      key: "unlinked-evidence",
      label: "Unlinked evidence",
      detail:
        unlinkedEvidenceCount > 0
          ? `${unlinkedEvidenceCount} unlinked. Review whether it belongs to a module or recommendation.`
          : "No unlinked evidence",
      state: unlinkedEvidenceCount > 0 ? "needs_review" : "ready",
    },
    {
      key: "executive-summary",
      label: "Executive summary",
      detail: executiveSummaryPresent
        ? "Present"
        : "Executive summary not yet completed. Recommended before issue.",
      state: executiveSummaryPresent ? "ready" : "needs_review",
    },
    {
      key: "review-assurance",
      label: "Review & Assurance",
      detail: reviewAssuranceComplete
        ? "Complete"
        : "No review recorded yet. Recommended before issue unless this workflow does not require it.",
      state: reviewAssuranceComplete ? "ready" : "needs_review",
    },
    {
      key: "report-preview",
      label: "Report preview",
      detail: reportPreviewed
        ? "Previewed"
        : "Not previewed. Confirm generated output before issuing.",
      state: reportPreviewed ? "ready" : "needs_review",
    },
    {
      key: "approval-sign-off",
      label: "Approval / sign-off",
      detail: approvalReadinessDetail,
      state:
        hasValidatorApprovalBlockers ||
        document.approval_status === "approved" ||
        document.approval_status === "not_required"
          ? "ready"
          : "needs_review",
    },
  ];

  const qualityGateItems = [
    ...getValidatorBlockerItems(issueValidation),
    ...getValidatorReviewItems(issueValidation),
    ...reviewGateItems.filter((item) => item.state === "needs_review"),
    ...reviewGateItems.filter((item) => item.state === "ready"),
  ];
  const blockingIssueItems = qualityGateItems.filter(
    (item) => item.state === "blocked",
  );
  const recommendedIssueItems = qualityGateItems.filter(
    (item) => item.state === "needs_review",
  );
  const readyQualityGateItems = qualityGateItems.filter(
    (item) => item.state === "ready",
  );

  const getReadinessRowClass = (state: ReadinessState) => {
    if (state === "blocked") return "border-red-100 bg-red-50/60";
    if (state === "needs_review") return "border-amber-100 bg-amber-50/50";
    return "border-emerald-100 bg-emerald-50/40";
  };

  const getReadinessIcon = (state: ReadinessState) => {
    if (state === "blocked") {
      return <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />;
    }
    if (state === "needs_review") {
      return <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />;
    }
    return <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />;
  };

  const renderReadinessItem = (item: IssueReadinessItem) => (
    <div
      key={item.key}
      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${getReadinessRowClass(item.state)}`}
    >
      {getReadinessIcon(item.state)}
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900">{item.label}</p>
        <p className="text-xs text-neutral-600">{item.detail}</p>
      </div>
    </div>
  );

  const workflowStages = [
    "Overview",
    "Site setup",
    "Site walk & hazards",
    "Technical assessment",
    "Findings & actions",
    "Evidence library",
    "Report preview",
    "Review & issue",
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Navigation */}
        <div className="mb-6">
          <button
            onClick={() => navigate(getDashboardRoute())}
            className={`flex items-center gap-2 font-medium transition-colors ${
              returnToPath === "/dashboard/actions"
                ? "text-blue-600 hover:text-blue-700"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {returnToPath === "/dashboard/actions" ? (
              <>
                <List className="w-4 h-4" />
                Actions Register
              </>
            ) : (
              <>
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </>
            )}
          </button>
        </div>

        {/* Status Banners */}
        <VersionStatusBanner
          versionNumber={document.version_number}
          issueStatus={document.issue_status}
          issueDate={document.issue_date}
          supersededByDocumentId={document.superseded_by_document_id}
        />

        {document.issue_status !== "draft" && (
          <EditLockBanner
            issueStatus={document.issue_status}
            supersededByDocumentId={document.superseded_by_document_id}
            onNavigateToSuccessor={() => {
              if (document.superseded_by_document_id) {
                navigate(`/documents/${document.superseded_by_document_id}`);
              }
            }}
            className="mb-6"
          />
        )}

        {SHOW_CHANGE_SUMMARY && document.issue_status === "issued" && (
          <ChangeSummaryPanel
            documentId={id!}
            versionNumber={document.version_number}
            className="mb-6"
          />
        )}

        {/* Header Card */}
        <Card className="mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <FileText className="w-8 h-8 text-neutral-700" />
                <div>
                  <h1 className="text-2xl font-bold text-neutral-900">
                    {document.title}
                  </h1>
                  <div className="flex items-center gap-3 mt-1">
                    <Badge variant="info">
                      {getAssessmentShortName(
                        document.document_type,
                        document.jurisdiction,
                      )}
                    </Badge>
                    <Badge
                      variant={getStatusBadgeVariant(document.issue_status)}
                    >
                      {document.issue_status}
                    </Badge>
                    <span className="text-sm text-neutral-500">
                      v{document.version_number}
                    </span>
                    <ApprovalStatusBadge
                      status={document.approval_status}
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              {/* Key Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-neutral-200">
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-neutral-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-neutral-500">
                      Assessment Date
                    </p>
                    <p className="text-sm text-neutral-900">
                      {formatDate(document.assessment_date)}
                    </p>
                  </div>
                </div>

                {document.assessor_name && (
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-neutral-400 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-neutral-500">
                        Assessor
                      </p>
                      <p className="text-sm text-neutral-900">
                        {document.assessor_name}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 text-neutral-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-neutral-500">
                      Last Updated
                    </p>
                    <p className="text-sm text-neutral-900">
                      {formatDate(document.updated_at)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Defence Pack Notice */}
          {defencePack && (
            <Callout variant="info" className="mt-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-blue-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Defence Pack Available</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    Created {formatDate(defencePack.created_at)}
                    {defencePack.size_bytes &&
                      ` • ${formatFileSize(defencePack.size_bytes)}`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleDownloadDefencePack}
                  className="text-sm"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </Callout>
          )}

          {document.issue_status !== "draft" && !document.locked_pdf_path && (
            <Callout variant="danger" className="mt-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="text-sm font-medium">Locked PDF unavailable</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    This issued document does not have a stored locked PDF.
                    Download is disabled until support regenerates the locked
                    artefact.
                  </p>
                </div>
              </div>
            </Callout>
          )}
          {document.locked_pdf_path && document.issue_status !== "draft" && (
            <Callout variant="success" className="mt-4">
              <div className="flex items-center gap-3">
                <FileCheck className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium">PDF Locked</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    Issued {formatDate(document.locked_pdf_generated_at)}
                    {document.locked_pdf_size_bytes &&
                      ` • ${(document.locked_pdf_size_bytes / 1024).toFixed(0)} KB`}
                  </p>
                </div>
              </div>
            </Callout>
          )}
        </Card>

        {/* Next Steps Section - Only for Draft */}
        {document.issue_status === "draft" && (
          <Card className="mb-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">
              Next Steps
            </h2>

            {firstIncomplete ? (
              <Callout variant="info" className="mb-4">
                <div className="flex items-center gap-3">
                  <PlayCircle className="w-5 h-5 text-blue-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Resume Assessment</p>
                    <p className="text-xs text-neutral-600 mt-1">
                      Next incomplete module:{" "}
                      {getModuleDisplayLabel(firstIncomplete.module_key)}
                    </p>
                  </div>
                  <Button onClick={handleContinueAssessment}>
                    <Edit3 className="w-4 h-4 mr-2" />
                    Continue Assessment
                  </Button>
                </div>
              </Callout>
            ) : (
              <Callout variant="success" className="mb-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">All Modules Complete</p>
                    <p className="text-xs text-neutral-600 mt-1">
                      Ready for review and issue
                    </p>
                  </div>
                </div>
              </Callout>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" onClick={handleOpenWorkspace}>
                <Edit3 className="w-4 h-4 mr-2" />
                Open Workspace
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(`/documents/${id}/preview`)}
              >
                <FileText className="w-4 h-4 mr-2" />
                Preview Report
              </Button>
              {organisation && canUseApprovalWorkflow(organisation) && (
                <Button
                  variant="secondary"
                  onClick={() => setShowApprovalModal(true)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Manage Approval
                </Button>
              )}
              <Button onClick={() => setShowIssueModal(true)}>
                <FileCheck className="w-4 h-4 mr-2" />
                Issue Document
              </Button>
            </div>
          </Card>
        )}

        {/* Quick Actions Section - For Issued */}
        {document.issue_status === "issued" && (
          <Card className="mb-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">
              Actions
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={handleGeneratePdf}
                disabled={isGeneratingPdf || !document.locked_pdf_path}
                title={
                  !document.locked_pdf_path
                    ? "Locked PDF is unavailable for this issued document"
                    : undefined
                }
              >
                {isGeneratingPdf ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-neutral-400 border-t-transparent mr-2"></div>
                    Downloading...
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4 mr-2" />
                    Download PDF
                  </>
                )}
              </Button>
              {organisation && canShareWithClients(organisation) && (
                <Button
                  variant="secondary"
                  onClick={() => setShowClientAccessModal(true)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Share with Clients
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={true}
                title="Defence Pack export will be available post-launch"
              >
                <Shield className="w-4 h-4 mr-2" />
                Generate Defence Pack
                <Badge className="ml-2 text-xs bg-neutral-200 text-neutral-600">
                  Coming Soon
                </Badge>
              </Button>
              {!activeDraftVersion && (
                <Button
                  onClick={() => setShowNewVersionModal(true)}
                  disabled={isCheckingDraftVersion}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {isCheckingDraftVersion
                    ? "Checking Versions..."
                    : "Create New Version"}
                </Button>
              )}
            </div>
            {activeDraftVersion && (
              <Callout variant="warning" className="mt-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900">
                      A draft version already exists and must be issued or
                      deleted before creating another version.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/documents/${activeDraftVersion.id}`)
                      }
                      className="mt-2 text-sm font-medium text-amber-900 underline hover:text-amber-700"
                    >
                      Open draft v{activeDraftVersion.version_number}
                    </button>
                  </div>
                </div>
              </Callout>
            )}
          </Card>
        )}

        {/* Workflow order */}
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-3">
            Assessment workflow
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            {workflowStages.map((stage, index) => (
              <div
                key={stage}
                className={`rounded-lg border px-3 py-2 ${index === 0 ? "bg-blue-50 border-blue-200 text-blue-900" : index === workflowStages.length - 1 ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-white border-neutral-200 text-neutral-800"}`}
              >
                <span className="text-xs font-semibold text-neutral-500">
                  {index + 1}
                </span>
                <p className="text-sm font-medium">{stage}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Consolidated issue readiness */}
        <Card className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                Issue readiness
              </h2>
              <p className="text-sm text-neutral-600 mt-1">
                Uses the same issue validator as the issue flow. Blocking issues prevent issue; recommendations are advisory.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/documents/${id}/preview`)}
            >
              <FileText className="w-4 h-4 mr-2" />
              Preview report
            </Button>
          </div>
          {isCheckingIssueReadiness && (
            <p className="mb-3 text-sm text-neutral-500">
              Checking issue validator…
            </p>
          )}

          <div className="space-y-4">
            {blockingIssueItems.length > 0 && (
              <section className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-red-950">
                      Blocking issues
                    </h3>
                    <p className="text-xs text-red-800">
                      These validator items must be resolved before issue.
                    </p>
                  </div>
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                    {blockingIssueItems.length} to resolve
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {blockingIssueItems.map(renderReadinessItem)}
                </div>
              </section>
            )}

            {recommendedIssueItems.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/30 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-950">
                      Recommended before issue
                    </h3>
                    <p className="text-xs text-amber-800">
                      These items do not technically block issue, but should be reviewed by the assessor.
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {recommendedIssueItems.length} to review
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {recommendedIssueItems.map(renderReadinessItem)}
                </div>
              </section>
            )}

            {blockingIssueItems.length === 0 && recommendedIssueItems.length === 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-950">
                      Ready to issue
                    </h3>
                    <p className="text-sm text-emerald-800">
                      No blocking or advisory readiness items are currently outstanding.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {readyQualityGateItems.length > 0 && (
              <details className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-emerald-950 marker:hidden">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <span className="font-semibold">{readyQualityGateItems.length} readiness checks passed</span>
                    <span className="text-xs font-normal text-emerald-700">View completed checks</span>
                  </span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {readyQualityGateItems.map(renderReadinessItem)}
                </div>
              </details>
            )}
          </div>
        </Card>

        {/* Identity Completeness Nudge */}
        {document &&
          !document.meta?.site?.address?.line1 &&
          !document.meta?.site?.address?.postcode && (
            <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-neutral-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                    Assessment guidance
                  </p>
                  <p className="text-sm font-medium text-neutral-900 mb-1">
                    Add site address
                  </p>
                  <p className="text-sm text-neutral-600">
                    Add the site address in module A1 to support mapping and
                    keep the report identity consistent across all outputs.
                  </p>
                </div>
              </div>
            </section>
          )}

        {/* Available Outputs */}
        {document &&
          document.enabled_modules &&
          document.enabled_modules.length > 0 && (
            <Card className="mb-6">
              <details>
                <summary className="cursor-pointer text-lg font-semibold text-neutral-900">
                  Available outputs
                </summary>
                <div className="mt-4 space-y-3">
                {document.enabled_modules.includes("FRA") && (
                  <div className="flex items-start gap-3 px-3 py-2 bg-neutral-50 rounded-lg">
                    <FileText className="w-5 h-5 text-neutral-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        Fire Risk Assessment (FRA)
                      </p>
                      <p className="text-xs text-neutral-600">
                        Regulatory compliance report under RRO
                      </p>
                    </div>
                  </div>
                )}
                {document.enabled_modules.includes("FSD") && (
                  <div className="flex items-start gap-3 px-3 py-2 bg-neutral-50 rounded-lg">
                    <FileText className="w-5 h-5 text-neutral-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        Fire Strategy Document (FSD)
                      </p>
                      <p className="text-xs text-neutral-600">
                        Design-stage fire engineering documentation
                      </p>
                    </div>
                  </div>
                )}
                {document.enabled_modules.includes("DSEAR") && (
                  <div className="flex items-start gap-3 px-3 py-2 bg-neutral-50 rounded-lg">
                    <FileText className="w-5 h-5 text-neutral-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        Explosive Atmospheres (DSEAR)
                      </p>
                      <p className="text-xs text-neutral-600">
                        Dangerous substances and explosive atmospheres
                        assessment
                      </p>
                    </div>
                  </div>
                )}
                {document.enabled_modules.includes("FRA") &&
                  document.enabled_modules.includes("FSD") && (
                    <div className="flex items-start gap-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
                      <Package className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-900">
                          Combined FRA + FSD Report
                        </p>
                        <p className="text-xs text-blue-700">
                          Single report with both fire risk and strategy
                          sections
                        </p>
                      </div>
                    </div>
                  )}
                {document.enabled_modules.includes("FRA") &&
                  document.enabled_modules.includes("DSEAR") && (
                    <div className="flex items-start gap-3 px-3 py-2 bg-orange-50 rounded-lg border border-orange-200">
                      <Package className="w-5 h-5 text-orange-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-orange-900">
                          Combined Fire + Explosion Report
                        </p>
                        <p className="text-xs text-orange-700">
                          Single report with both fire risk and explosion risk
                          sections
                        </p>
                      </div>
                    </div>
                  )}
              </div>
                <div className="mt-4 pt-4 border-t border-neutral-200">
                  <p className="text-xs text-neutral-600 mb-2">
                    Click <strong>Preview Report</strong> to view and download any
                    of these outputs.
                  </p>
                </div>
              </details>
            </Card>
          )}

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card>
            <h3 className="text-sm font-medium text-neutral-500 uppercase mb-4">
              Module Progress
            </h3>
            <div className="mb-3">
              <div className="flex items-end justify-between mb-1">
                <span className="text-3xl font-semibold text-neutral-900">
                  {completionPercentage}%
                </span>
                <span className="text-sm text-neutral-600">
                  {completedModules}/{totalModules}
                </span>
              </div>
              <div className="w-full bg-neutral-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-neutral-500 uppercase">
                {isReDocument ? "Active Recommendations" : "Open Actions"}
              </h3>
              <button
                onClick={() =>
                  navigate(
                    isReDocument
                      ? recommendationsRegisterPath
                      : `/dashboard/actions?document=${id}`,
                  )
                }
                className="text-xs text-neutral-600 hover:text-neutral-900 font-medium flex items-center gap-1"
              >
                <List className="w-3 h-3" />
                View Register
              </button>
            </div>
            <div className="mb-3">
              <div className="text-3xl font-semibold text-neutral-900 mb-1">
                {totalActions}
              </div>
              <div className="text-sm text-neutral-600">
                {isReDocument
                  ? "Total active recommendations"
                  : "Total open actions"}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center">
                <div className="text-lg font-semibold text-red-700">
                  {actionCounts.P1}
                </div>
                <div className="text-xs text-neutral-500">
                  P1
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-orange-700">
                  {actionCounts.P2}
                </div>
                <div className="text-xs text-neutral-500">
                  P2
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-amber-700">
                  {actionCounts.P3}
                </div>
                <div className="text-xs text-neutral-500">
                  P3
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-neutral-700">
                  {actionCounts.P4}
                </div>
                <div className="text-xs text-neutral-500">
                  P4
                </div>
              </div>
            </div>
          </Card>

          {explosionSummary && (
            <Card>
              <h3 className="text-sm font-medium text-neutral-500 uppercase mb-4">
                Explosion Criticality
              </h3>
              <div className="mb-3">
                <div
                  className="text-2xl font-semibold mb-1"
                  style={{
                    color:
                      explosionSummary.overall === "Critical"
                        ? "#b91c1c"
                        : explosionSummary.overall === "High"
                          ? "#c2410c"
                          : explosionSummary.overall === "Moderate"
                            ? "#d97706"
                            : "#737373",
                  }}
                >
                  {explosionSummary.overall}
                </div>
                <div className="text-sm text-neutral-600">Overall status</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">
                    Critical findings
                  </span>
                  <span className="text-sm font-semibold text-red-700">
                    {explosionSummary.criticalCount}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">
                    High findings
                  </span>
                  <span className="text-sm font-semibold text-orange-700">
                    {explosionSummary.highCount}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">
                    Information gaps
                  </span>
                  <span className="text-sm font-semibold text-amber-700">
                    {modules.filter((m) => m.outcome === "info_gap").length}
                  </span>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <h3 className="text-sm font-medium text-neutral-500 uppercase mb-4">
              Quick Links
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => navigate(`/documents/${id}/workspace`)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 transition-colors flex items-center gap-2 text-sm"
              >
                <Edit3 className="w-4 h-4 text-neutral-600" />
                <span className="text-neutral-900">Workspace</span>
              </button>
              <button
                onClick={() => navigate(`/documents/${id}/evidence`)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 transition-colors flex items-center gap-2 text-sm"
              >
                <Image className="w-4 h-4 text-neutral-600" />
                <span className="text-neutral-900">
                  Evidence ({evidenceCount})
                </span>
              </button>
              <button
                onClick={() => navigate(`/documents/${id}/preview`)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 transition-colors flex items-center gap-2 text-sm"
              >
                <FileText className="w-4 h-4 text-neutral-600" />
                <span className="text-neutral-900">Preview Report</span>
              </button>
              <button
                onClick={() => setShowVersionHistoryModal(true)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 transition-colors flex items-center gap-2 text-sm"
              >
                <Clock className="w-4 h-4 text-neutral-600" />
                <span className="text-neutral-900">Version History</span>
              </button>
            </div>
          </Card>
        </div>

        {/* Actions/Recommendations Panel */}
        <Card className="mb-6">
          <div className="px-6 py-4 border-b border-neutral-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">
                  {isReDocument ? "Recommendations quick preview" : "Actions quick preview"}
                </h2>
                <p className="text-sm text-neutral-600 mt-1">
                  {isReDocument
                    ? "A short preview only — use the register for detailed recommendation management"
                    : "A short preview only — use the register for detailed action management"}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate(
                    isReDocument
                      ? recommendationsRegisterPath
                      : `/dashboard/actions?document=${id}`,
                  )
                }
              >
                <List className="w-4 h-4 mr-2" />
                Open register
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-3 border-b border-neutral-200 bg-neutral-50">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-neutral-500" />
                <span className="text-sm font-medium text-neutral-700">
                  Status:
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActionStatusFilter("open")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      actionStatusFilter === "open"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-300"
                    }`}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setActionStatusFilter("all")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      actionStatusFilter === "all"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-300"
                    }`}
                  >
                    All
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-700">
                  Priority:
                </span>
                <div className="flex gap-2">
                  {["P1", "P2", "P3", "P4"].map((priority) => (
                    <button
                      key={priority}
                      onClick={() => togglePriorityFilter(priority)}
                      className={`px-2 py-1 text-xs font-semibold rounded border transition-colors ${
                        actionPriorityFilter.includes(priority)
                          ? getPriorityColor(priority)
                          : "bg-white text-neutral-500 hover:bg-neutral-100 border-neutral-300"
                      }`}
                    >
                      {priority}
                    </button>
                  ))}
                </div>
              </div>

              {actionPriorityFilter.length > 0 && (
                <button
                  onClick={() => setActionPriorityFilter([])}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Actions/Recommendations Table */}
          <div className="overflow-x-auto">
            {isLoadingActions ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-neutral-200 border-t-blue-600"></div>
              </div>
            ) : (
                isReDocument
                  ? filteredRecommendations.length === 0
                  : filteredActions.length === 0
              ) ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <CheckCircle className="w-12 h-12 text-neutral-300 mb-3" />
                <p className="text-neutral-600 font-medium">
                  {isReDocument
                    ? "No recommendations found"
                    : "No actions found"}
                </p>
                <p className="text-sm text-neutral-500 mt-1">
                  {isReDocument
                    ? actionStatusFilter === "open"
                      ? "No active recommendations for this document"
                      : "No recommendations have been created yet"
                    : actionStatusFilter === "open"
                      ? "All actions are complete"
                      : "No actions have been created yet"}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      Ref
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      Section
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      {isReDocument ? "Recommendation" : "Action"}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                      Target Date
                    </th>
                    {!isReDocument && (
                      <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                        Owner
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {(isReDocument ? filteredRecommendations : filteredActions)
                    .slice(0, 5)
                    .map((action, index) => {
                      // Use canonical reference_number if assigned, otherwise show pending indicator
                      const refNumber = isReDocument
                        ? ((action as ReRecommendationEntry).rec_number ?? "Not assigned")
                        : ((action as ActionRegisterEntry).reference_number ??
                          "Not assigned");

                      return (
                        <tr
                          key={action.id || index}
                          className="hover:bg-neutral-50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-mono text-neutral-900">
                            {isReDocument ? (
                              refNumber
                            ) : (
                              <Link
                                to={`/documents/${(action as ActionRegisterEntry).document_id}/workspace?openAction=${action.id}`}
                                className="hover:underline"
                              >
                                {refNumber}
                              </Link>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border ${
                                isReDocument
                                  ? getRecommendationPriorityBadgeClass(
                                      (action as ReRecommendationEntry)
                                        .priority,
                                    )
                                  : getPriorityColor(
                                      (action as ActionRegisterEntry)
                                        .priority_band,
                                    )
                              }`}
                            >
                              {isReDocument
                                ? recommendationPriorityLabel((action as ReRecommendationEntry).priority)
                                : (action as ActionRegisterEntry).priority_band}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {isReDocument
                              ? (action as ReRecommendationEntry).status
                              : getActionStatusBadge(
                                  (action as ActionRegisterEntry).status,
                                )}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-600">
                            {isReDocument ? (
                              (action as ReRecommendationEntry)
                                .source_module_key ? (
                                getModuleDisplayLabel(
                                  (action as ReRecommendationEntry)
                                    .source_module_key as string,
                                )
                              ) : (
                                "Assessment section"
                              )
                            ) : (
                              <span>
                                {(action as ActionRegisterEntry).module_key
                                  ? getModuleDisplayLabel(
                                      (action as ActionRegisterEntry)
                                        .module_key as string,
                                    )
                                  : "Assessment section"}
                                {((action as ActionRegisterEntry).source_links
                                  ?.length ||
                                  (action as ActionRegisterEntry)
                                    .source_context) && (
                                  <span className="block text-xs text-neutral-500">
                                    Source:{" "}
                                    {formatActionSourceContext(action as ActionRegisterEntry)}
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-900 max-w-md">
                            {isReDocument ? (
                              <span className="block truncate">
                                {(action as ReRecommendationEntry).title || "No recommendation recorded"}
                              </span>
                            ) : (
                              <Link
                                to={`/documents/${(action as ActionRegisterEntry).document_id}/workspace?openAction=${action.id}`}
                                className="block truncate hover:underline"
                              >
                                {(action as ActionRegisterEntry)
                                  .recommended_action || "No recommendation recorded"}
                              </Link>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-600">
                            {action.target_date
                              ? formatDate(action.target_date)
                              : "No target completion date set"}
                          </td>
                          {!isReDocument && (
                            <td className="px-4 py-3 text-sm text-neutral-600">
                              {(action as ActionRegisterEntry).owner_name ||
                                "Not assigned"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>

          {/* Show more indicator */}
          {(isReDocument
            ? filteredRecommendations.length > 5
            : filteredActions.length > 5) && (
            <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50 text-center">
              <p className="text-sm text-neutral-600">
                Showing 5 of{" "}
                {isReDocument
                  ? filteredRecommendations.length
                  : filteredActions.length}{" "}
                {isReDocument ? "recommendations" : "actions"}.{" "}
                <button
                  onClick={() =>
                    navigate(
                      isReDocument
                        ? recommendationsRegisterPath
                        : `/dashboard/actions?document=${id}`,
                    )
                  }
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  View all in register
                </button>
              </p>
            </div>
          )}
        </Card>

        {/* Modules List */}
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-900">Modules</h2>
            <p className="text-sm text-neutral-600 mt-1">
              Click on a module to open its workspace
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-neutral-200 border-t-red-600"></div>
            </div>
          ) : modules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <AlertCircle className="w-12 h-12 text-neutral-400 mb-3" />
              <p className="text-neutral-600">
                No modules found for this document
              </p>
            </div>
          ) : (
            <div>
              {buildModuleSections(modules).map((section) => (
                <div key={section.key}>
                  {/* Section Header */}
                  <div className="px-6 py-3 bg-neutral-50 border-b border-neutral-200">
                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                      {section.label}
                    </h3>
                  </div>

                  {/* Section Modules */}
                  <div className="divide-y divide-neutral-200">
                    {section.modules.map((module) => {
                      const isDerived = isDerivedModule(module.module_key);

                      return (
                        <div
                          key={module.id}
                          className="px-6 py-3.5 hover:bg-neutral-50 transition-colors cursor-pointer"
                          onClick={() => {
                            navigate(
                              `/documents/${id}/workspace?m=${module.id}`,
                            );
                          }}
                        >
                          <div className="flex items-center justify-between gap-4">
                            {/* Left: Icon + Name */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="flex-shrink-0">
                                {!isDerived &&
                                isModuleCompleteForUi(module) &&
                                module.outcome !== "info_gap" ? (
                                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                                ) : !isDerived &&
                                  isModuleCompleteForUi(module) &&
                                  module.outcome === "info_gap" ? (
                                  <AlertCircle className="w-5 h-5 text-blue-600" />
                                ) : !isDerived ? (
                                  <Circle className="w-5 h-5 text-neutral-300" />
                                ) : (
                                  <div className="w-5 h-5" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-neutral-900">
                                  {getModuleDisplayName(module.module_key)}
                                </p>
                              </div>
                            </div>

                            {/* Right: Badges */}
                            <div className="flex items-center gap-2 shrink-0">
                              {isDerived && (
                                <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium tracking-wide rounded-md bg-neutral-50 text-neutral-500 border border-neutral-200">
                                  Auto
                                </span>
                              )}
                              {!isDerived && module.outcome && (
                                <Badge
                                  variant={getOutcomeBadgeVariant(
                                    module.outcome,
                                  )}
                                  className="text-xs"
                                >
                                  {getOutcomeLabel(module.outcome)}
                                </Badge>
                              )}
                              <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-md bg-neutral-100 text-neutral-600 border border-neutral-200">
                                {getModuleCode(module.module_key)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Archive Draft Button */}
        {document.issue_status === "draft" && (
          <div className="mt-6 flex justify-end">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              className="!bg-risk-high-fg !text-white hover:!bg-risk-high-fg/90"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Archive Draft
            </Button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showIssueModal && user?.id && organisation?.id && (
        <IssueDocumentModal
          documentId={id!}
          documentTitle={document.title}
          userId={user.id}
          organisationId={organisation.id}
          onClose={() => setShowIssueModal(false)}
          onSuccess={handleIssueSuccess}
        />
      )}

      {showApprovalModal && user?.id && organisation?.id && (
        <ApprovalManagementModal
          documentId={id!}
          documentTitle={document.title}
          currentApprovalStatus={document.approval_status}
          approvalNotes={document.approval_notes}
          approvedBy={document.approved_by}
          approvalDate={document.approval_date}
          userId={user.id}
          organisationId={organisation.id}
          userRole={user.role || "viewer"}
          onClose={() => setShowApprovalModal(false)}
          onSuccess={handleIssueSuccess}
        />
      )}

      {showClientAccessModal && user?.id && (
        <ClientAccessModal
          baseDocumentId={document.base_document_id}
          documentTitle={document.title}
          userId={user.id}
          issueStatus={document.issue_status}
          onClose={() => setShowClientAccessModal(false)}
        />
      )}

      {showNewVersionModal &&
        !activeDraftVersion &&
        user?.id &&
        organisation?.id && (
          <CreateNewVersionModal
            baseDocumentId={document.base_document_id}
            currentVersion={document.version_number}
            documentTitle={document.title}
            userId={user.id}
            organisationId={organisation.id}
            onClose={() => setShowNewVersionModal(false)}
            onSuccess={handleNewVersionSuccess}
          />
        )}

      {showVersionHistoryModal && (
        <VersionHistoryModal
          baseDocumentId={document.base_document_id}
          currentDocumentId={id!}
          onClose={() => setShowVersionHistoryModal(false)}
          onNavigateToVersion={handleNavigateToVersion}
        />
      )}

      {selectedAction && user?.id && organisation?.id && (
        <ActionDetailModal
          actionId={selectedAction.id}
          userId={user.id}
          organisationId={organisation.id}
          onClose={() => {
            setSelectedAction(null);
            fetchActions();
            fetchActionCounts();
          }}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-neutral-900">
                Archive Draft
              </h2>
            </div>
            <p className="text-neutral-700 mb-6">
              This will archive this draft assessment. It will no longer appear
              in active assessments.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900 transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <Button
                variant="destructive"
                onClick={handleDeleteDocument}
                disabled={isDeleting}
                className="flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Archiving...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Archive Draft
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
