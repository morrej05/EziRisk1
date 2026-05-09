import { PDFDocument, PDFImage, PDFPage, PDFFont } from 'pdf-lib';
import { supabase } from '../supabase';
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  drawCoverPage,
  drawDocumentControlPage,
  getCoverTitleContent,
  loadPdfLogoWithFallback,
} from './pdfUtils';
import { resolveOrganisationLogo } from './logoResolver';
import { stripSimpleMarkdown } from '../../utils/markdownDisplay';
// Enable PDF image logos via env var (default: true)
// Set VITE_PDF_IMAGE_LOGOS=false to disable for debugging
const ENABLE_PDF_IMAGE_LOGOS = (import.meta.env.VITE_PDF_IMAGE_LOGOS ?? 'true') === 'true';

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

interface IssuedPdfOptions {
  pdfDoc: PDFDocument;
  document: {
    id: string;
    title: string;
    document_type: string;
    version_number: number;
    issue_date: string | null;
    issue_status: 'draft' | 'issued' | 'superseded';
    assessor_name: string | null;
    issued_by?: string | null;
    issued_author_name_snapshot?: string | null;
    author_name_snapshot?: string | null;
    base_document_id?: string;
  };
  organisation: {
    id: string;
    name: string;
    branding_logo_path?: string | null;
  };
  client?: {
    name?: string;
    site?: string;
  } | null;
  fonts: {
    bold: PDFFont;
    regular: PDFFont;
  };
}

export async function addIssuedReportPages(options: IssuedPdfOptions): Promise<{
  coverPage: PDFPage;
  docControlPage: PDFPage;
}> {
  console.log('[PDF Issued Pages] Starting issued pages generation');
  const { pdfDoc, document, organisation, client, fonts } = options;
  const preferredOrganisationLogoPath = organisation.branding_logo_path?.trim() || null;

  let logoData: { image: PDFImage; width: number; height: number } | null = null;

  // Try to load organization logo with timeout
  if (ENABLE_PDF_IMAGE_LOGOS) {
    try {
      console.log('[PDF Logo] Attempting logo fallback chain (org -> default -> text)');

      let orgSignedUrl: string | null = null;
      if (preferredOrganisationLogoPath) {
        const logoResult = await resolveOrganisationLogo(organisation.id, preferredOrganisationLogoPath);
        orgSignedUrl = logoResult.signedUrl;
      }

      logoData = await withTimeout(
        loadPdfLogoWithFallback(pdfDoc, {
          organisationLogoPath: preferredOrganisationLogoPath,
          organisationSignedUrl: orgSignedUrl,
        }),
        5000,
        'Logo loading timed out'
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn('[PDF Logo] Exception loading logos:', errorMsg);
      logoData = null;
    }
  }

  // Final fallback message
  if (!logoData) {
    console.log('[PDF Logo] All logo loading failed, using text fallback "EziRisk"');
  } else {
    console.log('[PDF Logo] Logo ready for use');
  }

  console.log('[PDF Issued Pages] Creating cover page');
  const coverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  await drawCoverPage(
    coverPage,
    fonts,
    document,
    organisation,
    client || null,
    logoData
  );

  let revisionHistory: Array<{
    version_number: number;
    issue_date: string;
    change_summary: string | null;
    issued_by_name: string | null;
  }> = [];

  if (document.base_document_id) {
    try {
      console.info('[Issued PDF] Loading revision history source rows.', {
        currentDocumentId: document.id,
        baseDocumentId: document.base_document_id,
        currentVersion: document.version_number,
        rules: 'issued/superseded documents only; drafts and archived/deleted duplicates ignored',
      });

      const { data: issuedVersions, error: versionsError } = await supabase
        .from('documents')
        .select('id, version_number, issue_date, issued_by, issued_author_name_snapshot, author_name_snapshot, assessor_name, created_at, issue_status')
        .eq('base_document_id', document.base_document_id)
        .in('issue_status', ['issued', 'superseded'])
        .is('deleted_at', null)
        .not('status', 'in', '(archived,deleted)')
        .order('version_number', { ascending: false })
        .order('issue_date', { ascending: false, nullsFirst: false });

      if (versionsError) {
        console.error('[Revision history] issued version load error', versionsError);
      }

      const typedVersions = (issuedVersions || []) as Array<{
        id: string;
        version_number: number;
        issue_date: string | null;
        issued_by: string | null;
        issued_author_name_snapshot: string | null;
        author_name_snapshot: string | null;
        assessor_name: string | null;
        created_at: string | null;
        issue_status: string;
      }>;

      if (typedVersions.length > 0) {
        const { data: summaries, error: summariesError } = await supabase
          .from('document_change_summaries')
          .select('document_id, version_number, created_at, summary_text, summary_markdown, generated_by, previous_document_id')
          .eq('base_document_id', document.base_document_id)
          .in('document_id', typedVersions.map((v) => v.id));

        if (summariesError) {
          console.error('[Change summaries] load error', summariesError);
        }

        const typedSummaries = (summaries || []) as Array<{
          document_id: string;
          version_number: number;
          created_at: string;
          summary_text: string | null;
          summary_markdown: string | null;
          generated_by: string | null;
          previous_document_id: string | null;
        }>;

        const latestSummaryByDocumentId = new Map<string, (typeof typedSummaries)[number]>();
        for (const summary of typedSummaries) {
          const existing = latestSummaryByDocumentId.get(summary.document_id);
          if (!existing || String(summary.created_at || '') > String(existing.created_at || '')) {
            latestSummaryByDocumentId.set(summary.document_id, summary);
          }
        }

        const userIds = [
          ...new Set([
            ...typedVersions.map((v) => v.issued_by),
            ...typedSummaries.map((s) => s.generated_by),
          ].filter(Boolean)),
        ];

        const userNamesMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, name')
            .in('id', userIds);

          if (profiles) {
            profiles.forEach(p => {
              userNamesMap[p.id] = p.name || 'Unknown';
            });
          }
        }

        const firstIssuedVersion = Math.min(...typedVersions.map((v) => v.version_number));

        revisionHistory = typedVersions.map((v) => {
          const summary = latestSummaryByDocumentId.get(v.id);
          const summaryText = stripSimpleMarkdown(summary?.summary_text || summary?.summary_markdown);
          const fallbackSummary = v.version_number === firstIssuedVersion ? 'Initial issue' : 'Changes Since Last Issue';

          if (!summaryText) {
            console.info('[Issued PDF] Revision history summary fallback selected.', {
              documentId: v.id,
              versionNumber: v.version_number,
              mode: fallbackSummary,
              reason: v.version_number === firstIssuedVersion
                ? 'first_issued_document_in_base_document_id_chain'
                : 'missing_change_summary_for_later_issued_version',
            });
          }

          return {
            version_number: v.version_number,
            issue_date: v.issue_date || v.created_at || '',
            change_summary: summaryText || fallbackSummary,
            issued_by_name:
              (v.issued_by ? userNamesMap[v.issued_by] : null) ||
              v.issued_author_name_snapshot ||
              v.author_name_snapshot ||
              v.assessor_name ||
              (summary?.generated_by ? userNamesMap[summary.generated_by] || null : null),
          };
        });
      }
    } catch (error) {
      console.warn('[Issued PDF] Failed to load revision history:', error);
    }
  }

  if (revisionHistory.length === 0 && document.issue_date) {
    const isInitialVersion = !document.base_document_id || document.version_number === 1;
    revisionHistory.push({
      version_number: document.version_number,
      issue_date: document.issue_date,
      change_summary: isInitialVersion ? 'Initial issue' : 'Revision issued',
      issued_by_name: document.issued_author_name_snapshot || document.author_name_snapshot || document.assessor_name || null,
    });
  }

  const docControlPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const reportTitleForControl = getCoverTitleContent(document.document_type, document.title).title;

  await drawDocumentControlPage(
    docControlPage,
    fonts,
    {
      title: reportTitleForControl,
      version_number: document.version_number,
      issue_date: document.issue_date,
      issue_status: document.issue_status,
      assessor_name: document.assessor_name,
      issued_by_name: document.issued_author_name_snapshot || document.author_name_snapshot || document.assessor_name || null,
    },
    organisation,
    client || null,
    revisionHistory
  );

  console.log('[PDF Issued Pages] Issued pages generation complete');
  return { coverPage, docControlPage };
}
