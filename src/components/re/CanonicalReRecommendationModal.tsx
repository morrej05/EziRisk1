import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Image as ImageIcon, Upload, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  RecommendationWorkflowShell,
  formatSuggestedCompletion,
} from "../recommendations/RecommendationWorkflow";
import { buildRecommendationContext } from "../../lib/re/recommendations/sectionRecommendationContext";
import {
  uploadAttachment,
  deleteAttachment,
  updateAttachmentCaption,
  batchGetSignedUrls,
} from "../../utils/evidenceManagement";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Photo {
  attachmentId: string;
  path: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  uploaded_at: string;
  caption: string;
  signedUrl: string | null;
}

interface DocContext {
  organisationId: string;
  baseDocumentId: string;
  isLocked: boolean;
}

interface CanonicalReRecommendationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  documentId: string;
  moduleInstanceId: string;
  sourceModuleKey: string;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  defaultCategory?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  /** When provided the modal opens in edit mode and loads the existing rec. */
  recId?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_SECTIONS = [
  { key: "RE_01_DOC_CONTROL", label: "RE-01 – Document Control" },
  { key: "RE_02_CONSTRUCTION", label: "RE-02 – Construction" },
  { key: "RE_03_OCCUPANCY", label: "RE-03 – Occupancy" },
  { key: "RE_07_NATURAL_HAZARDS", label: "RE-04 – Exposures" },
  { key: "RE_06_FIRE_PROTECTION", label: "RE-05 – Fire Protection" },
  { key: "RE_08_UTILITIES", label: "RE-06 – Utilities & Critical Services" },
  { key: "RE_09_MANAGEMENT", label: "RE-07 – Management Systems" },
  { key: "RE_12_LOSS_VALUES", label: "RE-08 – Loss & Values" },
  { key: "OTHER", label: "Other" },
];

const MAX_PHOTOS_PER_RECOMMENDATION = 3;
const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timescaleForPriority(
  priority: "High" | "Medium" | "Low",
): "7d" | "30d" | "90d" {
  if (priority === "High") return "7d";
  if (priority === "Medium") return "30d";
  return "90d";
}

function targetDateFromTimescale(timescale: string): string {
  const dueDate = new Date();
  dueDate.setHours(0, 0, 0, 0);
  if (timescale === "7d") dueDate.setDate(dueDate.getDate() + 7);
  if (timescale === "30d") dueDate.setDate(dueDate.getDate() + 30);
  if (timescale === "90d") dueDate.setDate(dueDate.getDate() + 90);
  return toLocalIsoDate(dueDate);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CanonicalReRecommendationModal({
  isOpen,
  onClose,
  onSaved,
  documentId,
  moduleInstanceId,
  sourceModuleKey,
  sectionKey,
  sectionLabel,
  sourceKey,
  sourceLabel,
  defaultCategory,
  metadata,
  createdBy,
  recId,
}: CanonicalReRecommendationModalProps) {
  const [title, setTitle] = useState("");
  const [observation, setObservation] = useState("");
  const [actionRequired, setActionRequired] = useState("");
  const [hazardDescription, setHazardDescription] = useState("");
  const [comments, setComments] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [status, setStatus] = useState<"Open" | "In Progress" | "Completed">(
    "Open",
  );
  const [targetDate, setTargetDate] = useState("");
  const [userEditedTargetDate, setUserEditedTargetDate] = useState(false);
  const [owner, setOwner] = useState("");
  const [relatedModule, setRelatedModule] = useState(
    sourceModuleKey || "OTHER",
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Fetched once per modal open — required for uploadAttachment().
  // Also carries isLocked so the form can guard against mutations.
  const [docContext, setDocContext] = useState<DocContext | null>(null);
  const isLocked = docContext?.isLocked ?? false;

  // Edit mode — populated when recId is provided.
  const isEditMode = Boolean(recId);
  const [recNumber, setRecNumber] = useState<string | null>(null);
  const [isLoadingRec, setIsLoadingRec] = useState(false);

  // Refs for cleanup across all close paths (X, Cancel, Escape, navigation away).
  const cleanupDoneRef = useRef(false);
  const photosRef = useRef<Photo[]>([]);
  const documentIdRef = useRef(documentId);
  const handleCancelRef = useRef<() => void>(() => {});
  // Tracks photos uploaded during the current edit session so cancel only
  // deletes those, leaving pre-existing photos untouched.
  const sessionNewAttachmentIdsRef = useRef<Set<string>>(new Set());

  const defaultModule = useMemo(
    () => sourceModuleKey || "OTHER",
    [sourceModuleKey],
  );

  const recommendationContext = useMemo(
    () =>
      buildRecommendationContext({
        documentId,
        moduleInstanceId,
        moduleKey: sourceModuleKey || defaultModule,
        sectionKey,
        sectionLabel,
        sourceKey,
        sourceLabel,
        defaultCategory,
        warnOnMissingContext: isOpen,
      }),
    [
      documentId,
      moduleInstanceId,
      sourceModuleKey,
      defaultModule,
      sectionKey,
      sectionLabel,
      sourceKey,
      sourceLabel,
      defaultCategory,
      isOpen,
    ],
  );

  const resolvedCategory = recommendationContext.defaultCategory;

  // ─── Effects ────────────────────────────────────────────────────────────────

  // Set related module when modal opens.
  useEffect(() => {
    if (isOpen) {
      setRelatedModule(sourceKey || defaultModule);
    }
  }, [isOpen, defaultModule, sourceKey]);

  // Fetch document context (org, base doc, lock status) when modal opens.
  // Clear on close so stale context doesn't persist if documentId changes.
  useEffect(() => {
    if (!isOpen) {
      setDocContext(null);
      setRecNumber(null);
      setIsLoadingRec(false);
      return;
    }

    cleanupDoneRef.current = false;
    sessionNewAttachmentIdsRef.current = new Set();
    let cancelled = false;
    supabase
      .from("documents")
      .select("organisation_id, base_document_id, issue_status")
      .eq("id", documentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setDocContext({
            organisationId: data.organisation_id,
            baseDocumentId: data.base_document_id ?? "",
            isLocked:
              data.issue_status === "issued" ||
              data.issue_status === "superseded",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, documentId]);

  // Auto-set target date from priority unless user has manually edited it,
  // or we are in edit mode (the stored date is loaded from the DB instead).
  useEffect(() => {
    if (!isOpen || userEditedTargetDate || isEditMode) return;
    setTargetDate(targetDateFromTimescale(timescaleForPriority(priority)));
  }, [isOpen, priority, userEditedTargetDate, isEditMode]);

  // Keep refs in sync so the Escape/unmount closures always have fresh values.
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => { documentIdRef.current = documentId; }, [documentId]);

  // Load existing recommendation data when opening in edit mode.
  useEffect(() => {
    if (!isOpen || !recId) return;
    let cancelled = false;
    setIsLoadingRec(true);

    (async () => {
      try {
        const { data: rec } = await supabase
          .from("re_recommendations")
          .select(
            "rec_number, title, observation_text, action_required_text, hazard_text, comments_text, priority, status, target_date, owner, photos, source_module_key",
          )
          .eq("id", recId)
          .maybeSingle();

        if (cancelled || !rec) return;

        setRecNumber(rec.rec_number ?? null);
        setTitle(rec.title ?? "");
        setObservation(rec.observation_text ?? "");
        setActionRequired(rec.action_required_text ?? "");
        setHazardDescription(rec.hazard_text ?? "");
        setComments(rec.comments_text ?? "");
        setPriority((rec.priority as "High" | "Medium" | "Low") ?? "Medium");
        setStatus(
          (rec.status as "Open" | "In Progress" | "Completed") ?? "Open",
        );
        setTargetDate(rec.target_date ?? "");
        setUserEditedTargetDate(true); // prevent auto-overwrite from priority effect
        setOwner(rec.owner ?? "");
        setRelatedModule(rec.source_module_key ?? defaultModule);

        // Load photos from JSONB mirror, then cross-reference attachments for IDs.
        type RawPhoto = {
          path?: string;
          storage_path?: string;
          file_name?: string;
          size_bytes?: number;
          mime_type?: string;
          uploaded_at?: string;
          caption?: string;
        };
        const rawPhotos: RawPhoto[] = Array.isArray(rec.photos)
          ? (rec.photos as RawPhoto[])
          : [];

        if (rawPhotos.length > 0) {
          const paths = rawPhotos
            .map((p) => p.path ?? p.storage_path ?? "")
            .filter(Boolean);

          const [urlMap, { data: attRows }] = await Promise.all([
            batchGetSignedUrls(paths),
            supabase
              .from("attachments")
              .select("id, file_path, caption")
              .in("file_path", paths)
              .is("deleted_at", null),
          ]);

          if (cancelled) return;

          const attByPath: Record<string, { id: string; caption: string }> = {};
          for (const a of attRows ?? []) {
            attByPath[a.file_path] = { id: a.id, caption: a.caption ?? "" };
          }

          const loadedPhotos: Photo[] = rawPhotos
            .map((p): Photo | null => {
              const path = p.path ?? p.storage_path ?? "";
              if (!path) return null;
              const att = attByPath[path];
              if (!att) return null;
              return {
                attachmentId: att.id,
                path,
                file_name: p.file_name ?? "",
                size_bytes: p.size_bytes ?? 0,
                mime_type: p.mime_type ?? "",
                uploaded_at: p.uploaded_at ?? "",
                caption: att.caption || p.caption || "",
                signedUrl: urlMap[path] ?? null,
              };
            })
            .filter((p): p is Photo => p !== null);

          if (!cancelled) setPhotos(loadedPhotos);
        }
      } finally {
        if (!cancelled) setIsLoadingRec(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, recId, defaultModule]);

  // ─── Form helpers ────────────────────────────────────────────────────────────

  const resetForm = () => {
    setTitle("");
    setObservation("");
    setActionRequired("");
    setHazardDescription("");
    setComments("");
    setPriority("Medium");
    setStatus("Open");
    setTargetDate(targetDateFromTimescale(timescaleForPriority("Medium")));
    setUserEditedTargetDate(false);
    setOwner("");
    setRelatedModule(sourceKey || defaultModule);
    setPhotos([]);
    setRecNumber(null);
  };

  // ─── Photo handlers ──────────────────────────────────────────────────────────

  /**
   * Uploads a photo via uploadAttachment() and adds it to local state.
   * Shows a blob preview immediately; replaces with a signed URL after upload.
   * If upload fails the optimistic entry is removed.
   */
  const handleUploadPhoto = async (file: File) => {
    if (isLocked || !docContext) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_PHOTO_SIZE_BYTES) return;
    if (photos.length >= MAX_PHOTOS_PER_RECOMMENDATION) return;

    setUploadingPhoto(true);
    const blobUrl = URL.createObjectURL(file);

    // Optimistic placeholder — no attachmentId yet.
    const tempId = `temp-${crypto.randomUUID()}`;
    setPhotos((prev) => [
      ...prev,
      {
        attachmentId: tempId,
        path: "",
        file_name: file.name,
        size_bytes: file.size,
        mime_type: file.type,
        uploaded_at: new Date().toISOString(),
        caption: "",
        signedUrl: blobUrl,
      },
    ]);

    try {
      const result = await uploadAttachment(
        docContext.organisationId,
        documentId,
        docContext.baseDocumentId,
        file,
        undefined,        // caption — user sets inline after upload
        moduleInstanceId, // link to the module so getModuleAttachments() finds it
      );

      if (!result.success || !result.attachment) {
        // Remove the optimistic entry on failure.
        setPhotos((prev) => prev.filter((p) => p.attachmentId !== tempId));
        URL.revokeObjectURL(blobUrl);
        console.error("[RE Recommendation] Photo upload failed:", result.error);
        return;
      }

      const att = result.attachment;

      // In edit mode, record IDs so cancel only deletes photos added this session.
      if (isEditMode) sessionNewAttachmentIdsRef.current.add(att.id);

      // Get a signed URL (private bucket — blob URL would expire on navigation).
      const { data: signedData } = await supabase.storage
        .from("evidence")
        .createSignedUrl(att.file_path, 3600);
      const signedUrl = signedData?.signedUrl ?? null;

      // Replace the optimistic entry with the confirmed attachment data.
      URL.revokeObjectURL(blobUrl);
      setPhotos((prev) =>
        prev.map((p) =>
          p.attachmentId === tempId
            ? {
                attachmentId: att.id,
                path: att.file_path,
                file_name: att.file_name,
                size_bytes: att.file_size_bytes ?? file.size,
                mime_type: att.file_type,
                uploaded_at: att.created_at,
                caption: "",
                signedUrl,
              }
            : p,
        ),
      );
    } catch (err) {
      setPhotos((prev) => prev.filter((p) => p.attachmentId !== tempId));
      URL.revokeObjectURL(blobUrl);
      console.error("[RE Recommendation] Unexpected upload error:", err);
    } finally {
      setUploadingPhoto(false);
    }
  };

  /**
   * Soft-deletes the attachment and removes it from local state.
   * Skips delete for optimistic (temp-*) entries that haven't committed yet.
   */
  const removePhoto = (attachmentId: string) => {
    if (!attachmentId.startsWith("temp-")) {
      void deleteAttachment(attachmentId, documentId).catch((err) =>
        console.error("[RE Recommendation] Failed to delete photo:", err),
      );
    }
    setPhotos((prev) => prev.filter((p) => p.attachmentId !== attachmentId));
  };

  /**
   * Updates the caption for a photo in local state only.
   * Captions are persisted to the attachments table in handleSave() so they
   * are written in a single pass together with the JSONB mirror.
   */
  const updatePhotoCaption = (attachmentId: string, caption: string) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.attachmentId === attachmentId ? { ...p, caption } : p,
      ),
    );
  };

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  /**
   * Cancels the modal.
   * Create mode: all uploaded photos are soft-deleted (they were never saved to a rec).
   * Edit mode: only photos added during this session are deleted; pre-existing ones remain.
   */
  const handleCancel = () => {
    cleanupDoneRef.current = true;
    photos.forEach((p) => {
      if (p.attachmentId.startsWith("temp-")) return;
      // In edit mode only clean up photos that were added in this session.
      if (isEditMode && !sessionNewAttachmentIdsRef.current.has(p.attachmentId)) return;
      void deleteAttachment(p.attachmentId, documentId).catch((err) =>
        console.error("[RE Recommendation] Cancel cleanup failed:", err),
      );
    });
    resetForm();
    onClose();
  };

  // Keep handleCancelRef up to date after every render for the Escape handler.
  useEffect(() => { handleCancelRef.current = handleCancel; });

  // Escape key — dismiss and clean up like the X button.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Unmount cleanup — handles navigation away while modal is open.
  // cleanupDoneRef prevents double-deletion when handleCancel already ran.
  // Edit mode: only delete session-new photos; pre-existing photos stay on the rec.
  useEffect(() => {
    return () => {
      if (!cleanupDoneRef.current) {
        photosRef.current
          .filter((p) => {
            if (p.attachmentId.startsWith("temp-")) return false;
            if (isEditMode) return sessionNewAttachmentIdsRef.current.has(p.attachmentId);
            return true;
          })
          .forEach((p) => {
            void deleteAttachment(p.attachmentId, documentIdRef.current).catch(
              (err) =>
                console.error("[RE Recommendation] Unmount cleanup failed:", err),
            );
          });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!title.trim() || isSaving || isLocked) return;

    // Duplicate check — only meaningful for new recommendations, not edits.
    if (!isEditMode) {
      const { data: duplicates } = await supabase
        .from("re_recommendations")
        .select("id")
        .eq("document_id", documentId)
        .eq("module_instance_id", moduleInstanceId)
        .eq("source_factor_key", recommendationContext.sourceKey)
        .eq("title", title.trim())
        .eq("action_required_text", actionRequired.trim())
        .eq("is_suppressed", false)
        .limit(1);

      if (
        duplicates &&
        duplicates.length > 0 &&
        !window.confirm(
          "An exact duplicate recommendation already exists for this section. Save another copy anyway?",
        )
      ) {
        return;
      }
    }

    setIsSaving(true);
    try {
      // Persist any captions the user typed before saving.
      // Only committed attachments (no temp- prefix) need this.
      const captionUpdates = photos
        .filter((p) => !p.attachmentId.startsWith("temp-") && p.caption.trim())
        .map((p) =>
          updateAttachmentCaption(p.attachmentId, documentId, p.caption.trim()),
        );
      await Promise.all(captionUpdates);

      // Build JSONB mirror for PDF builder (re_recommendations.photos).
      const photosJsonb = photos
        .filter((p) => !p.attachmentId.startsWith("temp-"))
        .map((p) => ({
          path: p.path,
          file_name: p.file_name,
          size_bytes: p.size_bytes,
          mime_type: p.mime_type,
          uploaded_at: p.uploaded_at,
          ...(p.caption.trim() ? { caption: p.caption.trim() } : {}),
        }));

      if (isEditMode) {
        // UPDATE path
        const { error } = await supabase
          .from("re_recommendations")
          .update({
            title: title.trim(),
            observation_text: observation.trim(),
            action_required_text: actionRequired.trim(),
            hazard_text: hazardDescription.trim(),
            comments_text: comments.trim() || null,
            status,
            priority,
            target_date: targetDate || null,
            owner: owner.trim() || null,
            photos: photosJsonb,
            updated_at: new Date().toISOString(),
          })
          .eq("id", recId as string);

        if (error) throw error;
      } else {
        // INSERT path
        const { error } = await supabase.from("re_recommendations").insert({
          document_id: documentId,
          module_instance_id: moduleInstanceId,
          source_type: "manual",
          source_module_key: sourceModuleKey || defaultModule,
          source_factor_key: recommendationContext.sourceKey,
          title: title.trim(),
          observation_text: observation.trim(),
          action_required_text: actionRequired.trim(),
          hazard_text: hazardDescription.trim(),
          comments_text: comments.trim() || null,
          category: resolvedCategory,
          metadata: {
            ...(metadata || {}),
            ...recommendationContext.metadata,
          },
          status,
          priority,
          target_date: targetDate || null,
          owner: owner.trim() || null,
          photos: photosJsonb,
          created_by: createdBy || null,
        });

        if (error) throw error;
      }

      cleanupDoneRef.current = true;
      await onSaved();
      resetForm();
      onClose();
    } catch (error) {
      console.error("Error saving recommendation:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-slate-50 p-4 shadow-2xl sm:max-h-[90vh] sm:rounded-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-slate-900">
              {isEditMode ? "Edit Recommendation" : "Add Recommendation"}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {isEditMode
                ? recNumber
                  ? `${recNumber} · Update fields and save.`
                  : "Update fields and save."
                : "Capture the finding, evidence and action in one place."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Close recommendation modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoadingRec ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
          </div>
        ) : (
        <>
        <RecommendationWorkflowShell
          title={isEditMode ? "Edit Recommendation" : "Add Recommendation"}
          context={{
            documentId,
            moduleInstanceId,
            sourceKey: recommendationContext.sourceKey,
            sourceLabel: recommendationContext.sourceLabel,
            defaultCategory: resolvedCategory,
          }}
          priority={priority}
          suggestedTimescale={timescaleForPriority(priority)}
          targetDate={targetDate}
          evidenceCount={photos.length}
        >
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Recommendation / action required *
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Summarise the action required"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Observation / finding
              </label>
              <textarea
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="What was observed during the assessment?"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Recommendation detail
              </label>
              <textarea
                value={actionRequired}
                onChange={(e) => setActionRequired(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Add detail that supports the recommendation wording"
              />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <label className="block text-sm font-medium text-amber-900">
                  Risk implication / consequence
                </label>
              </div>
              <textarea
                value={hazardDescription}
                onChange={(e) => setHazardDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
                placeholder="Describe the hazard or risk associated with this recommendation"
              />
            </div>


            <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "High" | "Medium" | "Low")
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="High">P1 / High</option>
                  <option value="Medium">P2 / Medium</option>
                  <option value="Low">P3 / Low</option>
                </select>
              </div>
              <div className={isEditMode ? "" : "hidden"}>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(
                      e.target.value as "Open" | "In Progress" | "Completed",
                    )
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Target completion date
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => {
                    setUserEditedTargetDate(true);
                    setTargetDate(e.target.value);
                  }}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-blue-700">
                  Suggested completion:{" "}
                  {formatSuggestedCompletion(timescaleForPriority(priority))}. A
                  later date should be supported by assessor rationale.
                </p>
              </div>
              <div className="hidden">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Owner
                </label>
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Assigned to"
                />
              </div>
              <div className="hidden">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Related Module
                </label>
                <select
                  value={relatedModule}
                  onChange={(e) => setRelatedModule(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {MODULE_SECTIONS.map((module) => (
                    <option key={module.key} value={module.key}>
                      {module.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                {showAdvanced ? "Hide advanced fields" : "Show advanced fields"}
              </button>
              {showAdvanced && (
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded border border-slate-200 bg-white p-3 md:col-span-2">
                    <label className="mb-1 block font-medium text-slate-700">
                      Assessor notes
                    </label>
                    <textarea
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Internal notes (not included in report)"
                    />
                  </div>
                  {import.meta.env.DEV && (
                    <>
                      <div className="rounded border border-slate-200 bg-white p-3">
                        <p className="font-medium text-slate-700">Category</p>
                        <p className="mt-1 text-slate-600">{resolvedCategory}</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-3">
                        <p className="font-medium text-slate-700">Assessment section</p>
                        <p className="mt-1 text-slate-600">{recommendationContext.displayLabel}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Evidence section */}
            <div className="border-t border-slate-200 pt-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="block text-sm font-medium text-slate-700">
                  Evidence ({photos.length}/
                  {MAX_PHOTOS_PER_RECOMMENDATION})
                </label>
                {!isLocked && photos.length < MAX_PHOTOS_PER_RECOMMENDATION ? (
                  <label
                    className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-white sm:w-auto sm:py-1.5 ${
                      uploadingPhoto || !docContext
                        ? "cursor-not-allowed bg-blue-300"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {uploadingPhoto ? "Uploading…" : "Add evidence"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleUploadPhoto(file);
                        e.currentTarget.value = "";
                      }}
                      disabled={uploadingPhoto || !docContext}
                    />
                  </label>
                ) : isLocked ? null : (
                  <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-600">
                    Maximum {MAX_PHOTOS_PER_RECOMMENDATION} photos
                  </span>
                )}
              </div>

              {photos.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {photos.map((photo) => (
                    <div
                      key={photo.attachmentId}
                      className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <div className="aspect-video overflow-hidden bg-slate-100">
                        {photo.signedUrl ? (
                          <img
                            src={photo.signedUrl}
                            alt={photo.file_name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-slate-400" />
                          </div>
                        )}
                      </div>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.attachmentId)}
                          className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white hover:bg-red-700"
                          aria-label={`Remove ${photo.file_name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      <div className="p-2 space-y-1">
                        <p
                          className="truncate text-xs text-slate-600"
                          title={photo.file_name}
                        >
                          {photo.file_name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {(photo.size_bytes / 1024 / 1024).toFixed(1)} MB
                        </p>
                        {!isLocked && (
                          <input
                            type="text"
                            value={photo.caption}
                            onChange={(e) =>
                              updatePhotoCaption(
                                photo.attachmentId,
                                e.target.value,
                              )
                            }
                            placeholder="Add caption…"
                            className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                            maxLength={200}
                          />
                        )}
                        {isLocked && photo.caption && (
                          <p className="text-xs italic text-slate-500">
                            {photo.caption}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-6 text-center text-sm text-slate-500">
                  No evidence attached yet (max 15MB per image)
                </div>
              )}

              {uploadingPhoto && (
                <div className="mt-2 text-sm text-blue-600">
                  Uploading evidence…
                </div>
              )}
            </div>
          </div>
        </RecommendationWorkflowShell>

        <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:border-t-0 sm:bg-transparent sm:p-0">
          <button
            type="button"
            onClick={handleCancel}
            className="w-full rounded-lg bg-slate-100 px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200 sm:w-auto sm:py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim() || isSaving || isLocked}
            onClick={handleSave}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
          >
            {isSaving ? "Saving…" : "Save Recommendation"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
