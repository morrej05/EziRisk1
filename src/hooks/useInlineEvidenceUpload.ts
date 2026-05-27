import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { uploadAttachment } from '../utils/evidenceManagement';

interface DocContext {
  organisationId: string;
  baseDocumentId: string;
}

export interface InlineUploadResult {
  success: boolean;
  message: string;
}

export interface UseInlineEvidenceUploadReturn {
  pendingFiles: File[];
  caption: string;
  setCaption: (v: string) => void;
  isUploading: boolean;
  uploadResult: InlineUploadResult | null;
  onFilesSelected: (files: FileList | File[]) => void;
  upload: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Shared hook for inline evidence upload with optional caption.
 *
 * Handles:
 *   - Fetching document organisation/base_document_id once on mount
 *   - Pending file state and optional caption
 *   - Lock-safe upload via uploadAttachment() (enforces issue_status check)
 *   - Per-upload success / error result state
 *
 * Usage:
 *   const { pendingFiles, caption, setCaption, isUploading, uploadResult,
 *           onFilesSelected, upload, dismiss } =
 *     useInlineEvidenceUpload(documentId, moduleInstanceId, onUploaded);
 */
export function useInlineEvidenceUpload(
  documentId: string,
  moduleInstanceId: string,
  onUploaded?: () => void,
): UseInlineEvidenceUploadReturn {
  const [docContext, setDocContext] = useState<DocContext | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<InlineUploadResult | null>(null);

  // Fetch org + base doc ID once so upload() doesn't need to re-query on every call.
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;

    supabase
      .from('documents')
      .select('organisation_id, base_document_id')
      .eq('id', documentId)
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
  }, [documentId]);

  const onFilesSelected = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setPendingFiles(arr);
    setCaption('');
    setUploadResult(null);
  }, []);

  const upload = useCallback(async () => {
    if (!pendingFiles.length || !docContext || isUploading) return;
    setIsUploading(true);
    try {
      let successCount = 0;
      for (const file of pendingFiles) {
        const result = await uploadAttachment(
          docContext.organisationId,
          documentId,
          docContext.baseDocumentId,
          file,
          caption.trim() || undefined,
          moduleInstanceId,
        );
        if (!result.success) throw new Error(result.error || 'Upload failed');
        successCount++;
      }
      setUploadResult({
        success: true,
        message: `${successCount} file${successCount === 1 ? '' : 's'} linked.`,
      });
      setPendingFiles([]);
      setCaption('');
      onUploaded?.();
    } catch (err) {
      setUploadResult({
        success: false,
        message: err instanceof Error ? err.message : 'Upload failed. Please try again.',
      });
    } finally {
      setIsUploading(false);
    }
  }, [pendingFiles, docContext, isUploading, documentId, moduleInstanceId, caption, onUploaded]);

  const dismiss = useCallback(() => {
    setPendingFiles([]);
    setCaption('');
    setUploadResult(null);
  }, []);

  return {
    pendingFiles,
    caption,
    setCaption,
    isUploading,
    uploadResult,
    onFilesSelected,
    upload,
    dismiss,
  };
}
