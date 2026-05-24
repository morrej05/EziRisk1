import { supabase } from '../lib/supabase';
import { getModuleDisplayLabel } from '../lib/modules/moduleCatalog';

export interface ActionRegisterEntry {
  id: string;
  organisation_id: string;
  document_id: string;
  document_title: string;
  document_type: string;
  base_document_id: string;
  version_number: number;
  issue_status: string;
  issue_date: string | null;
  module_instance_id: string | null;
  module_key: string | null;
  module_outcome: any;
  recommended_action: string;
  reference_number: string | null;
  priority_band: string;
  timescale: string | null;
  target_date: string | null;
  status: string;
  owner_user_id: string | null;
  owner_name: string | null;
  source: string;
  source_context?: string | null;
  source_links?: Array<{
    id: string;
    module_key?: string | null;
    source_assessment_type: string;
    source_assessment_key: string;
    source_assessment_label?: string | null;
    source_finding_hash?: string | null;
  }> | null;
  created_at: string;
  closed_at: string | null;
  carried_from_document_id: string | null;
  origin_action_id: string | null;
  tracking_status: 'closed' | 'overdue' | 'due_soon' | 'on_track';
  age_days: number;
}

export interface OrgActionStats {
  organisation_id: string;
  total_actions: number;
  open_actions: number;
  closed_actions: number;
  in_progress_actions: number;
  p1_actions: number;
  p2_actions: number;
  p3_actions: number;
  p4_actions: number;
  overdue_actions: number;
  avg_closure_days: number | null;
}

export async function getActionRegisterSiteLevel(
  documentId: string
): Promise<ActionRegisterEntry[]> {
  try {
    const { data, error } = await supabase
      .from('action_register_site_level')
      .select('*')
      .eq('document_id', documentId)
      .order('reference_number', { ascending: true, nullsFirst: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching site-level action register:', error);
    return [];
  }
}

export async function getActionRegisterOrgLevel(
  organisationId: string
): Promise<ActionRegisterEntry[]> {
  try {
    const { data, error } = await supabase
      .from('action_register_site_level')
      .select('*')
      .eq('organisation_id', organisationId)
      .order('reference_number', { ascending: true, nullsFirst: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching org-level action register:', error);
    return [];
  }
}

export async function getOrgActionStats(
  organisationId: string
): Promise<OrgActionStats | null> {
  try {
    const { data, error } = await supabase
      .from('action_register_org_level')
      .select('*')
      .eq('organisation_id', organisationId)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching org action stats:', error);
    return null;
  }
}

export function filterActionRegister(
  actions: ActionRegisterEntry[],
  filters: {
    status?: string[];
    priority?: string[];
    trackingStatus?: string[];
    documentType?: string[];
    moduleKey?: string[];
    overdue?: boolean;
    documentId?: string;
  }
): ActionRegisterEntry[] {
  let filtered = [...actions];

  if (filters.status && filters.status.length > 0) {
    filtered = filtered.filter(a => filters.status!.includes(a.status));
  }

  if (filters.priority && filters.priority.length > 0) {
    filtered = filtered.filter(a => filters.priority!.includes(a.priority_band));
  }

  if (filters.trackingStatus && filters.trackingStatus.length > 0) {
    filtered = filtered.filter(a => filters.trackingStatus!.includes(a.tracking_status));
  }

  if (filters.documentType && filters.documentType.length > 0) {
    filtered = filtered.filter(a => filters.documentType!.includes(a.document_type));
  }

  if (filters.moduleKey && filters.moduleKey.length > 0) {
    filtered = filtered.filter(a => a.module_key && filters.moduleKey!.includes(a.module_key));
  }

  if (filters.overdue) {
    filtered = filtered.filter(a => a.tracking_status === 'overdue');
  }

  if (filters.documentId) {
    filtered = filtered.filter(a => a.document_id === filters.documentId);
  }

  return filtered;
}

export function exportActionRegisterToCSV(actions: ActionRegisterEntry[]): string {
  const headers = [
    'Priority',
    'Status',
    'Recommended Action',
    'Owner',
    'Target Date',
    'Assessment Section',
    'Document Title',
    'Assessment Type',
    'Version Number',
    'Issue Status',
    'Issue Date',
    'Tracking Status',
    'Timescale',
    'Source',
    'Source Context',
    'Age (Days)',
    'Created Date',
    'Closed Date',
  ];

  const rows = actions.map(action => [
    action.priority_band,
    action.status,
    action.recommended_action,
    action.owner_name || 'Unassigned',
    action.target_date || 'Not set',
    getModuleKeyLabel(action.module_key),
    action.document_title,
    action.document_type,
    action.version_number.toString(),
    action.issue_status,
    action.issue_date || 'Not issued',
    action.tracking_status,
    action.timescale || '',
    action.source,
    formatActionSourceContext(action),
    action.age_days.toString(),
    new Date(action.created_at).toLocaleDateString(),
    action.closed_at ? new Date(action.closed_at).toLocaleDateString() : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  return csvContent;
}

export function downloadActionRegisterCSV(actions: ActionRegisterEntry[], filename: string) {
  const csv = exportActionRegisterToCSV(actions);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getActionRegisterStats(actions: ActionRegisterEntry[]) {
  return {
    total: actions.length,
    open: actions.filter(a => a.status === 'open').length,
    closed: actions.filter(a => a.status === 'closed').length,
    inProgress: actions.filter(a => a.status === 'in_progress').length,
    overdue: actions.filter(a => a.tracking_status === 'overdue').length,
    dueSoon: actions.filter(a => a.tracking_status === 'due_soon').length,
    onTrack: actions.filter(a => a.tracking_status === 'on_track').length,
    p1: actions.filter(a => a.priority_band === 'P1').length,
    p2: actions.filter(a => a.priority_band === 'P2').length,
    p3: actions.filter(a => a.priority_band === 'P3').length,
    p4: actions.filter(a => a.priority_band === 'P4').length,
  };
}

export function getTrackingStatusColor(status: string): string {
  switch (status) {
    case 'closed':
      return 'text-green-700 bg-green-100 border-green-300';
    case 'overdue':
      return 'text-red-700 bg-red-100 border-red-300';
    case 'due_soon':
      return 'text-amber-700 bg-amber-100 border-amber-300';
    case 'on_track':
      return 'text-blue-700 bg-blue-100 border-blue-300';
    default:
      return 'text-neutral-700 bg-neutral-100 border-neutral-300';
  }
}

export function getTrackingStatusLabel(status: string): string {
  switch (status) {
    case 'closed':
      return 'Closed';
    case 'overdue':
      return 'Overdue';
    case 'due_soon':
      return 'Due Soon';
    case 'on_track':
      return 'On Track';
    default:
      return status;
  }
}

export function getUniqueModuleKeys(actions: ActionRegisterEntry[]): string[] {
  const keys = actions
    .map(a => a.module_key)
    .filter((key): key is string => key !== null && key !== undefined);
  return Array.from(new Set(keys)).sort();
}

export function getUniqueDocumentTypes(actions: ActionRegisterEntry[]): string[] {
  const types = actions.map(a => a.document_type);
  return Array.from(new Set(types)).sort();
}

export function getModuleKeyLabel(key: string | null | undefined): string {
  return getModuleDisplayLabel(key);
}

function looksLikeTechnicalIdentifier(value: string): boolean {
  return /^[A-Z]{2,}(_[A-Z0-9]+)+$/.test(value.trim()) || /^[0-9a-f-]{32,}$/i.test(value.trim());
}

function containsTechnicalIdentifier(value: string): boolean {
  return looksLikeTechnicalIdentifier(value) || /\b[A-Z]{2,}_[A-Z0-9_]+\b/.test(value) || /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(value);
}

export function formatActionSourceContext(action: Pick<ActionRegisterEntry, 'source_context' | 'source_links'>): string {
  if (action.source_links?.length) {
    return action.source_links
      .map((link) => {
        const moduleLabel = getModuleKeyLabel(link.module_key);
        const sourceLabel = link.source_assessment_label?.trim() || 'Assessment section';
        return `${moduleLabel} — ${containsTechnicalIdentifier(sourceLabel) ? 'Assessment section' : sourceLabel}`;
      })
      .join('; ');
  }

  const sourceContext = action.source_context?.trim();
  if (!sourceContext) return '';

  return containsTechnicalIdentifier(sourceContext) ? 'Linked assessment area' : sourceContext;
}
