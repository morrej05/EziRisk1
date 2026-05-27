import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { isReDocumentLocked } from '../../../lib/re/documentLock';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { Upload, AlertCircle } from 'lucide-react';
import FloatingSaveBar from './FloatingSaveBar';
import ModuleEvidenceList from '../../evidence/ModuleEvidenceList';
import {
  uploadAttachment,
  getModuleAttachments,
} from '../../../utils/evidenceManagement';

// Upload limits
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_BATCH_FILES = 20;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic'];

// Naming convention that identifies a site plan attachment.
// Applied at upload time and read back at save time when deriving the JSONB mirror.
const SITE_PLAN_PREFIX = 'site_plan_';

interface DocContext {
  organisationId: string;
  baseDocumentId: string;
}

interface Document {
  id: string;
  title: string;
  issue_status?: 'draft' | 'issued' | 'superseded';
}

interface ModuleInstance {
  id: string;
  document_id: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface RE10SitePhotosFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

export default function RE10SitePhotosForm({
  moduleInstance,
  document,
  onSaved,
}: RE10SitePhotosFormProps) {
  const isLocked = isReDocumentLocked(document.issue_status);
  const outcome = moduleInstance.outcome || '';
  const assessorNotes = moduleInstance.assessor_notes || '';

  // Fetched once on mount — required by uploadAttachment(). Follows the same
  // pattern as useInlineEvidenceUpload so uploads don't re-query on every call.
  const [docContext, setDocContext] = useState<DocContext | null>(null);

  // Incrementing this tells ModuleEvidenceList to re-fetch after each upload.
  const [evidenceRefreshKey, setEvidenceRefreshKey] = useState(0);

  const [isSaving, setIsSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingSitePlan, setUploadingSitePlan] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('documents')
      .select('organisation_id, base_document_id')
      .eq('id', moduleInstance.document_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setDocContext({
            organisationId: data.organisation_id,
            baseDocumentId: data.base_document_id ?? '',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [moduleInstance.document_id]);

  // ─── Validation ─────────────────────────────────────────────────────────────

  const validateImageFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${file.name} exceeds ${MAX_FILE_SIZE_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      return `${file.name} is not a supported image format (jpg, png, heic only)`;
    }
    return null;
  };

  // ─── Upload handlers ─────────────────────────────────────────────────────────

  /**
   * Uploads one or more site photos via the lock-safe uploadAttachment() path.
   * After each successful batch the ModuleEvidenceList is refreshed.
   * Captions are set by the user via ModuleEvidenceList's inline caption editor.
   */
  const handleBatchPhotoUpload = async (files: FileList) => {
    if (isLocked || !docContext) return;
    setUploadingPhoto(true);
    setUploadErrors([]);
    const errors: string[] = [];
    let uploadCount = 0;

    try {
      const filesToUpload = Array.from(files).slice(0, MAX_BATCH_FILES);
      if (files.length > MAX_BATCH_FILES) {
        errors.push(
          `Only first ${MAX_BATCH_FILES} files will be uploaded (limit: ${MAX_BATCH_FILES} per batch)`,
        );
      }

      for (const file of filesToUpload) {
        const validationError = validateImageFile(file);
        if (validationError) {
          errors.push(validationError);
          continue;
        }

        const result = await uploadAttachment(
          docContext.organisationId,
          moduleInstance.document_id,
          docContext.baseDocumentId,
          file,
          undefined,          // caption — user sets via ModuleEvidenceList inline edit
          moduleInstance.id,  // module_instance_id
        );

        if (result.success) {
          uploadCount++;
        } else {
          errors.push(
            `Failed to upload ${file.name}${result.error ? `: ${result.error}` : ''}`,
          );
        }
      }

      if (uploadCount > 0) setEvidenceRefreshKey((k) => k + 1);
      if (errors.length > 0) setUploadErrors(errors);
    } finally {
      setUploadingPhoto(false);
    }
  };

  /**
   * Uploads a site plan via the lock-safe uploadAttachment() path.
   *
   * The file is renamed with the SITE_PLAN_PREFIX ('site_plan_') before upload.
   * handleSave() uses this prefix to identify the site plan attachment when
   * deriving the JSONB mirror read by buildReSurveyPdf.ts.
   *
   * To replace an existing site plan, the user deletes it via ModuleEvidenceList
   * then uploads a new one.
   */
  const handleSitePlanUpload = async (file: File) => {
    if (isLocked || !docContext) return;
    setUploadingSitePlan(true);
    setUploadErrors([]);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadErrors([
        `File exceeds ${MAX_FILE_SIZE_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      ]);
      setUploadingSitePlan(false);
      return;
    }

    const allowedTypes = [...ALLOWED_IMAGE_TYPES, 'application/pdf'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setUploadErrors(['File must be an image (jpg, png, heic) or PDF']);
      setUploadingSitePlan(false);
      return;
    }

    // Rename to site_plan_ prefix so handleSave can identify it by file_name.
    const fileExt = file.name.split('.').pop();
    const renamedFile = new File(
      [file],
      `${SITE_PLAN_PREFIX}${crypto.randomUUID()}.${fileExt}`,
      { type: file.type },
    );

    const result = await uploadAttachment(
      docContext.organisationId,
      moduleInstance.document_id,
      docContext.baseDocumentId,
      renamedFile,
      undefined,          // caption — user sets via ModuleEvidenceList inline edit
      moduleInstance.id,
    );

    if (result.success) {
      setEvidenceRefreshKey((k) => k + 1);
    } else {
      setUploadErrors([
        `Failed to upload site plan${result.error ? `: ${result.error}` : ''}. Please try again.`,
      ]);
    }
    setUploadingSitePlan(false);
  };

  // ─── Save ────────────────────────────────────────────────────────────────────

  /**
   * Saves the module instance.
   *
   * Re-queries the current attachment list before writing so the JSONB mirror
   * reflects any caption edits or deletions made via ModuleEvidenceList since
   * the last upload. The mirror is consumed by buildReSurveyPdf.ts until P3
   * migrates the PDF builder to query the attachments table directly.
   *
   * Mirror shape (unchanged from original JSONB schema):
   *   data.photos[]   ← { id, storage_path, caption, uploaded_at }
   *   data.site_plan  ← { storage_path, description, uploaded_at } | null
   */
  const handleSave = async () => {
    if (isLocked) return;
    setIsSaving(true);
    try {
      const currentAttachments = await getModuleAttachments(moduleInstance.id);

      // Most-recent site plan wins when multiple exist (e.g. user uploaded twice).
      const sortedDesc = [...currentAttachments].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const sitePlanAtt =
        sortedDesc.find((a) => a.file_name.startsWith(SITE_PLAN_PREFIX)) ?? null;
      const photoAtts = currentAttachments.filter(
        (a) => !a.file_name.startsWith(SITE_PLAN_PREFIX),
      );

      const photos = photoAtts.map((a) => ({
        id: a.id,
        storage_path: a.file_path,
        caption: a.caption ?? '',
        uploaded_at: a.created_at,
      }));

      const site_plan = sitePlanAtt
        ? {
            storage_path: sitePlanAtt.file_path,
            description: sitePlanAtt.caption ?? '',
            uploaded_at: sitePlanAtt.created_at,
          }
        : null;

      const payload = sanitizeModuleInstancePayload({
        data: { photos, site_plan },
        outcome,
        assessor_notes: assessorNotes,
      });

      const { error } = await supabase
        .from('module_instances')
        .update(payload)
        .eq('id', moduleInstance.id);

      if (error) throw error;
      onSaved();
    } catch (error) {
      console.error('Error saving:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-6 px-6 py-6 max-w-5xl mx-auto pb-24">

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-1">RE-10 – Supporting Documentation</p>
              <p className="text-blue-800 mb-2">
                Upload site photographs and site plan documentation to support the assessment.
              </p>
              <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                <li>Maximum {MAX_FILE_SIZE_MB}MB per file</li>
                <li>Up to {MAX_BATCH_FILES} photos per batch upload</li>
                <li>Supported formats: JPG, PNG, HEIC (+ PDF for site plan)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Upload errors */}
        {uploadErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-red-900 mb-2">Upload Errors</p>
                <ul className="text-red-800 space-y-1">
                  {uploadErrors.map((err, idx) => (
                    <li key={idx} className="text-xs">{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Site Photos — upload controls.
            Display, caption editing and deletion are handled by ModuleEvidenceList below. */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Site Photos</h3>
            {!isLocked && (
              <label
                className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  uploadingPhoto || !docContext
                    ? 'bg-blue-300 text-white cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Upload className="w-4 h-4" />
                {uploadingPhoto ? 'Uploading…' : 'Upload Photos'}
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/heic"
                  multiple
                  capture="environment"
                  className="hidden"
                  disabled={uploadingPhoto || !docContext}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleBatchPhotoUpload(files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {!docContext && !isLocked && (
            <p className="text-xs text-slate-400">Preparing upload…</p>
          )}
        </div>

        {/* Site Plan — upload controls.
            Display, caption editing and deletion are handled by ModuleEvidenceList below.
            To replace an existing site plan, delete it from the list then upload again. */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Site Plan</h3>
            {!isLocked && (
              <label
                className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  uploadingSitePlan || !docContext
                    ? 'bg-green-300 text-white cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <Upload className="w-4 h-4" />
                {uploadingSitePlan ? 'Uploading…' : 'Upload Site Plan'}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={uploadingSitePlan || !docContext}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSitePlanUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Accepts image files or PDF. To replace an existing site plan, delete it from
            the evidence list below then upload the new version.
          </p>
        </div>

        {/* Evidence list — primary display for all RE-10 attachments.
            Handles thumbnails, signed URLs, inline caption editing, and deletion.
            refreshKey triggers a re-fetch after each upload. */}
        <ModuleEvidenceList
          moduleInstanceId={moduleInstance.id}
          documentId={moduleInstance.document_id}
          isLocked={isLocked}
          refreshKey={evidenceRefreshKey}
        />

      </div>

      <FloatingSaveBar onSave={handleSave} isSaving={isSaving} />
    </>
  );
}
