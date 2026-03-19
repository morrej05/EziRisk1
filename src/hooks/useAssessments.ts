import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface Document {
  id: string;
  organisation_id: string;
  document_type: 'FRA' | 'FSD' | 'DSEAR';
  title: string;
  status: 'draft' | 'issued' | 'superseded';
  issue_status: 'draft' | 'issued' | 'superseded';
  version: number;
  created_at: string;
  updated_at: string;
  assessor_name: string | null;
  meta?: {
    client?: { name?: string | null } | null;
    site?: { name?: string | null } | null;
  } | null;
  organisations?: {
    name: string;
  };
}

export interface AssessmentViewModel {
  id: string;
  clientName: string;
  siteName: string;
  discipline: string;
  type: string;
  status: string;
  issueStatus: 'draft' | 'issued' | 'superseded';
  surveyor: string | null;
  updatedAt: Date;
  createdAt: Date;
}

function getClientDisplayName(document: Document): string {
  const metaClientName = document.meta?.client?.name?.trim();
  if (metaClientName) {
    return metaClientName;
  }

  const rawOrgName = document.organisations?.name?.trim();
  const looksLikeSignupPlaceholder = !!rawOrgName && /@.+organisation$/i.test(rawOrgName);

  // V1: organisation names are account-level and may be email-derived placeholders,
  // so don't use them as the runtime client label in assessment tables.
  if (!rawOrgName || looksLikeSignupPlaceholder) {
    return 'Client not set';
  }

  return rawOrgName;
}

function mapDocumentToViewModel(document: Document): AssessmentViewModel {
  const typeMap: Record<string, { display: string; discipline: string }> = {
    FRA: { display: 'FRA', discipline: 'Fire' },
    FSD: { display: 'Fire Strategy', discipline: 'Fire' },
    DSEAR: { display: 'DSEAR', discipline: 'Risk Engineering' },
  };

  const typeInfo = typeMap[document.document_type] || { display: document.document_type, discipline: 'Fire' };

  return {
    id: document.id,
    clientName: getClientDisplayName(document),
    siteName: document.meta?.site?.name?.trim() || document.title || 'Site not set',
    discipline: typeInfo.discipline,
    type: typeInfo.display,
    status: document.status.charAt(0).toUpperCase() + document.status.slice(1),
    issueStatus: document.issue_status,
    surveyor: document.assessor_name,
    updatedAt: new Date(document.updated_at),
    createdAt: new Date(document.created_at),
  };
}

export interface UseAssessmentsOptions {
  limit?: number;
  activeOnly?: boolean;
  refreshKey?: number;
}

export function useAssessments(options: UseAssessmentsOptions = {}) {
  const { limit, activeOnly, refreshKey } = options;
  const { organisation } = useAuth();
  const [assessments, setAssessments] = useState<AssessmentViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organisation?.id) {
      setLoading(false);
      return;
    }

    async function fetchAssessments() {
      try {
        setLoading(true);
        setError(null);

        let query = supabase
          .from('documents')
          .select(`
            id,
            organisation_id,
            document_type,
            title,
            status,
            version,
            created_at,
            updated_at,
            assessor_name,
            issue_status,
            meta,
            organisations (name)
          `)
          .eq('organisation_id', organisation.id)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false });

        if (activeOnly) {
          query = query.in('status', ['draft']);
        }

        if (limit) {
          query = query.limit(limit);
        }

        const { data, error: fetchError } = await query;

        if (fetchError) throw fetchError;

        const viewModels = (data || []).map(mapDocumentToViewModel);
        setAssessments(viewModels);
      } catch (err) {
        console.error('Error fetching assessments:', err);
        setError(err instanceof Error ? err.message : 'Failed to load assessments');
      } finally {
        setLoading(false);
      }
    }

    fetchAssessments();
  }, [organisation?.id, limit, activeOnly, refreshKey]);

  return { assessments, loading, error };
}
