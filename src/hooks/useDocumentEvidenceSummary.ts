import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface EvidenceRow {
  id: string;
  module_instance_id: string | null;
  action_id: string | null;
  caption: string | null;
}

export interface DocumentEvidenceSummary {
  isLoading: boolean;
  totalCount: number;
  unlinkedCount: number;
  uncaptionedCount: number;
  evidenceCountsByModule: Record<string, number>;
  modulesWithEvidenceCount: number;
}

/**
 * Loads a lightweight evidence summary for the entire document in a single query.
 * Derives per-module counts, unlinked count, and uncaptioned count via useMemo.
 * No signed URLs, no blobs — metadata only.
 */
export function useDocumentEvidenceSummary(
  documentId: string | undefined,
  refreshKey = 0,
): DocumentEvidenceSummary {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const ticketRef = useRef(0);

  useEffect(() => {
    if (!documentId) {
      setRows([]);
      setIsLoading(false);
      return;
    }

    const ticket = ++ticketRef.current;
    setIsLoading(true);

    supabase
      .from('attachments')
      .select('id, module_instance_id, action_id, caption')
      .eq('document_id', documentId)
      .is('deleted_at', null)
      .then(({ data, error }) => {
        if (ticket !== ticketRef.current) return;
        if (error) {
          console.error('Error fetching document evidence summary:', error);
          setRows([]);
        } else {
          setRows(data || []);
        }
        setIsLoading(false);
      });
  }, [documentId, refreshKey]);

  const derived = useMemo(() => {
    const totalCount = rows.length;
    const unlinkedCount = rows.filter(
      (r) => !r.module_instance_id && !r.action_id,
    ).length;
    const uncaptionedCount = rows.filter((r) => !r.caption?.trim()).length;

    const evidenceCountsByModule: Record<string, number> = {};
    for (const row of rows) {
      if (row.module_instance_id) {
        evidenceCountsByModule[row.module_instance_id] =
          (evidenceCountsByModule[row.module_instance_id] ?? 0) + 1;
      }
    }

    return {
      totalCount,
      unlinkedCount,
      uncaptionedCount,
      evidenceCountsByModule,
      modulesWithEvidenceCount: Object.keys(evidenceCountsByModule).length,
    };
  }, [rows]);

  return { isLoading, ...derived };
}
