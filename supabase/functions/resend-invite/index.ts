import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getBearerToken, requireAuthenticatedUser } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ResendPayload {
  organisation_id: string;
  user_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return json({ error: 'Missing authorization token' }, 401);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });

    const { user, error: authError } = await requireAuthenticatedUser(userSupabase, req);
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let payload: ResendPayload;
    try {
      payload = (await req.json()) as ResendPayload;
    } catch {
      return json({ error: 'Invalid JSON in request body' }, 400);
    }

    if (!payload.organisation_id || !payload.user_id) {
      return json({ error: 'organisation_id and user_id are required' }, 400);
    }

    // Verify caller is an active admin of the target organisation.
    const { data: callerMember, error: memberError } = await userSupabase
      .from('organisation_members')
      .select('role')
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError || !callerMember || !['owner', 'admin'].includes(callerMember.role)) {
      return json({ error: 'Forbidden: must be an admin of this organisation' }, 403);
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch the pending membership row to get the email address.
    const { data: invitedMember, error: fetchError } = await adminSupabase
      .from('organisation_members')
      .select('invited_email, role, status')
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', payload.user_id)
      .maybeSingle();

    if (fetchError) {
      console.error('[resend-invite] DB fetch error:', fetchError.message);
      return json({ error: 'Database error looking up invite' }, 500);
    }

    if (!invitedMember) {
      return json({ error: 'Invited membership not found for this user in this organisation' }, 404);
    }

    if (invitedMember.status !== 'invited') {
      return json(
        { error: `Cannot resend: membership status is "${invitedMember.status}", not "invited"` },
        409,
      );
    }

    if (!invitedMember.invited_email) {
      return json(
        { error: 'No email address recorded for this invite — try revoking and re-inviting' },
        400,
      );
    }

    // Use generateLink (type: 'invite') instead of inviteUserByEmail.
    //
    // Reason: in Supabase v2 `inviteUserByEmail` for an already-created user may
    // silently succeed (returning the existing user row) without sending a new
    // email.  `generateLink` always issues a fresh invite token and triggers
    // Supabase's built-in mailer regardless of whether the user already exists.
    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://ezirisk.co.uk';
    const { error: linkError } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email: invitedMember.invited_email,
      options: {
        redirectTo: `${appBaseUrl}/auth/callback`,
        data: {
          organisation_id: payload.organisation_id,
          role: invitedMember.role,
          invite_flow: 'true',
          invited_by_user_id: user.id,
        },
      },
    });

    if (linkError) {
      console.error('[resend-invite] generateLink failed:', linkError.message);
      return json({ error: `Failed to resend invite: ${linkError.message}` }, 400);
    }

    // Update invited_at to reflect the most recent send time.
    const now = new Date().toISOString();
    const { error: updateError } = await adminSupabase
      .from('organisation_members')
      .update({ invited_at: now, updated_at: now })
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', payload.user_id);

    if (updateError) {
      // Non-fatal — the email was already sent; just log the timestamp update failure.
      console.warn('[resend-invite] Failed to update invited_at:', updateError.message);
    }

    return json({ success: true, invited_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[resend-invite] Unhandled exception:', message);
    return json({ error: `Server error: ${message}` }, 500);
  }
});
