import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { resolveDocumentIdentity } from '../lib/documents/documentIdentity';

export interface Document {
  id: string;
  organisation_id: string;
  document_type: 'FRA' | 'FSD' | 'DSEAR' | 'RE';
  title: string;
  status: 'draft' | 'issued' | 'superseded';
  issue_status: 'draft' | 'issued' | 'superseded';
  version: number;
  created_at: string;
  updated_at: string;
  assessor_name: string | null;
  display_author_name?: string | null;
  author_name_snapshot?: string | null;
  site_id?: string | null;
  building_id?: string | null;
  responsible_person?: string | null;
  scope_description?: string | null;
  meta?: {
    client?: { id?: string | null; name?: string | null } | null;
    site?: { id?: string | null; name?: string | null } | null;
    [key: string]: unknown;
  } | null;
  module_instances?: Array<{
    module_key?: string | null;
    site_id?: string | null;
    building_id?: string | null;
    data?: Record<string, unknown> | null;
  }> | null;
  organisations?: { name: string | null } | Array<{ name: string | null }> | null;
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
  const identity = resolveDocumentIdentity(document, document.module_instances || []);
  if (identity.clientName) {
    return identity.clientName;
  }

  const rawOrgName = (Array.isArray(document.organisations) ? document.organisations[0]?.name : document.organisations?.name)?.trim();
  const looksLikeSignupPlaceholder = !!rawOrgName && /@.+organisation$/i.test(rawOrgName);

  // V1: organisation names are account-level and may be email-derived placeholders,
  // so don't use them as the runtime client label in assessment tables unless no document identity exists.
  if (!rawOrgName || looksLikeSignupPlaceholder) {
    return 'Client not set';
  }

  return rawOrgName;
}

function resolveDocumentSurveyor(document: Document): string | null {
  // 1. Stored assessor_name column (set at issue time for FRA/FSD/DSEAR)
  const stored = document.assessor_name?.trim();
  if (stored) return stored;

  // 2. RE documents: assessor.name saved in RE_01_DOC_CONTROL module data
  if (document.document_type === 'RE' && Array.isArray(document.module_instances)) {
    const re01 = document.module_instances.find(
      (m) => m.module_key === 'RE_01_DOC_CONTROL' || m.module_key === 'RE_01_DOCUMENT_CONTROL'
    );
    const assessorName = String((re01?.data as any)?.assessor?.name || '').trim();
    if (assessorName) return assessorName;
  }

  // 3. display_author_name / author_name_snapshot — set server-side by
  //    trg_enforce_document_author_identity for all document types at creation.
  //    Covers FRA/FSD/DSEAR/RE docs where assessor_name was never explicitly written.
  const displayName = document.display_author_name?.trim();
  if (displayName) return displayName;

  const snapshot = document.author_name_snapshot?.trim();
  if (snapshot) return snapshot;

  return null;
}

function mapDocumentToViewModel(document: Document): AssessmentViewModel {
  const typeMap: Record<string, { display: string; discipline: string }> = {
    FRA: { display: 'FRA', discipline: 'Fire' },
    FSD: { display: 'Fire Strategy', discipline: 'Fire' },
    DSEAR: { display: 'DSEAR', discipline: 'Risk Engineering' },
    RE: { display: 'Risk Engineering', discipline: 'Risk Engineering' },
  };

  const typeInfo = typeMap[document.document_type] || { display: document.document_type, discipline: 'Fire' };

  const identity = resolveDocumentIdentity(document, document.module_instances || []);

  return {
    id: document.id,
    clientName: getClientDisplayName(document),
    siteName: identity.siteName || document.title || 'Site not set',
    discipline: typeInfo.discipline,
    type: typeInfo.display,
    status: document.status.charAt(0).toUpperCase() + document.status.slice(1),
    issueStatus: document.issue_status,
    surveyor: resolveDocumentSurveyor(document),
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
            display_author_name,
            author_name_snapshot,
            issue_status,
            site_id,
            building_id,
            responsible_person,
            scope_description,
            meta,
            module_instances (module_key, site_id, building_id, data),
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
