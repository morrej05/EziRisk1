import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileText,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  RefreshCw,
  Link2,
} from 'lucide-react';
import {
  useModuleEvidence,
  type ModuleEvidenceItem,
} from '../../hooks/useModuleEvidence';

interface Props {
  moduleInstanceId: string;
  documentId: string;
  /** When true: hides edit/delete controls. Component still renders for read-only evidence viewing. */
  isLocked: boolean;
  /** Increment to trigger a re-fetch (e.g. after InlineEvidenceUpload.onUploaded fires). */
  refreshKey?: number;
  /** Extra classes applied to the root wrapper. */
  className?: string;
}

/**
 * Returns a compact human-readable relative timestamp.
 * Falls back to a short locale date for items older than a week.
 */
function formatRelativeTime(dateString: string): string {
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Compact inline evidence list for module workflows.
 *
 * Renders all attachments linked to the given moduleInstanceId.
 * Returns null when the list is empty and not loading (no visual footprint).
 *
 * Features:
 *  - Image thumbnail (40px, lazy-loaded) or file icon for PDFs
 *  - Filename, relative timestamp, caption, action-link badge
 *  - Inline caption edit: click pencil → input → Enter/blur saves, Escape cancels
 *  - Inline delete with two-step confirm (no modal)
 *  - All mutations use lock-safe paths from evidenceManagement.ts
 *  - Optimistic UI: changes reflected immediately, reverted on server error
 */
export default function ModuleEvidenceList({
  moduleInstanceId,
  documentId,
  isLocked,
  refreshKey = 0,
  className = '',
}: Props) {
  const { items, isLoading, error, refresh, deleteItem, updateItemCaption } =
    useModuleEvidence(moduleInstanceId, documentId, refreshKey);

  // ── Per-interaction state (only one item can be in any state at a time) ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);

  // Focus caption input after React has committed the re-render that shows it.
  useEffect(() => {
    if (editingId) captionInputRef.current?.focus();
  }, [editingId]);

  const startEdit = useCallback((item: ModuleEvidenceItem) => {
    setConfirmDeleteId(null);
    setActionError(null);
    setEditingId(item.id);
    setEditCaption(item.caption ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditCaption('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setPendingId(editingId);
    setActionError(null);
    const { error: err } = await updateItemCaption(editingId, editCaption.trim());
    setPendingId(null);
    if (err) {
      setActionError(err);
    } else {
      setEditingId(null);
      setEditCaption('');
    }
  }, [editingId, editCaption, updateItemCaption]);

  const handleDelete = useCallback(
    async (id: string) => {
      setPendingId(id);
      setActionError(null);
      setConfirmDeleteId(null);
      const { error: err } = await deleteItem(id);
      setPendingId(null);
      if (err) setActionError(err);
    },
    [deleteItem],
  );

  // Nothing to show yet — render nothing so pages with no evidence stay clean.
  if (!isLoading && items.length === 0 && !error) return null;

  return (
    <div className={className}>
      {/* ── Section header ── */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-neutral-700">
          Module evidence
          {items.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-neutral-400">
              ({items.length})
            </span>
          )}
        </h4>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          className="p-1 -m-1 text-neutral-400 hover:text-neutral-600 disabled:opacity-40 transition-colors touch-manipulation"
          aria-label="Refresh evidence list"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* ── Error banners ── */}
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}
      {actionError && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 mb-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          <span className="flex-1 min-w-0">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="flex-shrink-0 hover:text-red-900 touch-manipulation"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Evidence card list ── */}
      <div className="space-y-1.5">
        {items.map((item) => {
          const isImage = item.file_type.startsWith('image/');
          const isEditing = editingId === item.id;
          const isConfirmingDelete = confirmDeleteId === item.id;
          const isPending = pendingId === item.id;

          return (
            <div
              key={item.id}
              className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 transition-colors"
            >
              {/* ── Thumbnail (40×40) or file icon ── */}
              <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-neutral-100 border border-neutral-200 flex items-center justify-center">
                {isImage && item.signedUrl ? (
                  <img
                    src={item.signedUrl}
                    alt={item.file_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <FileText className="w-4 h-4 text-neutral-400" />
                )}
              </div>

              {/* ── Content ── */}
              <div className="flex-1 min-w-0 self-center">
                {/* Filename + relative timestamp */}
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-neutral-800 truncate flex-1 min-w-0">
                    {item.file_name}
                  </span>
                  <span className="text-xs text-neutral-400 flex-shrink-0 whitespace-nowrap">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </div>

                {/* Caption / inline edit / delete confirm */}
                {isEditing ? (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      ref={captionInputRef}
                      type="text"
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                      }}
                      disabled={isPending}
                      placeholder="Add a caption…"
                      className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={isPending}
                      className="flex-shrink-0 p-0.5 text-green-600 hover:text-green-700 disabled:opacity-40 touch-manipulation"
                      aria-label="Save caption"
                    >
                      {isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isPending}
                      className="flex-shrink-0 p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-40 touch-manipulation"
                      aria-label="Cancel edit"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : isConfirmingDelete ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-medium text-red-700">Delete?</span>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-neutral-500 underline hover:text-neutral-700 touch-manipulation"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      disabled={isPending}
                      className="text-xs font-semibold text-red-600 underline hover:text-red-800 disabled:opacity-40 touch-manipulation"
                    >
                      {isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      item.caption ? 'text-neutral-500' : 'text-neutral-400 italic'
                    }`}
                  >
                    {item.caption || 'No caption'}
                  </p>
                )}

                {/* Recommendation link badge */}
                {item.action_id && !isEditing && !isConfirmingDelete && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Link2 className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                    <span className="text-xs text-neutral-400">
                      Linked to recommendation
                    </span>
                  </div>
                )}
              </div>

              {/* ── Action buttons (hidden when locked, editing, or confirming) ── */}
              {!isLocked && !isEditing && !isConfirmingDelete && (
                <div className="flex items-center gap-0.5 flex-shrink-0 self-start mt-0.5">
                  {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className="p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors touch-manipulation"
                        aria-label="Edit caption"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setActionError(null);
                          setConfirmDeleteId(item.id);
                        }}
                        className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors touch-manipulation"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
