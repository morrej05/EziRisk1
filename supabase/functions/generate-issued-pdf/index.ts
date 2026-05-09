import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBearerToken, requireAuthenticatedUser } from '../_shared/auth.ts';
import { hasRequiredOrganisationRole } from '../_shared/orgAuth.ts';

const DOCUMENT_PDF_BUCKET = 'document-pdfs';
const SURVEY_PDF_BUCKET = 'survey-pdfs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitizeTitle(title: string) {
  return title.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').replace(/^_|_$/g, '') || 'document';
}

function decodeBase64Pdf(pdfBase64: string) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const PDF_READER_ROLES = ['owner', 'admin', 'consultant', 'viewer'] as const;
const PDF_WRITER_ROLES = ['owner', 'admin', 'consultant'] as const;

async function hasMembershipAccess(supabase: ReturnType<typeof createClient>, organisationId: string, userId: string) {
  return hasRequiredOrganisationRole(supabase, userId, organisationId, PDF_READER_ROLES);
}

async function hasPdfWriteAccess(supabase: ReturnType<typeof createClient>, organisationId: string, userId: string) {
  return hasRequiredOrganisationRole(supabase, userId, organisationId, PDF_WRITER_ROLES);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bearerToken = getBearerToken(req);

    if (!bearerToken) {
      return jsonResponse({ error: 'Missing or invalid authorization bearer token' }, 401);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const { user, error: authErrorMessage } = await requireAuthenticatedUser(userSupabase, req);

    if (authErrorMessage || !user) {
      return jsonResponse({ error: authErrorMessage ?? 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const {
      survey_report_id,
      document_id,
      organisation_id,
      title,
      version_number,
      pdf_base64,
      size_bytes,
      mode,
      pdf_payload,
    } = body;
    const pdfBase64 = typeof pdf_base64 === 'string'
      ? pdf_base64
      : typeof pdf_payload === 'string'
        ? pdf_payload
        : typeof pdf_payload?.pdf_base64 === 'string'
          ? pdf_payload.pdf_base64
          : null;
    const targetId = survey_report_id || document_id;

    if (!targetId) {
      return jsonResponse({ error: 'survey_report_id or document_id is required' }, 400);
    }

    const { data: document, error: documentError } = await adminSupabase
      .from('documents')
      .select('id, title, version_number, locked_pdf_path, issue_status, organisation_id')
      .eq('id', targetId)
      .maybeSingle();

    if (documentError) {
      return jsonResponse({ error: 'Failed to load document', details: documentError.message }, 500);
    }

    if (document) {
      if (!document.organisation_id || !(await hasMembershipAccess(userSupabase, document.organisation_id, user.id))) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }

      if (organisation_id && organisation_id !== document.organisation_id) {
        return jsonResponse({ error: 'Document does not belong to the requested organisation' }, 403);
      }

      let pdfPath = document.locked_pdf_path;

      const isPreIssueMode = mode === 'pre_issue';

      if (pdfBase64 && document.issue_status === 'draft' && !isPreIssueMode) {
        return jsonResponse({ error: 'Draft document PDF generation is only allowed in pre_issue mode', current_status: document.issue_status }, 400);
      }

      if (pdfBase64 && isPreIssueMode && document.issue_status !== 'draft') {
        return jsonResponse({ error: 'pre_issue PDF generation is only valid for draft documents', current_status: document.issue_status }, 400);
      }

      if (!pdfBase64 && document.issue_status === 'draft') {
        return jsonResponse({ error: 'Draft document locked PDF retrieval is only available during pre_issue PDF generation' }, 400);
      }

      if (pdfBase64) {
        const canWriteLockedPdf = await hasPdfWriteAccess(userSupabase, document.organisation_id, user.id);
        if (!canWriteLockedPdf) {
          return jsonResponse({ error: 'Access denied' }, 403);
        }

        if (document.issue_status !== 'draft' && document.locked_pdf_path) {
          return jsonResponse({ error: 'Locked PDF already exists for this issued document', pdf_path: document.locked_pdf_path }, 409);
        }

        const pdfBytes = decodeBase64Pdf(pdfBase64);
        if (pdfBytes.length === 0) {
          return jsonResponse({ error: 'PDF payload is empty' }, 400);
        }

        if (size_bytes && Number(size_bytes) !== pdfBytes.length) {
          return jsonResponse({ error: 'PDF size mismatch' }, 400);
        }

        const safeTitle = sanitizeTitle(title || document.title || 'document');
        const safeVersionNumber = version_number || document.version_number || 1;
        pdfPath = `${document.organisation_id}/${document.id}/${safeTitle}_v${safeVersionNumber}_${Date.now()}.pdf`;
        const checksum = await sha256Hex(pdfBytes);

        const { error: uploadError } = await adminSupabase.storage
          .from(DOCUMENT_PDF_BUCKET)
          .upload(pdfPath, pdfBytes, {
            contentType: 'application/pdf',
            upsert: false,
          });

        if (uploadError) {
          await adminSupabase
            .from('documents')
            .update({ pdf_generation_error: uploadError.message })
            .eq('id', document.id);
          return jsonResponse({ error: 'Failed to upload locked PDF', details: uploadError.message }, 500);
        }

        const { error: updateError } = await adminSupabase
          .from('documents')
          .update({
            locked_pdf_path: pdfPath,
            locked_pdf_checksum: checksum,
            locked_pdf_generated_at: new Date().toISOString(),
            locked_pdf_size_bytes: pdfBytes.length,
            pdf_generation_error: null,
          })
          .eq('id', document.id);

        if (updateError) {
          await adminSupabase.storage.from(DOCUMENT_PDF_BUCKET).remove([pdfPath]);
          return jsonResponse({ error: 'Failed to lock PDF on document row', details: updateError.message }, 500);
        }
      }

      if (!pdfPath) {
        return jsonResponse({ error: 'No locked PDF found for this document. Issue has been blocked until the PDF is generated.' }, 404);
      }

      const { data: signedData, error: signedError } = await adminSupabase.storage
        .from(DOCUMENT_PDF_BUCKET)
        .createSignedUrl(pdfPath, 3600);

      if (signedError || !signedData) {
        return jsonResponse({ error: 'Failed to generate PDF signed URL', details: signedError?.message }, 500);
      }

      return jsonResponse({ success: true, signed_url: signedData.signedUrl, pdf_path: pdfPath, bucket: DOCUMENT_PDF_BUCKET, expires_in: 3600 }, 200);
    }

    const { data: survey, error: surveyError } = await adminSupabase
      .from('survey_reports')
      .select('id, locked_pdf_path, status, organisation_id')
      .eq('id', targetId)
      .maybeSingle();

    if (surveyError) {
      return jsonResponse({ error: 'Failed to load survey', details: surveyError.message }, 500);
    }

    if (survey) {
      const hasOrgAccess = survey.organisation_id
        ? await hasMembershipAccess(userSupabase, survey.organisation_id, user.id)
        : false;

      if (!hasOrgAccess) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }

      if (survey.status !== 'issued') {
        return jsonResponse({ error: 'Survey must be issued before retrieving locked PDF', current_status: survey.status }, 400);
      }

      if (!survey.locked_pdf_path) {
        return jsonResponse({ error: 'No locked PDF found for this survey. PDF may still be generating.' }, 404);
      }

      const { data: signedData, error: signedError } = await adminSupabase.storage
        .from(SURVEY_PDF_BUCKET)
        .createSignedUrl(survey.locked_pdf_path, 3600);

      if (signedError || !signedData) {
        return jsonResponse({ error: 'Failed to generate PDF signed URL', details: signedError?.message }, 500);
      }

      return jsonResponse({ success: true, signed_url: signedData.signedUrl, pdf_path: survey.locked_pdf_path, bucket: SURVEY_PDF_BUCKET, expires_in: 3600 }, 200);
    }

    return jsonResponse({ error: 'Document or survey not found', id: targetId }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonResponse({ error: message }, 500);
  }
});
