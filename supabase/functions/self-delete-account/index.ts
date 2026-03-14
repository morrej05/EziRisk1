import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getBearerToken, requireAuthenticatedUser } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface SelfDeletePayload {
  transfer_organisation_id?: string;
  transfer_to_user_id?: string;
  workflow?: string;
  confirmation_phrase?: string;
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

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });

    const { user, error: authErrorMessage } = await requireAuthenticatedUser(userSupabase, req);
    if (authErrorMessage || !user) {
      return new Response(JSON.stringify({ error: authErrorMessage ?? 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = (await req.json().catch(() => ({}))) as SelfDeletePayload;

    const isSoloOwnerCloseOrgWorkflow = payload.workflow === 'solo_owner_close_org';

    const { error: rpcError } = isSoloOwnerCloseOrgWorkflow
      ? await userSupabase.rpc('self_delete_solo_owner_account_secure', {
          p_confirmation_phrase: payload.confirmation_phrase ?? null,
        })
      : await userSupabase.rpc('self_delete_account_secure', {
          p_transfer_organisation_id: payload.transfer_organisation_id ?? null,
          p_transfer_to_user_id: payload.transfer_to_user_id ?? null,
        });

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(user.id, true);
    if (deleteError) {
      return new Response(JSON.stringify({ error: `Account cleanup completed, but auth delete failed: ${deleteError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
