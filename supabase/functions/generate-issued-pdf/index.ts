import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBearerToken, requireAuthenticatedUser } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

async function hasMembershipAccess(supabase: ReturnType<typeof createClient>, organisationId: string, userId: string) {
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('id')
    .eq('organisation_id', organisationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  return Boolean(membership);
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
      return new Response(JSON.stringify({ error: 'Missing or invalid authorization bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const { user, error: authErrorMessage } = await requireAuthenticatedUser(userSupabase, req);

    if (authErrorMessage || !user) {
      return new Response(JSON.stringify({ error: authErrorMessage ?? 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { survey_report_id, document_id } = body;
    const targetId = survey_report_id || document_id;

    if (!targetId) {
      return new Response(JSON.stringify({ error: 'survey_report_id or document_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: document } = await adminSupabase
      .from('documents')
      .select('id, locked_pdf_path, issue_status, organisation_id')
      .eq('id', targetId)
      .maybeSingle();

    if (document) {
      if (!document.organisation_id || !(await hasMembershipAccess(userSupabase, document.organisation_id, user.id))) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (document.issue_status !== 'issued') {
        return new Response(JSON.stringify({ error: 'Document must be issued before generating locked PDF', current_status: document.issue_status }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!document.locked_pdf_path) {
        return new Response(JSON.stringify({ error: 'No locked PDF found for this document. PDF may still be generating.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: signedData, error: signedError } = await adminSupabase.storage
        .from('document-pdfs')
        .createSignedUrl(document.locked_pdf_path, 3600);

      if (signedError || !signedData) {
        return new Response(JSON.stringify({ error: 'Failed to generate PDF signed URL', details: signedError?.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, signed_url: signedData.signedUrl, pdf_path: document.locked_pdf_path, expires_in: 3600 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: survey } = await adminSupabase
      .from('survey_reports')
      .select('id, locked_pdf_path, status, organisation_id')
      .eq('id', targetId)
      .maybeSingle();

    if (survey) {
      const hasOrgAccess = survey.organisation_id
        ? await hasMembershipAccess(userSupabase, survey.organisation_id, user.id)
        : false;

      if (!hasOrgAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (survey.status !== 'issued') {
        return new Response(JSON.stringify({ error: 'Survey must be issued before generating locked PDF', current_status: survey.status }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!survey.locked_pdf_path) {
        return new Response(JSON.stringify({ error: 'No locked PDF found for this survey. PDF may still be generating.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: signedData, error: signedError } = await adminSupabase.storage
        .from('survey-pdfs')
        .createSignedUrl(survey.locked_pdf_path, 3600);

      if (signedError || !signedData) {
        return new Response(JSON.stringify({ error: 'Failed to generate PDF signed URL', details: signedError?.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, signed_url: signedData.signedUrl, pdf_path: survey.locked_pdf_path, expires_in: 3600 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Document or survey not found', id: targetId }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
