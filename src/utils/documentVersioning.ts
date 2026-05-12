import { supabase } from '../lib/supabase';
import { canIssueDocument } from './approvalWorkflow';
import { generateChangeSummary, createInitialIssueSummary, findPreviousIssuedRevision, ISSUED_REVISION_STATUSES } from './changeSummary';
import { carryForwardEvidence } from './evidenceManagement';
import { getMissingRequiredRatings } from '../lib/re/scoring/riskEngineeringHelpers';
import { ensureDocumentIdentitySnapshot, mergeIdentityIntoMeta, resolveDocumentIdentity } from '../lib/documents/documentIdentity';


function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function logExecutiveSummarySnapshot(
  label: string,
  document: ({
    id?: string | null;
    version_number?: number | null;
    executive_summary_ai?: string | null;
    executive_summary_author?: string | null;
    executive_summary_mode?: string | null;
  }) | null | undefined
) {
  console.info(label, {
    documentId: document?.id ?? null,
    version: document?.version_number ?? null,
    executiveSummaryMode: document?.executive_summary_mode ?? null,
    aiLength: String(document?.executive_summary_ai || '').trim().length,
    authorLength: String(document?.executive_summary_author || '').trim().length,
  });
}

export type DocumentIssueStatus =
  | 'draft'
  | 'in_progress_draft'
  | 'pending_review_draft'
  | 'issued'
  | 'superseded'
  | 'archived'
  | 'deleted';

export const ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES = [
  'draft',
] as const;

const INACTIVE_DOCUMENT_LIFECYCLE_STATUSES = [
  'archived',
  'deleted',
] as const;

const ACTIVE_DRAFT_LIFECYCLE_STATUS_OR_FILTER = `status.is.null,status.not.in.(${INACTIVE_DOCUMENT_LIFECYCLE_STATUSES.join(',')})`;

export function isActiveEditableDraftVersion(document: {
  issue_status?: string | null;
  status?: string | null;
  deleted_at?: string | null;
}): boolean {
  const issueStatus = (document.issue_status || '').trim().toLowerCase();
  const lifecycleStatus = (document.status || '').trim().toLowerCase();

  return (
    !document.deleted_at &&
    ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES.includes(issueStatus as (typeof ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES)[number]) &&
    !INACTIVE_DOCUMENT_LIFECYCLE_STATUSES.includes(lifecycleStatus as (typeof INACTIVE_DOCUMENT_LIFECYCLE_STATUSES)[number])
  );
}

export interface DocumentVersion {
  id: string;
  base_document_id: string;
  version_number: number;
  issue_status: DocumentIssueStatus;
  issue_date: string | null;
  issued_by: string | null;
  superseded_by_document_id: string | null;
  superseded_date: string | null;
  title: string;
  document_type: string;
  created_at: string;
}

export interface IssueDocumentResult {
  success: boolean;
  error?: string;
  warning?: string;
  postIssueWarning?: string;
  documentId?: string;
  alreadyIssued?: boolean;
  partialSuccess?: boolean;
}

export interface CreateNewVersionResult {
  success: boolean;
  error?: string;
  newDocumentId?: string;
  newVersionNumber?: number;
  existingDraftDocumentId?: string;
}

const EXISTING_DRAFT_VERSION_MESSAGE =
  'A draft version already exists and must be issued or deleted before creating another version.';

type ModuleValidationRow = {
  module_key: string;
  data: Record<string, unknown> | null;
  assessor_notes: string | null;
  completed_at: string | null;
};

type DocumentSectionGrades = {
  section_grades?: Record<string, unknown> | null;
};

type MaybeErrorWithMessage = {
  message?: string;
};

type JsonRecord = Record<string, unknown>;
type AnyRow = Record<string, unknown>;
type ExecutiveSummarySnapshot = {
  executive_summary_ai: string | null;
  executive_summary_author: string | null;
  executive_summary_mode: string | null;
};
type CountQueryResult = { count: number | null; error: { message?: string } | null };
type CountQuery = PromiseLike<CountQueryResult> & {
  eq?: (column: string, value: unknown) => CountQuery;
  in?: (column: string, values: readonly unknown[]) => CountQuery;
  is?: (column: string, value: unknown) => CountQuery;
  or?: (filters: string) => CountQuery;
};
type CountTableQuery = {
  select?: (columns: string, options: { count: 'exact'; head: true }) => CountQuery;
};

const LOCKED_ISSUE_DOCUMENT_FIELDS = new Set([
  'issue_status',
  'issue_date',
  'issued_by',
  'issued_author_name_snapshot',
  'issued_author_role_snapshot',
  'issued_display_author_name',
  'issued_display_author_role',
  'issued_display_author_organisation',
  'locked_pdf_path',
  'locked_pdf_checksum',
  'locked_pdf_generated_at',
  'locked_pdf_size_bytes',
  'pdf_generation_error',
]);

const DOCUMENT_INSERT_EXCLUDE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'deleted_by',
  'superseded_by_document_id',
  'superseded_date',
  'is_immutable',
  'client_visible',
  'draft_pdf_path',
  'draft_re_survey_pdf_path',
  'draft_re_lp_pdf_path',
  ...LOCKED_ISSUE_DOCUMENT_FIELDS,
]);

const ROW_INSERT_EXCLUDE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'deleted_by',
]);


const DRAFT_APPROVAL_RESET_FIELDS = {
  approval_status: 'not_required',
  approved_by: null,
  approval_date: null,
  approval_notes: null,
} as const;

const MODULE_APPROVAL_STATUS_KEYS = new Set(['approval_status', 'approvalStatus']);
const MODULE_APPROVAL_METADATA_KEYS = new Set([
  'approved_at',
  'approvedAt',
  'approved_by',
  'approvedBy',
  'approval_date',
  'approvalDate',
  'approval_notes',
  'approvalNotes',
  'reviewer',
  'reviewer_name',
  'reviewerName',
  'reviewer_email',
  'reviewerEmail',
  'reviewed_by',
  'reviewedBy',
  'reviewed_at',
  'reviewedAt',
  'approver',
  'approver_name',
  'approverName',
  'approver_email',
  'approverEmail',
  'approvedByName',
]);

function resetModuleApprovalMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, nestedValue]) => {
      if (MODULE_APPROVAL_STATUS_KEYS.has(key)) return [key, 'draft'];
      if (MODULE_APPROVAL_METADATA_KEYS.has(key)) return [key, null];
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        return [key, resetModuleApprovalMetadata(nestedValue)];
      }
      return [key, nestedValue];
    })
  );
}

const CARRY_FORWARD_ACTION_STATUSES = ['open', 'in_progress', 'deferred'];
const CARRY_FORWARD_RECOMMENDATION_STATUSES = ['Open', 'In Progress'];

function cloneRowForInsert<T extends AnyRow>(row: T, excludedFields: Set<string>): AnyRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined).filter(([key]) => !excludedFields.has(key))
  );
}

function countMetaKeys(meta: unknown): number {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? Object.keys(meta).length : 0;
}

function hasExecutiveSummary(row: AnyRow | null | undefined): boolean {
  if (!row) return false;
  const mode = row.executive_summary_mode || 'ai';
  if (mode === 'none') return false;
  return Boolean(
    ((mode === 'ai' || mode === 'both') && String(row.executive_summary_ai || '').trim()) ||
    ((mode === 'author' || mode === 'both') && String(row.executive_summary_author || '').trim())
  );
}

function countPhotoReferences(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    return /\.(png|jpe?g|webp|heic)(\?|$)/i.test(value) || /storage_path|file_path|photo|image/i.test(value) ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countPhotoReferences(item), 0);
  }
  if (typeof value === 'object') {
    return Object.entries(value as JsonRecord).reduce((total, [key, item]) => {
      const keyHint = /photo|image|evidence|attachment|storage_path|file_path/i.test(key) ? 1 : 0;
      if (typeof item === 'string' && keyHint && item.trim()) return total + 1;
      return total + countPhotoReferences(item);
    }, 0);
  }
  return 0;
}

function countModulePhotoReferences(modules: AnyRow[] | null | undefined): number {
  return (modules || []).reduce((total, module) => total + countPhotoReferences(module.data), 0);
}

async function countRows(table: string, documentId: string, extra?: (query: CountQuery) => CountQuery | undefined): Promise<number | null> {
  try {
    const tableQuery = supabase.from(table) as unknown as CountTableQuery;
    if (!tableQuery?.select) {
      console.warn('[createNewVersion carry-forward audit] Count query unavailable:', { table, documentId });
      return null;
    }

    let query = tableQuery.select('*', { count: 'exact', head: true });
    if (!query?.eq) {
      console.warn('[createNewVersion carry-forward audit] Count query missing eq filter:', { table, documentId });
      return null;
    }

    query = query.eq('document_id', documentId);
    if (extra) {
      const filteredQuery = extra(query);
      if (!filteredQuery) {
        console.warn('[createNewVersion carry-forward audit] Count query filter returned no query:', { table, documentId });
        return null;
      }
      query = filteredQuery;
    }

    const result = await query;
    if (!result) {
      console.warn('[createNewVersion carry-forward audit] Count query returned no result:', { table, documentId });
      return null;
    }

    const { count, error } = result;
    if (error) {
      console.warn('[createNewVersion carry-forward audit] Count query failed:', { table, documentId, error });
      return null;
    }
    return count || 0;
  } catch (countError) {
    console.warn('[createNewVersion carry-forward audit] Count query threw (continuing):', { table, documentId, error: countError });
    return null;
  }
}

async function logCreateNewVersionCarryForwardAudit(params: {
  sourceDocument: AnyRow;
  newDocument: AnyRow;
  sourceModules: AnyRow[];
  newModules: AnyRow[];
}): Promise<void> {
  const { sourceDocument, newDocument, sourceModules, newModules } = params;
  try {
    const [sourceActionCount, newActionCount, sourceAttachmentCount, newAttachmentCount, sourceRecommendationCount, newRecommendationCount] = await Promise.all([
      countRows('actions', String(sourceDocument.id), (q) => {
        const byStatus = q.in?.('status', CARRY_FORWARD_ACTION_STATUSES);
        return byStatus?.is?.('deleted_at', null);
      }),
      countRows('actions', String(newDocument.id), (q) => {
        const byStatus = q.in?.('status', CARRY_FORWARD_ACTION_STATUSES);
        return byStatus?.is?.('deleted_at', null);
      }),
      countRows('attachments', String(sourceDocument.id), (q) => q.is?.('deleted_at', null)),
      countRows('attachments', String(newDocument.id), (q) => q.is?.('deleted_at', null)),
      countRows('re_recommendations', String(sourceDocument.id), (q) => {
        const byStatus = q.in?.('status', CARRY_FORWARD_RECOMMENDATION_STATUSES);
        return byStatus?.or?.('is_suppressed.is.false,is_suppressed.is.null');
      }),
      countRows('re_recommendations', String(newDocument.id), (q) => {
        const byStatus = q.in?.('status', CARRY_FORWARD_RECOMMENDATION_STATUSES);
        return byStatus?.or?.('is_suppressed.is.false,is_suppressed.is.null');
      }),
    ]);

    console.info('[createNewVersion carry-forward audit]', {
      sourceDocumentId: sourceDocument.id,
      newDocumentId: newDocument.id,
      moduleInstances: { source: sourceModules.length, new: newModules.length },
      actions: { sourceCarriedEligible: sourceActionCount, newCarried: newActionCount },
      recommendations: { sourceCarriedEligible: sourceRecommendationCount, newCarried: newRecommendationCount },
      evidenceAttachments: { source: sourceAttachmentCount, new: newAttachmentCount },
      executiveSummaryPresent: { source: hasExecutiveSummary(sourceDocument), new: hasExecutiveSummary(newDocument) },
      imagePhotoReferences: { source: countModulePhotoReferences(sourceModules), new: countModulePhotoReferences(newModules) },
      metaKeys: { source: countMetaKeys(sourceDocument.meta), new: countMetaKeys(newDocument.meta) },
      lockedIssueFieldsCleared: Array.from(LOCKED_ISSUE_DOCUMENT_FIELDS).every((field) => !newDocument[field]),
      approvalGovernanceReset: Object.entries(DRAFT_APPROVAL_RESET_FIELDS).every(
        ([field, expectedValue]) => newDocument[field] === expectedValue
      ),
      approvalFieldsReset: Object.keys(DRAFT_APPROVAL_RESET_FIELDS),
    });
  } catch (auditError) {
    console.warn('[createNewVersion carry-forward audit] Failed to collect diagnostic counts:', auditError);
  }
}

function isDuplicateDraftVersionError(error: unknown): boolean {
  const maybeError = error as { code?: string; message?: string; details?: string };
  const message = String(maybeError.message || maybeError.details || '').toLowerCase();
  return (
    maybeError.code === '23505' ||
    maybeError.code === 'P0001' ||
    message.includes('one active draft version') ||
    message.includes('draft version already exists') ||
    message.includes('idx_documents_one_active_draft_per_base') ||
    message.includes('idx_documents_one_draft_per_base')
  );
}

export async function validateDocumentForIssue(
  documentId: string,
  organisationId: string
): Promise<{ valid: boolean; errors: string[]; warnings?: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1) Document exists + accessible
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, organisation_id, issue_status, document_type, approval_status, section_grades')
      .eq('id', documentId)
      .eq('organisation_id', organisationId)
      .maybeSingle();

    if (docError) {
      return { valid: false, errors: [`DOC QUERY ERROR: ${docError.message}`] };
    }
    if (!document) {
      return { valid: false, errors: ['DOC NOT FOUND (or blocked by RLS)'] };
    }

    if (document.issue_status !== 'draft') {
      return { valid: false, errors: ['Only draft documents can be issued'] };
    }

    // 2) Approval check (if your workflow enforces it)
    const approvalCheck = await canIssueDocument(documentId, organisationId);
    if (!approvalCheck.canIssue) {
      errors.push(approvalCheck.reason || 'Approval check failed');
    }

    // 3) Modules exist + have data
    const { data: modules, error: moduleError } = await supabase
      .from('module_instances')
      .select('module_key, data, assessor_notes, completed_at')
      .eq('document_id', documentId)
      .eq('organisation_id', organisationId);

    if (moduleError) {
      return { valid: false, errors: [`MODULES QUERY ERROR: ${moduleError.message}`] };
    }

    if (!modules || modules.length === 0) {
      errors.push('Document must have at least one module');
    } else {
      // Define required modules for FRA (minimum for professional completeness)
      const REQUIRED_FRA_MODULES = [
        'A1_DOC_CONTROL',
        'A2_BUILDING_PROFILE',
        'A3_PERSONS_AT_RISK',
        'FRA_7_EMERGENCY_ARRANGEMENTS',
        'FRA_3_ACTIVE_SYSTEMS',
        'FRA_4_PASSIVE_PROTECTION',
        'FRA_8_FIREFIGHTING_EQUIPMENT',
        'FRA_90_SIGNIFICANT_FINDINGS'
      ];

      const isEmptyObject = (v: unknown) =>
        !v || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

      const moduleHasData = (m: ModuleValidationRow) => {
        const hasJson = !isEmptyObject(m.data);
        const hasNotes =
          typeof m.assessor_notes === 'string' &&
          m.assessor_notes.trim().length > 0;
        const isCompleted = !!m.completed_at;

        return hasJson || hasNotes || isCompleted;
      };

      // For FRA documents, only require the minimum set
      if (document.document_type === 'FRA') {
        const requiredModuleKeys = new Set(REQUIRED_FRA_MODULES);
        const modulesMap = new Map(modules.map(m => [m.module_key, m]));
        const hasLegacyProtectionModule = modulesMap.has('FRA_3_PROTECTION_ASIS');

        // Check required modules
        for (const requiredKey of requiredModuleKeys) {
          if (
            hasLegacyProtectionModule &&
            ['FRA_3_ACTIVE_SYSTEMS', 'FRA_4_PASSIVE_PROTECTION', 'FRA_8_FIREFIGHTING_EQUIPMENT'].includes(requiredKey)
          ) {
            continue;
          }
          const module = modulesMap.get(requiredKey);
          if (!module) {
            errors.push(`Required module ${requiredKey} is missing`);
          } else if (!moduleHasData(module)) {
            errors.push(`Required module ${requiredKey} has no data`);
          }
        }

        if (hasLegacyProtectionModule) {
          const legacyProtectionModule = modulesMap.get('FRA_3_PROTECTION_ASIS');
          if (legacyProtectionModule && !moduleHasData(legacyProtectionModule)) {
            errors.push('Required module FRA_3_PROTECTION_ASIS has no data');
          }
        }

        // Check optional modules - add warnings but don't block
        for (const m of modules) {
          if (!requiredModuleKeys.has(m.module_key) && !moduleHasData(m)) {
            warnings.push(`Optional module ${m.module_key} has no data`);
          }
        }
      } else if (document.document_type === 'RE') {
        const riskEngineeringModule = modules.find((m) => m.module_key === 'RISK_ENGINEERING');
        if (!riskEngineeringModule) {
          errors.push('Required module RISK_ENGINEERING is missing');
        } else {
          const missing = getMissingRequiredRatings(
            riskEngineeringModule.data || {},
            (document as DocumentSectionGrades).section_grades || {}
          );

          if (missing.hasMissing) {
            const details: string[] = [];
            if (missing.missingGlobalPillars.length > 0) {
              details.push(`global pillars: ${missing.missingGlobalPillars.join(', ')}`);
            }
            if (missing.missingOccupancyDrivers.length > 0) {
              details.push(`occupancy drivers: ${missing.missingOccupancyDrivers.join(', ')}`);
            }

            errors.push(
              `Required module RISK_ENGINEERING has unrated required factors (${details.join(' | ')})`
            );
          }
        }

        // Keep existing RE module data completeness behavior intact
        for (const m of modules) {
          if (!moduleHasData(m)) {
            errors.push(`Module ${m.module_key} has no data`);
          }
        }
      } else {
        // For non-FRA documents (FSD, DSEAR), check all modules
        for (const m of modules) {
          if (!moduleHasData(m)) {
            errors.push(`Module ${m.module_key} has no data`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (e: unknown) {
    const maybeError = e as MaybeErrorWithMessage;
    const msg =
      maybeError.message ||
      (typeof e === 'string' ? e : 'Unknown error');
    console.error('Error validating document:', e);
    return { valid: false, errors: [`VALIDATION THREW: ${msg}`] };
  }
}


export async function issueDocument(documentId: string, userId: string, organisationId: string): Promise<IssueDocumentResult> {
  try {
    const validation = await validateDocumentForIssue(documentId, organisationId);
    if (!validation.valid) {
      const { data: currentDocument } = await supabase
        .from('documents')
        .select('id, status, issue_status, locked_pdf_path, pdf_generation_error')
        .eq('id', documentId)
        .eq('organisation_id', organisationId)
        .maybeSingle();

      if (currentDocument?.status === 'issued' || currentDocument?.issue_status === 'issued') {
        if (!currentDocument.locked_pdf_path) {
          return { success: false, error: 'Document is issued but has no locked PDF. Contact support before continuing.' };
        }

        return {
          success: true,
          documentId,
          alreadyIssued: true,
          partialSuccess: false,
          warning: 'Document was already issued. Reloaded the issued document state.',
          postIssueWarning: currentDocument.pdf_generation_error || undefined,
        };
      }

      return { success: false, error: validation.errors.join(', ') };
    }

    await ensureDocumentIdentitySnapshot(documentId, organisationId);

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, base_document_id, version_number, locked_pdf_path, executive_summary_ai, executive_summary_author, executive_summary_mode')
      .eq('id', documentId)
      .eq('organisation_id', organisationId)
      .single();

    if (docError) throw docError;

    logExecutiveSummarySnapshot('[issueDocument] Before issue executive summary snapshot:', document);

    if (!document.locked_pdf_path) {
      return {
        success: false,
        error: 'Cannot issue document until the locked issued PDF has been generated and stored.',
      };
    }

    console.info('[issueDocument] Current version audit.', {
      currentDocumentId: documentId,
      baseDocumentId: document.base_document_id,
      currentVersion: document.version_number,
    });

    const previousIssued = await findPreviousIssuedRevision(
      { id: documentId, base_document_id: document.base_document_id, version_number: document.version_number },
      'issueDocument'
    );

    const { data: previousIssuedVersions, error: prevErr } = await supabase
      .from('documents')
      .select('id, version_number, issue_status')
      .eq('base_document_id', document.base_document_id)
      .in('issue_status', [...ISSUED_REVISION_STATUSES])
      .neq('id', documentId)
      .lt('version_number', document.version_number || 0)
      .is('deleted_at', null)
      .not('status', 'in', '(archived,deleted)')
      .order('version_number', { ascending: false });

    if (prevErr) throw prevErr;

    // Supersede every previously issued document in the chain before issuing the new latest version.
    if (previousIssuedVersions && previousIssuedVersions.length > 0) {
      const { error: supersedePrevError } = await supabase
        .from('documents')
        .update({
          issue_status: 'superseded',
          status: 'superseded',
          superseded_by_document_id: documentId,
          superseded_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('base_document_id', document.base_document_id)
        .eq('issue_status', 'issued')
        .neq('id', documentId)
        .lt('version_number', document.version_number || 0);

      if (supersedePrevError) throw supersedePrevError;
    }

    const { error } = await supabase
      .from('documents')
      .update({
        issue_status: 'issued',
        status: 'issued',
        issue_date: new Date().toISOString().split('T')[0],
        issued_by: userId,
        issued_author_name_snapshot: null,
        issued_author_role_snapshot: null,
        issued_display_author_name: null,
        issued_display_author_role: null,
        issued_display_author_organisation: null,
        executive_summary_ai: (document as ExecutiveSummarySnapshot).executive_summary_ai,
        executive_summary_author: (document as ExecutiveSummarySnapshot).executive_summary_author,
        executive_summary_mode: (document as ExecutiveSummarySnapshot).executive_summary_mode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .eq('organisation_id', organisationId);

    if (error) throw error;

    const { data: issuedDocument, error: issuedReloadError } = await supabase
      .from('documents')
      .select('id, version_number, executive_summary_ai, executive_summary_author, executive_summary_mode')
      .eq('id', documentId)
      .eq('organisation_id', organisationId)
      .single();

    if (issuedReloadError) throw issuedReloadError;

    logExecutiveSummarySnapshot('[issueDocument] After issue executive summary snapshot:', issuedDocument);

    let postIssueWarning: string | undefined;
    try {
      console.info('[issueDocument] Summary generation mode.', {
        currentDocumentId: documentId,
        currentVersion: document.version_number,
        mode: previousIssued ? 'changes_since_last_issue' : 'initial_issue',
        previousDocumentId: previousIssued?.id ?? null,
        previousVersion: previousIssued?.version_number ?? null,
        fallbackInitialIssueReason: previousIssued ? null : 'no_prior_issued_or_superseded_revision_in_chain',
      });

      const summaryResult = previousIssued
        ? await generateChangeSummary(documentId, previousIssued.id, userId)
        : await createInitialIssueSummary(documentId, userId);

      if (summaryResult && summaryResult.success === false) {
        postIssueWarning = summaryResult.error || 'Issue succeeded, but change summary generation failed.';
      }
    } catch (summaryError: unknown) {
      postIssueWarning = getErrorMessage(summaryError, 'Issue succeeded, but change summary generation failed.');
      console.warn('[issueDocument] Change summary failed after document was issued:', summaryError);
    }

    return {
      success: true,
      documentId,
      partialSuccess: Boolean(postIssueWarning),
      postIssueWarning,
      warning: postIssueWarning ? `Document issued with locked PDF, but post-issue processing failed: ${postIssueWarning}` : undefined,
    };
  } catch (error: unknown) {
    console.error('[issueDocument] Error issuing document:', error);

    const { data: currentDocument } = await supabase
      .from('documents')
      .select('id, status, issue_status, locked_pdf_path, pdf_generation_error')
      .eq('id', documentId)
      .eq('organisation_id', organisationId)
      .maybeSingle();

    if (currentDocument?.status === 'issued' || currentDocument?.issue_status === 'issued') {
      if (!currentDocument.locked_pdf_path) {
        return {
          success: false,
          error: 'Issue failed after status changed and no locked PDF is available. Contact support before continuing.',
        };
      }

      return {
        success: true,
        documentId,
        alreadyIssued: true,
        partialSuccess: true,
        warning: 'Document was issued with a locked PDF, but post-issue processing reported an error. Reloading the issued document state.',
        postIssueWarning: currentDocument.pdf_generation_error || getErrorMessage(error, 'Post-issue processing failed'),
      };
    }

    return { success: false, error: getErrorMessage(error, 'Failed to issue document') };
  }
}

export async function createNewVersion(
  baseDocumentId: string,
  userId: string,
  organisationId: string,
  shouldCarryForwardEvidence: boolean = true
): Promise<CreateNewVersionResult> {
  try {
    const { data: currentIssued, error: currentError } = await supabase
      .from('documents')
      .select('*')
      .eq('base_document_id', baseDocumentId)
      .eq('issue_status', 'issued')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentError) throw currentError;

    if (!currentIssued) {
      return { success: false, error: 'No issued version found to create new version from' };
    }

    const { data: existingDraft, error: draftError } = await supabase
      .from('documents')
      .select('id, version_number, issue_status, status, deleted_at')
      .eq('base_document_id', baseDocumentId)
      .in('issue_status', [...ACTIVE_EDITABLE_DRAFT_ISSUE_STATUSES])
      .is('deleted_at', null)
      .or(ACTIVE_DRAFT_LIFECYCLE_STATUS_OR_FILTER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) throw draftError;

    if (existingDraft?.id) {
      return {
        success: false,
        error: EXISTING_DRAFT_VERSION_MESSAGE,
        existingDraftDocumentId: existingDraft.id,
        newVersionNumber: existingDraft.version_number ?? (currentIssued.version_number + 1),
      };
    }

    const newVersionNumber = (currentIssued.version_number || 1) + 1;
    const currentDate = new Date().toISOString().slice(0, 10);
    const sourceIdentity = resolveDocumentIdentity(currentIssued);
    const carriedMeta = mergeIdentityIntoMeta(currentIssued.meta as Record<string, unknown> | null, sourceIdentity);
    const newDocData = {
      ...cloneRowForInsert(currentIssued, DOCUMENT_INSERT_EXCLUDE_FIELDS),
      organisation_id: currentIssued.organisation_id || organisationId,
      base_document_id: baseDocumentId,
      version_number: newVersionNumber,
      site_id: currentIssued.site_id ?? sourceIdentity.siteId,
      building_id: currentIssued.building_id ?? sourceIdentity.buildingId,
      responsible_person: currentIssued.responsible_person ?? sourceIdentity.clientName,
      meta: carriedMeta,
      display_author_name: currentIssued.display_author_name ?? currentIssued.assessor_name,
      display_author_role: currentIssued.display_author_role ?? currentIssued.assessor_role,
      display_author_organisation: currentIssued.display_author_organisation ?? null,
      author_name_snapshot: currentIssued.author_name_snapshot ?? currentIssued.assessor_name,
      author_role_snapshot: currentIssued.author_role_snapshot ?? currentIssued.assessor_role,
      created_by_user_id: userId,
      author_profile_id: userId,
      assessment_date: currentIssued.assessment_date || currentIssued.issue_date || currentDate,
      issue_status: 'draft' as const,
      issue_date: null,
      issued_by: null,
      status: 'draft' as const,
      is_immutable: false,
      client_visible: false,
      superseded_by_document_id: null,
      superseded_date: null,
      executive_summary_ai: currentIssued.executive_summary_ai ?? null,
      executive_summary_author: currentIssued.executive_summary_author ?? null,
      executive_summary_mode: currentIssued.executive_summary_mode || 'ai',
      ...DRAFT_APPROVAL_RESET_FIELDS,
      locked_pdf_path: null,
      locked_pdf_checksum: null,
      locked_pdf_generated_at: null,
      locked_pdf_size_bytes: null,
      pdf_generation_error: null,
    };

    const { data: newDocument, error: newDocError } = await supabase
      .from('documents')
      .insert([newDocData])
      .select('*')
      .single();

    if (newDocError) throw newDocError;

    const { data: modules, error: moduleError } = await supabase
      .from('module_instances')
      .select('*')
      .eq('document_id', currentIssued.id)
      .eq('organisation_id', organisationId);

    if (moduleError) throw moduleError;

    const moduleIdMap: Record<string, string> = {};
    const insertedModules: AnyRow[] = [];

    for (const module of modules || []) {
      const newModuleData = {
        ...cloneRowForInsert(module, ROW_INSERT_EXCLUDE_FIELDS),
        organisation_id: organisationId,
        document_id: newDocument.id,
        site_id: module.site_id ?? newDocument.site_id ?? null,
        building_id: module.building_id ?? newDocument.building_id ?? null,
        data: resetModuleApprovalMetadata(module.data),
      };

      const { data: insertedModule, error: moduleInsertError } = await supabase
        .from('module_instances')
        .insert([newModuleData])
        .select('*')
        .single();

      if (moduleInsertError) throw moduleInsertError;
      if (insertedModule?.id) {
        moduleIdMap[module.id] = insertedModule.id;
        insertedModules.push(insertedModule);
      }
    }

    const { data: actions, error: actionsError } = await supabase
      .from('actions')
      .select('*')
      .eq('document_id', currentIssued.id)
      .in('status', CARRY_FORWARD_ACTION_STATUSES)
      .is('deleted_at', null);

    if (actionsError) throw actionsError;

    const actionIdMap: Record<string, string> = {};
    for (const action of actions || []) {
      const carriedAction = {
        ...cloneRowForInsert(action, ROW_INSERT_EXCLUDE_FIELDS),
        organisation_id: organisationId,
        document_id: newDocument.id,
        source_document_id: action.source_document_id || currentIssued.id,
        module_instance_id: action.module_instance_id ? (moduleIdMap[action.module_instance_id] || null) : null,
        origin_action_id: action.origin_action_id || action.id,
        carried_from_document_id: currentIssued.id,
        superseded_by_action_id: null,
        superseded_at: null,
      };

      const { data: insertedAction, error: actionsInsertError } = await supabase
        .from('actions')
        .insert([carriedAction])
        .select('id')
        .single();

      if (actionsInsertError) {
        console.error('Error carrying forward action:', actionsInsertError);
        continue;
      }
      if (insertedAction?.id) actionIdMap[action.id] = insertedAction.id;
    }

    const { data: recommendations, error: recommendationsError } = await supabase
      .from('re_recommendations')
      .select('*')
      .eq('document_id', currentIssued.id)
      .in('status', CARRY_FORWARD_RECOMMENDATION_STATUSES)
      .or('is_suppressed.is.false,is_suppressed.is.null');

    if (recommendationsError) throw recommendationsError;

    for (const recommendation of recommendations || []) {
      const carriedRecommendation = {
        ...cloneRowForInsert(recommendation, ROW_INSERT_EXCLUDE_FIELDS),
        document_id: newDocument.id,
        module_instance_id: recommendation.module_instance_id ? (moduleIdMap[recommendation.module_instance_id] || null) : null,
        created_by: userId,
      };

      const { error: recommendationInsertError } = await supabase
        .from('re_recommendations')
        .insert([carriedRecommendation]);

      if (recommendationInsertError) {
        console.error('Error carrying forward RE recommendation:', recommendationInsertError);
      }
    }

    if (shouldCarryForwardEvidence) {
      try {
        const evidenceResult = await carryForwardEvidence(
          currentIssued.id,
          newDocument.id,
          baseDocumentId,
          organisationId,
          moduleIdMap,
          actionIdMap
        );

        if (!evidenceResult.success) {
          console.error('Error carrying forward evidence:', evidenceResult.error);
        }
      } catch (evidenceError) {
        console.error('Exception carrying forward evidence:', evidenceError);
      }
    }

    await logCreateNewVersionCarryForwardAudit({
      sourceDocument: currentIssued,
      newDocument,
      sourceModules: modules || [],
      newModules: insertedModules,
    });

    console.info('[createNewVersion] Summary generation deferred until issue.', {
      newDocumentId: newDocument.id,
      baseDocumentId,
      newVersionNumber,
      reason: 'draft_rows_must_not_create_initial_issue_or_change_summary_records',
    });

    return {
      success: true,
      newDocumentId: newDocument.id,
      newVersionNumber: newVersionNumber,
    };
  } catch (error: unknown) {
    console.error('Error creating new version:', error);
    if (isDuplicateDraftVersionError(error)) {
      return { success: false, error: EXISTING_DRAFT_VERSION_MESSAGE };
    }
    const errorMessage = (error as MaybeErrorWithMessage)?.message || 'Failed to create new version';
    return { success: false, error: errorMessage };
  }
}

export async function supersedeDocumentAndIssueNew(
  oldDocumentId: string,
  newDocumentId: string,
  userId: string,
  organisationId: string
): Promise<IssueDocumentResult> {
  try {
    const { error: supersedeError } = await supabase
      .from('documents')
      .update({
        issue_status: 'superseded',
        status: 'superseded',
        superseded_by_document_id: newDocumentId,
        superseded_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', oldDocumentId);

    if (supersedeError) throw supersedeError;

    const issueResult = await issueDocument(newDocumentId, userId, organisationId);
    return issueResult;
  } catch (error) {
    console.error('Error superseding document:', error);
    return { success: false, error: 'Failed to supersede and issue document' };
  }
}

export async function getDocumentVersionHistory(baseDocumentId: string): Promise<DocumentVersion[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('base_document_id', baseDocumentId)
      .in('issue_status', [...ISSUED_REVISION_STATUSES])
      .is('deleted_at', null)
      .not('status', 'in', '(archived,deleted)')
      .order('version_number', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching version history:', error);
    return [];
  }
}

export async function canEditDocument(documentId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('issue_status, status, deleted_at')
      .eq('id', documentId)
      .single();

    if (error) throw error;
    return isActiveEditableDraftVersion(data);
  } catch (error) {
    console.error('Error checking document edit permission:', error);
    return false;
  }
}
