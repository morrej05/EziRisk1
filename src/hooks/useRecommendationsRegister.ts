import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const RE_RECOMMENDATION_STATUSES = ['Open', 'In Progress', 'Completed'] as const;
export const RE_RECOMMENDATION_PRIORITIES = ['High', 'Medium', 'Low'] as const;

export type RecommendationStatusFilter = (typeof RE_RECOMMENDATION_STATUSES)[number] | 'Active';

export interface RecommendationsRegisterRow {
  id: string;
  documentId: string;
  recNumber: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  targetDate: string | null;
  sourceModuleKey: string;
  sourceType: string;
  siteName: string;
  documentName: string;
  clientName: string;
}

interface RecommendationDbRow {
  id: string;
  document_id: string;
  rec_number: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  target_date: string | null;
  source_module_key: string;
  source_type: string;
  documents: {
    id: string;
    title: string;
    organisation_id: string;
    organisations?: {
      name: string | null;
    } | null;
  };
}

function mapDbRowToRegisterRow(row: RecommendationDbRow): RecommendationsRegisterRow {
  const siteName = row.documents?.title || 'Unknown site';
  const clientName = row.documents?.organisations?.name || 'Unassigned client';

  return {
    id: row.id,
    documentId: row.document_id,
    recNumber: row.rec_number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetDate: row.target_date,
    sourceModuleKey: row.source_module_key,
    sourceType: row.source_type,
    siteName,
    documentName: siteName,
    clientName,
  };
}

export function useRecommendationsRegister() {
  const { organisation } = useAuth();
  const [rows, setRows] = useState<RecommendationsRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organisation?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchRecommendations() {
      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('re_recommendations')
          .select(`
            id,
            document_id,
            rec_number,
            title,
            status,
            priority,
            created_at,
            updated_at,
            target_date,
            source_module_key,
            source_type,
            documents!inner(
              id,
              title,
              organisation_id,
              organisations(name)
            )
          `)
          .eq('is_suppressed', false)
          .eq('documents.organisation_id', organisation.id)
          .order('updated_at', { ascending: false });

        if (fetchError) throw fetchError;

        if (!cancelled) {
          setRows(((data || []) as RecommendationDbRow[]).map(mapDbRowToRegisterRow));
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load risk engineering recommendations');
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRecommendations();

    return () => {
      cancelled = true;
    };
  }, [organisation?.id]);

  const options = useMemo(() => {
    const clients = Array.from(new Set(rows.map((row) => row.clientName))).sort((a, b) => a.localeCompare(b));
    const sites = Array.from(new Set(rows.map((row) => row.siteName))).sort((a, b) => a.localeCompare(b));
    const documents = Array.from(new Set(rows.map((row) => row.documentName))).sort((a, b) => a.localeCompare(b));
    const statuses = Array.from(new Set(rows.map((row) => row.status))).sort((a, b) => a.localeCompare(b));
    const priorities = Array.from(new Set(rows.map((row) => row.priority))).sort((a, b) => a.localeCompare(b));

    return {
      clients,
      sites,
      documents,
      statuses,
      priorities,
    };
  }, [rows]);

  return {
    rows,
    loading,
    error,
    options,
  };
}
