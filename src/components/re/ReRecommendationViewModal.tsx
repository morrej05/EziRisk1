import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Image as ImageIcon, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { batchGetSignedUrls } from '../../utils/evidenceManagement';
import { getModuleDisplayLabel } from '../../lib/modules/moduleCatalog';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PhotoEntry {
  path?: string;
  storage_path?: string;
  caption?: string;
  file_name?: string;
}

interface RecDetail {
  id: string;
  rec_number: string | null;
  title: string;
  observation_text: string | null;
  action_required_text: string | null;
  hazard_text: string | null;
  status: string;
  priority: string;
  target_date: string | null;
  source_module_key: string | null;
  photos: PhotoEntry[] | null;
  metadata: Record<string, unknown> | null;
}

export interface ReRecommendationViewModalProps {
  recId: string;
  /** If set, the footer "Back" button navigates here. */
  returnTo: string | null;
  /** Called when the modal should close without navigating away. */
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPriorityBadgeClass(priority: string): string {
  if (priority === 'High') return 'bg-rose-50 text-rose-700 border border-rose-200';
  if (priority === 'Medium') return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (priority === 'Low') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function getPriorityLabel(priority: string): string {
  if (priority === 'High') return 'P1 / High';
  if (priority === 'Medium') return 'P2 / Medium';
  if (priority === 'Low') return 'P3 / Low';
  return priority || 'Unknown';
}

function getStatusBadgeClass(status: string): string {
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (status === 'In Progress') return 'bg-blue-50 text-blue-700 border border-blue-200';
  if (status === 'Open') return 'bg-amber-50 text-amber-700 border border-amber-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function resolveSourceLabel(rec: RecDetail): string {
  const meta = rec.metadata || {};
  const fromMeta =
    (typeof meta.sourceLabel === 'string' && meta.sourceLabel.trim()) ||
    (typeof meta.sectionLabel === 'string' && meta.sectionLabel.trim());
  if (fromMeta) return fromMeta;
  if (rec.source_module_key) return getModuleDisplayLabel(rec.source_module_key);
  return 'Assessment section';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReRecommendationViewModal({
  recId,
  returnTo,
  onClose,
}: ReRecommendationViewModalProps) {
  const navigate = useNavigate();

  const [rec, setRec] = useState<RecDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Keep onClose ref fresh so the Escape closure is always current.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Escape key dismissal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Fetch recommendation detail.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRec(null);
    setSignedUrls({});

    supabase
      .from('re_recommendations')
      .select(
        'id, rec_number, title, observation_text, action_required_text, hazard_text, status, priority, target_date, source_module_key, photos, metadata'
      )
      .eq('id', recId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !data) {
          if (!cancelled) setLoading(false);
          return;
        }
        const detail = data as RecDetail;
        setRec(detail);

        // Resolve signed URLs for photos stored in the JSONB mirror.
        // Photos written by CanonicalReRecommendationModal have { path, file_name, ... }.
        const photos = Array.isArray(detail.photos) ? detail.photos : [];
        const paths = photos
          .map((p) => p.path || p.storage_path || '')
          .filter(Boolean);

        if (paths.length > 0) {
          const urls = await batchGetSignedUrls(paths);
          if (!cancelled) setSignedUrls(urls);
        }

        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [recId]);

  const photos: PhotoEntry[] = Array.isArray(rec?.photos) ? rec!.photos : [];

  const handleBack = () => {
    if (returnTo) {
      navigate(returnTo);
    } else {
      onClose();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {rec?.rec_number && (
              <span className="shrink-0 font-mono text-xs font-semibold text-slate-400">
                {rec.rec_number}
              </span>
            )}
            <h2 className="truncate text-base font-bold text-slate-900">
              {loading ? 'Loading…' : rec ? rec.title : 'Recommendation not found'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            </div>
          )}

          {!loading && !rec && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This recommendation could not be loaded. It may have been deleted or you may not
              have permission to view it.
            </div>
          )}

          {!loading && rec && (
            <div className="space-y-5">

              {/* Status / priority / metadata chips */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(rec.priority)}`}
                >
                  {getPriorityLabel(rec.priority)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(rec.status)}`}
                >
                  {rec.status}
                </span>
                {rec.target_date && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                    Due {formatDate(rec.target_date)}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                  {resolveSourceLabel(rec)}
                </span>
              </div>

              {/* Observation */}
              {rec.observation_text && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Observation / Finding
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-line">
                    {rec.observation_text}
                  </p>
                </section>
              )}

              {/* Action required */}
              {rec.action_required_text && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Recommendation / Action Required
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-line">
                    {rec.action_required_text}
                  </p>
                </section>
              )}

              {/* Risk implication */}
              {rec.hazard_text && (
                <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                        Risk Implication / Consequence
                      </h3>
                      <p className="text-sm leading-relaxed text-amber-900 whitespace-pre-line">
                        {rec.hazard_text}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* Evidence photos */}
              {photos.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Evidence ({photos.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((photo, i) => {
                      const storagePath = photo.path || photo.storage_path || '';
                      const url = storagePath ? (signedUrls[storagePath] ?? null) : null;
                      return (
                        <div
                          key={i}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                        >
                          <div className="aspect-video overflow-hidden bg-slate-100">
                            {url ? (
                              <img
                                src={url}
                                alt={photo.file_name || `Evidence ${i + 1}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-slate-400" />
                              </div>
                            )}
                          </div>
                          {photo.caption && (
                            <p className="px-2 py-1.5 text-xs italic text-slate-600">
                              {photo.caption}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
          {returnTo ? (
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <span aria-hidden>←</span> Back to recommendations
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
