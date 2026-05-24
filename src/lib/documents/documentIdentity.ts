import { supabase } from '../supabase';

export interface DocumentIdentityMeta {
  client?: {
    id?: string | null;
    name?: string | null;
  } | null;
  site?: {
    id?: string | null;
    name?: string | null;
    address?: Record<string, unknown> | string | null;
    contact?: Record<string, unknown> | null;
  } | null;
}

export interface DocumentIdentitySource {
  id?: string | null;
  site_id?: string | null;
  building_id?: string | null;
  title?: string | null;
  responsible_person?: string | null;
  scope_description?: string | null;
  meta?: DocumentIdentityMeta & Record<string, unknown> | null;
}

export interface ModuleIdentitySource {
  module_key?: string | null;
  site_id?: string | null;
  building_id?: string | null;
  data?: Record<string, unknown> | null;
}

export interface ResolvedDocumentIdentity {
  clientId: string | null;
  clientName: string | null;
  siteId: string | null;
  siteName: string | null;
  siteAddress?: Record<string, unknown> | string | null;
  siteContact?: Record<string, unknown> | null;
  buildingId: string | null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstCleanString(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function firstDefined<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function resolveModuleIdentity(modules: ModuleIdentitySource[] = []): Partial<ResolvedDocumentIdentity> {
  let clientName: string | null = null;
  let siteName: string | null = null;
  let siteAddress: Record<string, unknown> | string | null | undefined;
  let siteContact: Record<string, unknown> | null | undefined;
  let siteId: string | null = null;
  let buildingId: string | null = null;

  const preferredModules = [...modules].sort((a, b) => {
    const order = ['A1_DOC_CONTROL', 'RE_01_DOC_CONTROL', 'RISK_ENGINEERING'];
    const aIndex = order.indexOf(a.module_key || '');
    const bIndex = order.indexOf(b.module_key || '');
    return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex);
  });

  for (const module of preferredModules) {
    const data = module.data || {};
    const nestedClient = data.client && typeof data.client === 'object' ? data.client as Record<string, unknown> : {};
    const nestedSite = data.site && typeof data.site === 'object' ? data.site as Record<string, unknown> : {};
    const clientSite = data.client_site && typeof data.client_site === 'object' ? data.client_site as Record<string, unknown> : {};

    clientName = clientName || firstCleanString(
      nestedClient.name,
      clientSite.client,
      data.clientName,
      data.client_name
    );

    siteName = siteName || firstCleanString(
      nestedSite.name,
      clientSite.site,
      data.siteName,
      data.site_name
    );

    siteAddress = firstDefined(
      siteAddress,
      nestedSite.address as Record<string, unknown> | string | null | undefined,
      clientSite.address as Record<string, unknown> | string | null | undefined,
      data.site_address as Record<string, unknown> | string | null | undefined
    );

    siteContact = firstDefined(siteContact, nestedSite.contact, Array.isArray(data.site_contacts) ? data.site_contacts[0] : null);
    siteId = siteId || cleanString(module.site_id);
    buildingId = buildingId || cleanString(module.building_id);

    if (clientName && siteName && siteAddress && siteContact && siteId && buildingId) break;
  }

  return { clientName, siteName, siteAddress, siteContact, siteId, buildingId };
}

export function resolveDocumentIdentity(
  document: DocumentIdentitySource,
  modules: ModuleIdentitySource[] = []
): ResolvedDocumentIdentity {
  const meta = document.meta || {};
  const metaClient = meta.client && typeof meta.client === 'object' ? meta.client as Record<string, unknown> : {};
  const metaSite = meta.site && typeof meta.site === 'object' ? meta.site as Record<string, unknown> : {};
  const moduleIdentity = resolveModuleIdentity(modules);

  const clientId = firstCleanString(metaClient.id, meta.client_id);
  const clientName = firstCleanString(
    metaClient.name,
    meta.clientName,
    meta.client_name,
    moduleIdentity.clientName,
    document.responsible_person
  );

  const siteId = firstCleanString(metaSite.id, meta.site_id, document.site_id, moduleIdentity.siteId);
  const siteName = firstCleanString(
    metaSite.name,
    meta.siteName,
    meta.site_name,
    moduleIdentity.siteName,
    document.scope_description,
    document.title
  );

  return {
    clientId,
    clientName,
    siteId,
    siteName,
    siteAddress: firstDefined(metaSite.address as Record<string, unknown> | string | null | undefined, moduleIdentity.siteAddress),
    siteContact: firstDefined(metaSite.contact as Record<string, unknown> | null | undefined, moduleIdentity.siteContact),
    buildingId: firstCleanString(document.building_id, moduleIdentity.buildingId),
  };
}

export function mergeIdentityIntoMeta(
  currentMeta: Record<string, unknown> | null | undefined,
  identity: ResolvedDocumentIdentity
): Record<string, unknown> {
  const existing = currentMeta || {};
  const existingClient = (existing.client && typeof existing.client === 'object') ? existing.client as Record<string, unknown> : {};
  const existingSite = (existing.site && typeof existing.site === 'object') ? existing.site as Record<string, unknown> : {};

  return {
    ...existing,
    client: {
      ...existingClient,
      ...(identity.clientId ? { id: identity.clientId } : {}),
      ...(identity.clientName ? { name: identity.clientName } : {}),
    },
    site: {
      ...existingSite,
      ...(identity.siteId ? { id: identity.siteId } : {}),
      ...(identity.siteName ? { name: identity.siteName } : {}),
      ...(identity.siteAddress ? { address: identity.siteAddress } : {}),
      ...(identity.siteContact ? { contact: identity.siteContact } : {}),
    },
  };
}

export async function ensureDocumentIdentitySnapshot(documentId: string, organisationId: string) {
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id, organisation_id, title, site_id, building_id, responsible_person, scope_description, meta')
    .eq('id', documentId)
    .eq('organisation_id', organisationId)
    .maybeSingle();

  if (documentError) throw documentError;
  if (!document) throw new Error('Document not found');

  const { data: modules, error: modulesError } = await supabase
    .from('module_instances')
    .select('module_key, site_id, building_id, data')
    .eq('document_id', documentId)
    .eq('organisation_id', organisationId);

  if (modulesError) throw modulesError;

  const identity = resolveDocumentIdentity(document, modules || []);
  const mergedMeta = mergeIdentityIntoMeta(document.meta as Record<string, unknown> | null, identity);

  const updates: Record<string, unknown> = {
    meta: mergedMeta,
  };

  if (!document.site_id && identity.siteId) updates.site_id = identity.siteId;
  if (!document.building_id && identity.buildingId) updates.building_id = identity.buildingId;

  const { data: updatedDocument, error: updateError } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', documentId)
    .eq('organisation_id', organisationId)
    .select('*')
    .single();

  if (updateError) throw updateError;

  return {
    document: updatedDocument,
    identity,
  };
}
