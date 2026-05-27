import { useRef, useEffect } from 'react';
import { Camera, Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useInlineEvidenceUpload } from '../../hooks/useInlineEvidenceUpload';

interface Props {
  documentId: string;
  moduleInstanceId: string;
  /** When true the component renders nothing — prevents uploads on issued/superseded docs. */
  isLocked: boolean;
  /** Button label. Defaults to "Add evidence". */
  label?: string;
  /** Allow selecting multiple files at once. Defaults to false. */
  multiple?: boolean;
  /** Called after every successful upload batch so the parent can refresh its state. */
  onUploaded?: () => void;
  /** Extra classes applied to the root wrapper element. */
  className?: string;
}

/**
 * Self-contained inline evidence upload component.
 *
 * Renders:
 *   1. A camera-icon trigger button that opens the file picker (with camera capture on mobile).
 *   2. When files are selected: a compact caption panel with an optional caption input and
 *      Upload / Cancel controls. Enter key confirms upload.
 *   3. A brief auto-dismissing success toast on completion.
 *   4. A persistent error toast (with dismiss) when upload fails.
 *
 * Uses the lock-safe uploadAttachment() path via useInlineEvidenceUpload().
 * Automatically links uploaded files to the provided moduleInstanceId.
 */
export default function InlineEvidenceUpload({
  documentId,
  moduleInstanceId,
  isLocked,
  label = 'Add evidence',
  multiple = false,
  onUploaded,
  className = '',
}: Props) {
  const captionInputRef = useRef<HTMLInputElement>(null);

  const {
    pendingFiles,
    caption,
    setCaption,
    isUploading,
    uploadResult,
    onFilesSelected,
    upload,
    dismiss,
  } = useInlineEvidenceUpload(documentId, moduleInstanceId, onUploaded);

  // Auto-dismiss success toast after 3 s so the trigger button reappears.
  useEffect(() => {
    if (!uploadResult?.success) return;
    const t = setTimeout(() => dismiss(), 3000);
    return () => clearTimeout(t);
  }, [uploadResult, dismiss]);

  // Move focus to the caption input the moment a file is staged.
  useEffect(() => {
    if (pendingFiles.length > 0) captionInputRef.current?.focus();
  }, [pendingFiles.length]);

  // Locked documents must never have evidence added — hide entirely.
  if (isLocked) return null;

  return (
    <div className={className}>
      {/* ── Trigger button — hidden while files are pending or a toast is showing ── */}
      {pendingFiles.length === 0 && !uploadResult && (
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none touch-manipulation px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 active:bg-blue-200 transition-colors">
          <Camera className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{label}</span>
          <input
            type="file"
            multiple={multiple}
            capture="environment"
            accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onFilesSelected(e.target.files);
              // Reset so selecting the same file again still fires onChange.
              e.target.value = '';
            }}
          />
        </label>
      )}

      {/* ── Success toast (auto-dismisses) ── */}
      {uploadResult?.success && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{uploadResult.message}</span>
        </div>
      )}

      {/* ── Error toast (persists until dismissed) ── */}
      {uploadResult && !uploadResult.success && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 min-w-0">{uploadResult.message}</span>
          <button
            type="button"
            onClick={dismiss}
            className="flex-shrink-0 hover:text-red-900 transition-colors"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Caption + upload panel — shown while files are staged ── */}
      {pendingFiles.length > 0 && (
        <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          {/* Filename row */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-blue-900 truncate min-w-0">
              {pendingFiles.length === 1
                ? pendingFiles[0].name
                : `${pendingFiles.length} files selected`}
            </p>
            <button
              type="button"
              onClick={dismiss}
              disabled={isUploading}
              className="flex-shrink-0 text-blue-400 hover:text-blue-700 transition-colors disabled:opacity-40"
              aria-label="Cancel upload"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Caption input — Enter confirms */}
          <input
            ref={captionInputRef}
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                upload();
              }
            }}
            placeholder="Add a caption (optional)"
            disabled={isUploading}
            className="w-full px-2.5 py-1.5 text-sm border border-blue-300 rounded-md bg-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          />

          {/* Confirm button */}
          <button
            type="button"
            onClick={upload}
            disabled={isUploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition-colors touch-manipulation"
          >
            {isUploading ? (
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
    </div>
  );
}
