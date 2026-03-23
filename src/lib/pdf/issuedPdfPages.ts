import { PDFDocument, PDFPage } from 'pdf-lib';
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
    bold: any;
    regular: any;
  };
}

export async function addIssuedReportPages(options: IssuedPdfOptions): Promise<{
  coverPage: PDFPage;
  docControlPage: PDFPage;
}> {
  console.log('[PDF Issued Pages] Starting issued pages generation');
  const { pdfDoc, document, organisation, client, fonts } = options;
  const preferredOrganisationLogoPath = organisation.branding_logo_path?.trim() || null;

  let logoData: { image: any; width: number; height: number } | null = null;

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
      const { data: summaries, error } = await supabase
        .from('document_change_summaries')
        .select('version_number, created_at, summary_text, generated_by')
        .eq('base_document_id', document.base_document_id)
        .order('version_number', { ascending: false });

      if (error) {
        console.error('[Change summaries] load error', error);
      }

      if (summaries && summaries.length > 0) {
        // Collect unique user IDs
        const userIds = [...new Set(summaries.map((s: any) => s.generated_by).filter(Boolean))];

        // Fetch user names in a separate query
        const userNamesMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, full_name')
            .in('id', userIds);

          if (profiles) {
            profiles.forEach(p => {
              userNamesMap[p.id] = p.full_name || 'Unknown';
            });
          }
        }

        revisionHistory = summaries.map((s: any) => ({
          version_number: s.version_number,
          issue_date: s.created_at,
          change_summary: s.summary_text,
          issued_by_name: s.generated_by ? userNamesMap[s.generated_by] || null : null,
        }));
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
