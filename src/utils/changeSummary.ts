import { supabase } from '../lib/supabase';
import { stripSimpleMarkdown } from './markdownDisplay';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function getChangeSummaryErrorMessage(error: unknown, fallback: string): string {
  return getErrorMessage(error, fallback);
}

interface SummaryAction {
  id: string;
  recommended_action: string;
  priority_band: string;
  status?: string;
  closure_date?: string;
}

interface ChangeSummaryStatsInput {
  new_actions_count?: number;
  closed_actions_count?: number;
  reopened_actions_count?: number;
  outstanding_actions_count?: number;
  has_material_changes?: boolean;
}

interface ChangeSummaryTextInput extends ChangeSummaryStatsInput {
  new_actions: SummaryAction[];
  closed_actions: SummaryAction[];
}

export interface ChangeSummary {
  id: string;
  organisation_id: string;
  document_id: string;
  previous_document_id: string | null;
  new_actions_count: number;
  closed_actions_count: number;
  reopened_actions_count: number;
  outstanding_actions_count: number;
  new_actions: Array<{
    id: string;
    recommended_action: string;
    priority_band: string;
    status: string;
  }>;
  closed_actions: Array<{
    id: string;
    recommended_action: string;
    priority_band: string;
    closure_date: string;
  }>;
  reopened_actions: JsonValue[];
  risk_rating_changes: JsonValue[];
  material_field_changes: JsonValue[];
  summary_text: string | null;
  has_material_changes: boolean;
  visible_to_client: boolean;
  generated_at: string;
  generated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row returned from the public.change_summaries VIEW
 * (This is what the ChangeSummaryPanel needs.)
 */

export const ISSUED_REVISION_STATUSES = ['issued', 'superseded'] as const;

type IssuedRevisionStatus = (typeof ISSUED_REVISION_STATUSES)[number];

export interface IssuedRevisionLookupRow {
  id: string;
  base_document_id: string;
  version_number: number;
  issue_status: IssuedRevisionStatus;
  status?: string | null;
  issue_date?: string | null;
  created_at?: string | null;
}

export async function findPreviousIssuedRevision(
  current: { id: string; base_document_id: string | null; version_number: number | null },
  context: string = 'findPreviousIssuedRevision'
): Promise<IssuedRevisionLookupRow | null> {
  if (!current.base_document_id || !current.version_number) {
    console.info(`[${context}] Previous issued lookup skipped; fallback Initial issue may be required.`, {
      reason: 'missing_base_document_id_or_version_number',
      currentDocumentId: current.id,
      currentBaseDocumentId: current.base_document_id,
      currentVersion: current.version_number,
    });
    return null;
  }

  console.info(`[${context}] Looking up previous issued revision.`, {
    currentDocumentId: current.id,
    currentBaseDocumentId: current.base_document_id,
    currentVersion: current.version_number,
    rules: 'same base_document_id, exclude current row, issued/superseded only, version_number < current, order version_number desc',
  });

  const { data, error } = await supabase
    .from('documents')
    .select('id, base_document_id, version_number, issue_status, status, issue_date, created_at')
    .eq('base_document_id', current.base_document_id)
    .neq('id', current.id)
    .in('issue_status', [...ISSUED_REVISION_STATUSES])
    .lt('version_number', current.version_number)
    .is('deleted_at', null)
    .not('status', 'in', '(archived,deleted)')
    .order('version_number', { ascending: false })
    .order('issue_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  console.info(`[${context}] Previous issued revision selected.`, {
    currentDocumentId: current.id,
    currentVersion: current.version_number,
    previousDocumentId: data?.id ?? null,
    previousVersion: data?.version_number ?? null,
    previousIssueStatus: data?.issue_status ?? null,
    fallbackInitialIssueReason: data ? null : 'no_prior_issued_or_superseded_revision_in_chain',
  });

  return (data as IssuedRevisionLookupRow | null) ?? null;
}

export interface ChangeSummaryViewRow {
  id: string;
  base_document_id: string;
  version_number: number;
  created_at: string;
  created_by: string | null;
  full_name: string | null;
  summary_text: string | null;
  summary_markdown?: string | null;
  new_actions_count: number;
  closed_actions_count: number;
  outstanding_actions_count: number;
  new_actions: SummaryAction[];
  closed_actions: SummaryAction[];
  has_material_changes: boolean;
  visible_to_client: boolean;
}

/**
 * Create the FIRST issue summary for a document.
 * Any existing summaries for this document are deleted first
 * to prevent duplicates.
 */
export async function createInitialIssueSummary(
  documentId: string,
  userId: string
): Promise<{ success: boolean; summaryId?: string; error?: string }> {
  try {
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, organisation_id, base_document_id, version_number, issue_status, status')
      .eq('id', documentId)
      .single();

    if (docError) throw docError;

    console.info('[createInitialIssueSummary] Current version audit.', {
      currentDocumentId: documentId,
      baseDocumentId: document.base_document_id,
      currentVersion: document.version_number,
      issueStatus: document.issue_status,
      status: document.status,
    });

    const previousIssued = await findPreviousIssuedRevision(
      { id: documentId, base_document_id: document.base_document_id, version_number: document.version_number },
      'createInitialIssueSummary'
    );

    if (previousIssued) {
      console.info('[createInitialIssueSummary] Summary generation mode.', {
        currentDocumentId: documentId,
        currentVersion: document.version_number,
        mode: 'changes_since_last_issue',
        previousDocumentId: previousIssued.id,
        previousVersion: previousIssued.version_number,
      });
      return await generateChangeSummary(documentId, previousIssued.id, userId);
    }

    console.info('[createInitialIssueSummary] Summary generation mode.', {
      currentDocumentId: documentId,
      currentVersion: document.version_number,
      mode: 'initial_issue',
      fallbackInitialIssueReason: 'no_prior_issued_or_superseded_revision_in_chain',
    });

    const { data: actions, error: actionsError } = await supabase
      .from('actions')
      .select('id, recommended_action, priority_band, status')
      .eq('document_id', documentId)
      .is('deleted_at', null);

    if (actionsError) throw actionsError;

    const openActions =
      actions?.filter(a => ['open', 'in_progress', 'deferred'].includes(a.status)) || [];

    const summaryData = {
      organisation_id: document.organisation_id,
      base_document_id: document.base_document_id,
      document_id: documentId,
      previous_document_id: null,
      version_number: document.version_number,
      new_actions_count: openActions.length,
      closed_actions_count: 0,
      reopened_actions_count: 0,
      outstanding_actions_count: openActions.length,
      new_actions: openActions.map(a => ({
        id: a.id,
        recommended_action: a.recommended_action,
        priority_band: a.priority_band,
        status: a.status,
      })),
      closed_actions: [],
      reopened_actions: [],
      risk_rating_changes: [],
      material_field_changes: [],
      summary_text: 'Initial issue',
      has_material_changes: false,
      visible_to_client: true,
      generated_by: userId,
    };

    // 🔥 IMPORTANT: remove any existing summaries for this document
    const { error: deleteError } = await supabase
      .from('document_change_summaries')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      console.warn('[createInitialIssueSummary] Existing summary cleanup failed (continuing to insert):', {
        table: 'document_change_summaries',
        documentId,
        error: deleteError,
      });
    }

    console.log('[createInitialIssueSummary] Inserting issue summary:', {
      table: 'document_change_summaries',
      payload: summaryData,
    });

    const { data: summary, error: insertError } = await supabase
      .from('document_change_summaries')
      .insert([summaryData])
      .select('id')
      .single();

    if (insertError) {
      const isMissingRestTable = insertError.code === 'PGRST205' || insertError.code === 'PGRST204' || insertError.message?.includes('404');
      console.warn('[createInitialIssueSummary] Insert failed; issue summary is informational, continuing without blocking issue/version creation:', {
        table: 'document_change_summaries',
        expectedTable: 'public.document_change_summaries',
        productionRepairMigration: '20260509120000_repair_document_change_summaries.sql',
        likelyMissingFromRestSchema: isMissingRestTable,
        payload: summaryData,
        error: insertError,
      });
      return { success: false, error: getErrorMessage(insertError, 'Failed to create initial issue summary') };
    }

    return { success: true, summaryId: summary?.id };
  } catch (error: unknown) {
    console.warn('Error creating initial issue summary (non-blocking):', error);
    return { success: false, error: getErrorMessage(error, 'Failed to create initial issue summary') };
  }
}

/**
 * Generate a change summary between two issued versions
 * (uses Postgres RPC)
 */
export async function generateChangeSummary(
  newDocumentId: string,
  oldDocumentId: string,
  userId: string
): Promise<{ success: boolean; summaryId?: string; error?: string }> {
  try {
    // Defensive cleanup in case this gets called twice
    await supabase.from('document_change_summaries').delete().eq('document_id', newDocumentId);

    const { data, error } = await supabase.rpc('generate_change_summary', {
      p_new_document_id: newDocumentId,
      p_old_document_id: oldDocumentId,
      p_user_id: userId,
    });

    if (error) throw error;

    return { success: true, summaryId: data };
  } catch (error: unknown) {
    console.error('Error generating change summary:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to generate change summary') };
  }
}

/**
 * Get the most recent change summary for a document (by documentId).
 *
 * NOTE: ChangeSummaryPanel passes the current *document id*,
 * but the table is keyed by base_document_id. So we resolve base_document_id first.
 */
export async function getChangeSummary(documentId: string): Promise<ChangeSummaryViewRow | null> {
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('base_document_id, version_number')
      .eq('id', documentId)
      .maybeSingle();

    if (docErr) {
      console.error('[getChangeSummary] Error fetching document:', docErr);
      throw docErr;
    }
    if (!doc?.base_document_id) return null;

    const { data, error } = await supabase
      .from('document_change_summaries')
      .select(`
        id,
        base_document_id,
        document_id,
        version_number,
        created_at,
        generated_by,
        summary_text,
        summary_markdown,
        new_actions_count,
        closed_actions_count,
        outstanding_actions_count,
        new_actions,
        closed_actions,
        has_material_changes,
        visible_to_client
      `)
      .eq('base_document_id', doc.base_document_id)
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[getChangeSummary] Error fetching change summary:', {
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      throw error;
    }

    if (!data) return null;

    let authorName: string | null = null;

    if (data.generated_by) {
      const { data: profile, error: profErr } = await supabase
        .from('user_profiles')
        .select('name')
        .eq('id', data.generated_by)
        .maybeSingle();

      if (profErr) {
        console.warn('[getChangeSummary] Could not load change summary author name (non-critical):', profErr);
      } else {
        authorName = profile?.name ?? null;
      }
    }

    return {
      id: data.id,
      base_document_id: data.base_document_id,
      version_number: doc.version_number,
      created_at: data.created_at,
      created_by: data.generated_by,
      full_name: authorName,
      summary_text: data.summary_text,
      summary_markdown: data.summary_markdown,
      new_actions_count: data.new_actions_count || 0,
      closed_actions_count: data.closed_actions_count || 0,
      outstanding_actions_count: data.outstanding_actions_count || 0,
      new_actions: data.new_actions || [],
      closed_actions: data.closed_actions || [],
      has_material_changes: data.has_material_changes || false,
      visible_to_client: data.visible_to_client || false,
    };
  } catch (error: unknown) {
    console.error('[getChangeSummary] Unhandled error:', error);
    return null;
  }
}

/**
 * Get all change summaries for an organisation (raw table)
 */
export async function getChangeSummaries(organisationId: string): Promise<ChangeSummary[]> {
  try {
    const { data, error } = await supabase
      .from('document_change_summaries')
      .select('*')
      .eq('organisation_id', organisationId)
      .order('generated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching change summaries:', error);
    return [];
  }
}

/**
 * Format a change summary as markdown text
 */
export function formatChangeSummaryText(summary: ChangeSummaryTextInput): string {
  const lines: string[] = [];

  lines.push('# Changes Since Last Issue\n');

  if (summary.new_actions_count > 0) {
    lines.push(`## New Actions (${summary.new_actions_count})\n`);
    summary.new_actions.forEach((action) => {
      lines.push(`- [${action.priority_band}] ${action.recommended_action}`);
    });
    lines.push('');
  }

  if (summary.closed_actions_count > 0) {
    lines.push(`## Closed Actions (${summary.closed_actions_count})\n`);
    summary.closed_actions.forEach((action) => {
      lines.push(`- [${action.priority_band}] ${action.recommended_action}`);
    });
    lines.push('');
  }

  if (summary.outstanding_actions_count > 0) {
    lines.push(`## Outstanding Recommendations: ${summary.outstanding_actions_count}\n`);
  }

  if (!summary.has_material_changes) {
    lines.push('_No material changes since last issue._\n');
  }

  return lines.join('\n');
}

export function formatChangeSummaryPlainText(summaryText: string | null | undefined): string {
  return stripSimpleMarkdown(summaryText);
}

export function getChangeSummaryStats(summary: ChangeSummaryStatsInput) {
  return {
    totalChanges:
      (summary.new_actions_count || 0) +
      (summary.closed_actions_count || 0) +
      (summary.reopened_actions_count || 0),
    newActions: summary.new_actions_count || 0,
    closedActions: summary.closed_actions_count || 0,
    outstandingActions: summary.outstanding_actions_count || 0,
    hasMaterialChanges: summary.has_material_changes || false,
    improvement: (summary.closed_actions_count || 0) > (summary.new_actions_count || 0),
    deterioration: (summary.new_actions_count || 0) > (summary.closed_actions_count || 0),
  };
}

export async function updateChangeSummaryText(
  summaryId: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('document_change_summaries')
      .update({
        summary_text: text,
        updated_at: new Date().toISOString(),
      })
      .eq('id', summaryId);

    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('Error updating change summary text:', error);
    return { success: false, error: error.message };
  }
}

export async function setChangeSummaryClientVisibility(
  summaryId: string,
  visible: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('document_change_summaries')
      .update({
        visible_to_client: visible,
        updated_at: new Date().toISOString(),
      })
      .eq('id', summaryId);

    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('Error updating change summary visibility:', error);
    return { success: false, error: error.message };
  }
}
