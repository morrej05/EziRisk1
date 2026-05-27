import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type Attachment,
  getModuleAttachments,
  batchGetSignedUrls,
  deleteAttachment,
  updateAttachmentCaption,
} from '../utils/evidenceManagement';

/** Attachment row augmented with a lazily-fetched signed URL for thumbnail display. */
export interface ModuleEvidenceItem extends Attachment {
  /** Signed URL for image display, null for PDFs or if URL fetch failed. */
  signedUrl: string | null;
}

export interface UseModuleEvidenceReturn {
  items: ModuleEvidenceItem[];
  isLoading: boolean;
  error: string | null;
  /** Manually trigger a re-fetch (e.g. pull-to-refresh). */
  refresh: () => void;
  /**
   * Optimistically removes the item from the list, then calls the lock-safe
   * soft-delete path. Restores the list on failure.
   */
  deleteItem: (id: string) => Promise<{ error?: string }>;
  /**
   * Optimistically updates the caption in the list, then calls the lock-safe
   * caption-update path. Restores the previous value on failure.
   */
  updateItemCaption: (id: string, caption: string) => Promise<{ error?: string }>;
}

/**
 * Fetches evidence (attachments) scoped to a single module instance.
 *
 * Key behaviours:
 *  - Only queries attachments WHERE module_instance_id = moduleInstanceId.
 *    Never loads the full document attachment set.
 *  - Re-fetches automatically when refreshKey increments (after an upload).
 *  - Batch-fetches signed URLs for image attachments in a single Supabase call.
 *  - Stale-check via ticket counter: concurrent fetches do not race.
 *  - Optimistic delete and caption-edit with lock-safe server calls.
 */
export function useModuleEvidence(
  moduleInstanceId: string,
  documentId: string,
  refreshKey = 0,
): UseModuleEvidenceReturn {
  const [items, setItems] = useState<ModuleEvidenceItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonically increasing ticket — only the latest fetch applies its result.
  const ticketRef = useRef(0);

  const load = useCallback(async () => {
    if (!moduleInstanceId) return;
    const ticket = ++ticketRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const attachments = await getModuleAttachments(moduleInstanceId);
      if (ticket !== ticketRef.current) return; // superseded by a newer fetch

      // Batch-fetch signed URLs for images only — PDFs show a static icon.
      const imagePaths = attachments
        .filter((a) => a.file_type.startsWith('image/'))
        .map((a) => a.file_path);

      const urlMap =
        imagePaths.length > 0 ? await batchGetSignedUrls(imagePaths) : {};
      if (ticket !== ticketRef.current) return;

      setItems(
        attachments.map((a) => ({
          ...a,
          signedUrl: urlMap[a.file_path] ?? null,
        })),
      );
    } catch (err) {
      if (ticket !== ticketRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load evidence');
    } finally {
      if (ticket === ticketRef.current) setIsLoading(false);
    }
  }, [moduleInstanceId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const refresh = useCallback(() => load(), [load]);

  /**
   * Optimistic delete: removes item from state immediately, then sends the
   * lock-safe soft-delete. Restores the snapshot if the server call fails.
   */
  const deleteItem = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const snapshot = items;
      setItems((current) => current.filter((i) => i.id !== id));

      const result = await deleteAttachment(id, documentId);
      if (!result.success) {
        setItems(snapshot);
        return { error: result.error };
      }
      return {};
    },
    [items, documentId],
  );

  /**
   * Optimistic caption update: applies the new value immediately, then sends
   * the lock-safe update. Restores the snapshot if the server call fails.
   */
  const updateItemCaption = useCallback(
    async (id: string, caption: string): Promise<{ error?: string }> => {
      const snapshot = items;
      setItems((current) =>
        current.map((i) => (i.id === id ? { ...i, caption } : i)),
      );

      const result = await updateAttachmentCaption(id, documentId, caption);
      if (!result.success) {
        setItems(snapshot);
        return { error: result.error };
      }
      return {};
    },
    [items, documentId],
  );

  return { items, isLoading, error, refresh, deleteItem, updateItemCaption };
}
