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

type AdminClient = ReturnType<typeof createClient>;

async function recordSoloOwnerAuthDeleteStatus(
  adminSupabase: AdminClient,
  userId: string,
  details: Record<string, unknown>,
) {
  await adminSupabase.from('account_lifecycle_audit').insert({
    organisation_id: null,
    actor_user_id: userId,
    target_user_id: userId,
    event_type: 'account_self_delete_requested',
    details,
  });
}

async function hasCompletedSoloOwnerDbCleanup(adminSupabase: AdminClient, userId: string) {
  const { data, error } = await adminSupabase
    .from('account_lifecycle_audit')
    .select('id')
    .eq('target_user_id', userId)
    .eq('event_type', 'account_self_delete_requested')
    .contains('details', {
      strategy: 'solo_owner_close_org_then_auth_delete',
      organisation_deactivated: true,
    })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { completed: Boolean(data), error };
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

    if (rpcError && !isSoloOwnerCloseOrgWorkflow) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (rpcError && isSoloOwnerCloseOrgWorkflow) {
      const { completed, error: cleanupCheckError } = await hasCompletedSoloOwnerDbCleanup(adminSupabase, user.id);
      if (!completed || cleanupCheckError) {
        return new Response(JSON.stringify({ error: rpcError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await recordSoloOwnerAuthDeleteStatus(adminSupabase, user.id, {
        strategy: 'solo_owner_close_org_then_auth_delete',
        stage: 'auth_delete_retry_after_db_cleanup',
        recoverable: true,
        rpc_error_message: rpcError.message,
      });
    }

    const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(user.id, true);
    if (deleteError) {
      if (isSoloOwnerCloseOrgWorkflow) {
        await recordSoloOwnerAuthDeleteStatus(adminSupabase, user.id, {
          strategy: 'solo_owner_close_org_then_auth_delete',
          stage: 'auth_delete_pending',
          recoverable: true,
          auth_delete_error_message: deleteError.message,
        });
      }

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
