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
  // Canonical lookup is by email — mirrors the duplicate-detection query in
  // invite-org-member so both paths use the same source of truth.
  email: string;
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

    if (!payload.organisation_id || !payload.email) {
      return json({ error: 'organisation_id and email are required' }, 400);
    }

    const emailNormalised = payload.email.toLowerCase().trim();

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

    // Canonical lookup: by invited_email — same field used by invite-org-member's
    // duplicate-detection query, so both paths share a single source of truth.
    const { data: invitedMember, error: fetchError } = await adminSupabase
      .from('organisation_members')
      .select('invited_email, role, status, user_id')
      .eq('organisation_id', payload.organisation_id)
      .eq('invited_email', emailNormalised)
      .maybeSingle();

    if (fetchError) {
      console.error('[resend-invite] DB fetch error:', fetchError.message);
      return json({ error: 'Database error looking up invite' }, 500);
    }

    if (!invitedMember) {
      return json(
        { error: `No pending invite found for ${emailNormalised} in this organisation` },
        404,
      );
    }

    if (invitedMember.status !== 'invited') {
      return json(
        {
          error: `Cannot resend: ${emailNormalised} already has status "${invitedMember.status}". They may have already accepted the invite.`,
        },
        409,
      );
    }

    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://ezirisk.co.uk';

    // GoTrue enforces that generateLink({ type: 'invite' }) is only valid for
    // users whose email_confirmed_at IS NULL (i.e. never accepted any invite or
    // signed up).  Calling it for a confirmed user returns:
    //   "A user with this email address has already been registered"
    //
    // Strategy: look up the user's confirmed status via getUserById, then choose
    // the right link type:
    //
    //   • Unconfirmed (email_confirmed_at = null):
    //       generateLink({ type: 'invite' }) — regenerates the real invite token
    //       and sends the "You've been invited" email template.
    //
    //   • Confirmed (email_confirmed_at is set):
    //       generateLink({ type: 'magiclink' }) — sends a sign-in link.
    //       The redirectTo embeds ?type=invite so AuthCallbackPage routes the
    //       user to /accept-invite, where ensure_org_for_user() activates the
    //       pending membership.  options.data is intentionally omitted because
    //       GoTrue ignores it for magiclink-type links.

    let linkError: { message: string } | null = null;
    let isConfirmed = false;

    if (invitedMember.user_id) {
      const { data: authUserData } = await adminSupabase.auth.admin.getUserById(
        invitedMember.user_id as string,
      );
      isConfirmed = authUserData?.user?.email_confirmed_at != null;
    }

    if (!isConfirmed) {
      // Unconfirmed user — regenerate the invite link.
      const { error } = await adminSupabase.auth.admin.generateLink({
        type: 'invite',
        email: emailNormalised,
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
      linkError = error;
    } else {
      // Confirmed user — send a magic link routed through the invite accept flow.
      // ?type=invite in redirectTo tells AuthCallbackPage this is an invite flow
      // and tells AcceptInvitePage to treat this as an existing-account join.
      const { error } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: emailNormalised,
        options: {
          redirectTo: `${appBaseUrl}/auth/callback?type=invite`,
        },
      });
      linkError = error;
    }

    if (linkError) {
      console.error('[resend-invite] generateLink failed:', linkError.message);
      return json({ error: `Failed to resend invite: ${linkError.message}` }, 400);
    }

    // Stamp the latest send time — non-fatal if this update fails.
    const now = new Date().toISOString();
    const { error: updateError } = await adminSupabase
      .from('organisation_members')
      .update({ invited_at: now, updated_at: now })
      .eq('organisation_id', payload.organisation_id)
      .eq('invited_email', emailNormalised);

    if (updateError) {
      console.warn('[resend-invite] Failed to update invited_at:', updateError.message);
    }

    return json({ success: true, invited_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[resend-invite] Unhandled exception:', message);
    return json({ error: `Server error: ${message}` }, 500);
  }
});
