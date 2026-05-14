import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { resolveDocumentIdentity } from '../lib/documents/documentIdentity';
import { getModuleDisplayLabel } from '../lib/modules/moduleCatalog';

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
  sourceLabel: string;
  riskImplication: string;
  recommendationText: string;
  evidenceCount: number;
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
  source_factor_key?: string | null;
  observation_text?: string | null;
  action_required_text?: string | null;
  hazard_text?: string | null;
  category?: string | null;
  photos?: Array<unknown> | null;
  metadata?: Record<string, unknown> | null;
  documents: {
    id: string;
    title: string;
    organisation_id: string;
    responsible_person?: string | null;
    scope_description?: string | null;
    meta?: Record<string, unknown> | null;
    module_instances?: Array<{
      module_key?: string | null;
      site_id?: string | null;
      building_id?: string | null;
      data?: Record<string, unknown> | null;
    }> | null;
    organisations?: { name: string | null } | Array<{ name: string | null }> | null;
  };
}

function cleanDisplayLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\b[A-Z]{2,}_[A-Z0-9_]+\b/.test(trimmed) || /source_context|metadata|source[_ ]key/i.test(trimmed)) return '';
  return trimmed;
}

function mapDbRowToRegisterRow(row: RecommendationDbRow): RecommendationsRegisterRow {
  const identity = row.documents
    ? resolveDocumentIdentity(row.documents, row.documents.module_instances || [])
    : null;
  const siteName = identity?.siteName || row.documents?.title || 'Unknown site';
  const clientName = identity?.clientName || (Array.isArray(row.documents?.organisations) ? row.documents?.organisations[0]?.name : row.documents?.organisations?.name) || 'Unassigned client';
  const metadata = row.metadata || {};
  const sourceLabel =
    cleanDisplayLabel(metadata.sourceLabel) ||
    cleanDisplayLabel(metadata.sectionLabel) ||
    getModuleDisplayLabel(row.source_module_key);
  const evidenceCount = Array.isArray(row.photos) ? row.photos.length : 0;

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
    sourceLabel,
    riskImplication: row.hazard_text || '',
    recommendationText: row.action_required_text || row.title,
    evidenceCount,
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

    const organisationId = organisation.id;

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
            source_factor_key,
            observation_text,
            action_required_text,
            hazard_text,
            category,
            photos,
            metadata,
            documents!inner(
              id,
              title,
              organisation_id,
              responsible_person,
              scope_description,
              meta,
              module_instances(module_key, site_id, building_id, data),
              organisations(name)
            )
          `)
          .eq('is_suppressed', false)
          .eq('documents.organisation_id', organisationId)
          .order('updated_at', { ascending: false });

        if (fetchError) throw fetchError;

        if (!cancelled) {
          setRows(((data || []) as unknown as RecommendationDbRow[]).map(mapDbRowToRegisterRow));
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
