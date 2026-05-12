import { supabase } from '../lib/supabase';
import { buildFraPdf } from '../lib/pdf/buildFraPdf';
import { buildFsdPdf } from '../lib/pdf/buildFsdPdf';
import { buildDsearPdf } from '../lib/pdf/buildDsearPdf';
import { buildCombinedPdf } from '../lib/pdf/buildCombinedPdf';
import { buildFraDsearCombinedPdf } from '../lib/pdf/buildFraDsearCombinedPdf';
import { migrateLegacyFraActions } from '../lib/modules/fra/migrateLegacyFraActions';
import type { FraContext } from '../lib/modules/fra/severityEngine';
import { migrateLegacyDsearActions } from '../lib/dsear/migrateLegacyDsearActions';
import { getSelectedExecutiveSummaryText } from '../lib/pdf/pdfUtils';
import { buildPdfIdentityOptions } from './pdfIdentity';
import type { Organisation as EntitlementOrganisation } from './entitlements';
import { withTimeout } from './withTimeout';

const PDF_GENERATION_TIMEOUT = 30000;

type IssueableDocument = {
  id: string;
  document_type: string;
  enabled_modules?: string[] | null;
  title: string;
  version_number: number;
  issue_status: 'draft' | 'issued' | 'superseded';
  [key: string]: unknown;
};


type ModuleInstanceLike = {
  module_key: string;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type ActionLike = {
  id: string;
  [key: string]: unknown;
};

type ActionRatingLike = {
  action_id: string;
  likelihood: unknown;
  impact: unknown;
  score: unknown;
  rated_at: string | null;
};

type StoreIssuedPdfResponse = {
  error?: string;
  signed_url?: string;
  pdf_path?: string;
};

type OrganisationLike = {
  id: string;
  name: string;
  branding_logo_path?: string | null;
  [key: string]: unknown;
};

type UserLike = {
  name?: string | null;
  email?: string | null;
} | null;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function loadOrganisation(organisationId: string): Promise<OrganisationLike> {
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', organisationId)
    .single();

  if (error) throw error;
  return data;
}

async function loadCurrentUser(): Promise<UserLike> {
  const { data } = await supabase.auth.getUser();
  const authUser = data.user;

  if (!authUser) return null;

  return {
    name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
    email: authUser.email || null,
  };
}

export async function buildIssuedPdfForDocument(
  document: IssueableDocument,
  organisationId: string
): Promise<Uint8Array> {
  const [{ data: moduleInstances, error: moduleError }, { data: actions, error: actionsError }, organisation, user] = await Promise.all([
    supabase
      .from('module_instances')
      .select('*')
      .eq('document_id', document.id)
      .eq('organisation_id', organisationId),
    supabase
      .from('actions')
      .select('*')
      .eq('document_id', document.id)
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    loadOrganisation(organisationId),
    loadCurrentUser(),
  ]);

  if (moduleError) throw moduleError;
  if (actionsError) throw actionsError;

  const { data: sourceLinks, error: sourceLinksError } = await supabase
    .from('action_source_links')
    .select('*, actions(id, reference_number, status, recommended_action, deleted_at)')
    .eq('document_id', document.id)
    .eq('organisation_id', organisationId)
    .is('deleted_at', null);

  if (sourceLinksError) throw sourceLinksError;

  const linksByModule = new Map<string, Array<Record<string, unknown>>>();
  const linksByAction = new Map<string, Array<Record<string, unknown>>>();
  for (const link of sourceLinks || []) {
    const moduleLinks = linksByModule.get(link.module_instance_id) || [];
    moduleLinks.push({ ...link, action: link.actions });
    linksByModule.set(link.module_instance_id, moduleLinks);

    const actionLinks = linksByAction.get(link.action_id) || [];
    actionLinks.push(link);
    linksByAction.set(link.action_id, actionLinks);
  }

  const moduleInstancesWithSourceLinks = (moduleInstances || []).map((module) => ({
    ...module,
    data: {
      ...(module.data || {}),
      __action_source_links: linksByModule.get(module.id) || [],
    },
  }));

  let migratedActions = (actions || []).map((action) => ({
    ...action,
    source_links: linksByAction.get(action.id) || [],
  }));
  if (document.document_type === 'DSEAR') {
    migratedActions = migrateLegacyDsearActions(migratedActions);
  } else if (document.document_type === 'FRA' || document.document_type === 'FSD') {
    const buildingProfile = (moduleInstancesWithSourceLinks as ModuleInstanceLike[]).find((m) => m.module_key === 'A2_BUILDING_PROFILE');
    const fraContext: FraContext = {
      occupancyRisk: (buildingProfile?.data?.occupancy_risk || 'NonSleeping') as 'NonSleeping' | 'Sleeping' | 'Vulnerable',
      storeys: buildingProfile?.data?.number_of_storeys || null,
    };
    migratedActions = migrateLegacyFraActions(migratedActions, fraContext);
  }

  const actionIds = (migratedActions as ActionLike[]).map((action) => action.id);
  let actionRatings: ActionRatingLike[] = [];
  if (actionIds.length > 0) {
    const { data: ratings, error: ratingsError } = await supabase
      .from('action_ratings')
      .select('action_id, likelihood, impact, score, rated_at')
      .in('action_id', actionIds)
      .order('rated_at', { ascending: false });

    if (ratingsError) throw ratingsError;
    actionRatings = ratings || [];
  }

  const selectedExecutiveSummary = getSelectedExecutiveSummaryText(
    document.executive_summary_mode as string | null | undefined,
    document.executive_summary_ai as string | null | undefined,
    document.executive_summary_author as string | null | undefined
  );
  const executiveSummaryDiagnostics = {
    documentId: document.id,
    requestedMode: document.executive_summary_mode,
    selectedMode: selectedExecutiveSummary.mode,
    selectedTextLength: selectedExecutiveSummary.text.length,
    aiLength: String(document.executive_summary_ai || '').trim().length,
    authorLength: String(document.executive_summary_author || '').trim().length,
    keys: Object.keys(document).filter((key) => key.startsWith('executive_summary')),
  };
  console.info('[Issued PDF] Before PDF build selected executive summary:', executiveSummaryDiagnostics);

  const pdfOptions = {
    document,
    moduleInstances: moduleInstancesWithSourceLinks,
    actions: migratedActions,
    actionRatings,
    organisation: {
      id: organisation.id,
      name: organisation.name,
      branding_logo_path: organisation.branding_logo_path || null,
    },
    renderMode: 'issued' as const,
    ...buildPdfIdentityOptions(organisation as EntitlementOrganisation, user),
  };

  const enabledModules = document.enabled_modules || [document.document_type];
  const isCombinedFraFsd = enabledModules.length > 1 && enabledModules.includes('FRA') && enabledModules.includes('FSD');
  const isCombinedFraDsear = enabledModules.length > 1 && enabledModules.includes('FRA') && enabledModules.includes('DSEAR');

  if (isCombinedFraDsear) {
    return withTimeout(buildFraDsearCombinedPdf(pdfOptions), PDF_GENERATION_TIMEOUT, 'FRA+DSEAR PDF generation timed out after 30 seconds');
  }

  if (isCombinedFraFsd) {
    return withTimeout(buildCombinedPdf(pdfOptions), PDF_GENERATION_TIMEOUT, 'Combined PDF generation timed out after 30 seconds');
  }

  if (document.document_type === 'FSD') {
    return withTimeout(buildFsdPdf(pdfOptions), PDF_GENERATION_TIMEOUT, 'FSD PDF generation timed out after 30 seconds');
  }

  if (document.document_type === 'DSEAR') {
    return withTimeout(buildDsearPdf(pdfOptions), PDF_GENERATION_TIMEOUT, 'DSEAR PDF generation timed out after 30 seconds');
  }

  return withTimeout(buildFraPdf(pdfOptions), PDF_GENERATION_TIMEOUT, 'FRA PDF generation timed out after 30 seconds');
}

export async function storeIssuedPdfWithEdgeFunction(
  document: IssueableDocument,
  organisationId: string,
  pdfBytes: Uint8Array
): Promise<{ signedUrl?: string; pdfPath: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('No access token (user not signed in)');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-issued-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      pdf_payload_summary_keys: Object.keys(document).filter((key) => key.startsWith('executive_summary')),
      document_id: document.id,
      organisation_id: organisationId,
      title: document.title,
      version_number: document.version_number,
      mode: 'pre_issue',
      pdf_base64: uint8ArrayToBase64(pdfBytes),
      size_bytes: pdfBytes.length,
    }),
  });

  console.info('[Issued PDF] generate-issued-pdf payload summary section keys:', {
    documentId: document.id,
    keys: Object.keys(document).filter((key) => key.startsWith('executive_summary')),
    mode: document.executive_summary_mode,
    aiLength: String(document.executive_summary_ai || '').trim().length,
    authorLength: String(document.executive_summary_author || '').trim().length,
  });

  const responseText = await response.text();
  let responseJson: StoreIssuedPdfResponse | null = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = null;
  }

  if (!response.ok) {
    throw new Error(responseJson?.error || responseText || `generate-issued-pdf failed (${response.status})`);
  }

  const pdfPath = responseJson?.pdf_path;
  if (!pdfPath || typeof pdfPath !== 'string') {
    throw new Error('generate-issued-pdf did not return a locked PDF path');
  }

  return {
    signedUrl: typeof responseJson?.signed_url === 'string' ? responseJson.signed_url : undefined,
    pdfPath,
  };
}
