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

interface InvitePayload {
  organisation_id: string;
  email: string;
  role: string;
  name?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: 'Server configuration error: missing Supabase URL or anon key' }, 500);
    }
    if (!serviceRoleKey) {
      return json({ error: 'Server configuration error: service role key is not available' }, 500);
    }

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return json({ error: 'Missing or invalid authorization token' }, 401);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });

    const { user, error: authError } = await requireAuthenticatedUser(userSupabase, req);
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let payload: InvitePayload;
    try {
      payload = (await req.json()) as InvitePayload;
    } catch {
      return json({ error: 'Invalid JSON in request body' }, 400);
    }

    if (!payload.organisation_id || !payload.email || !payload.role) {
      return json({ error: 'organisation_id, email, and role are required' }, 400);
    }

    const emailNormalised = payload.email.toLowerCase().trim();
    if (!emailNormalised.includes('@')) {
      return json({ error: 'Invalid email address' }, 400);
    }

    const validRoles = ['owner', 'admin', 'consultant', 'viewer'];
    if (!validRoles.includes(payload.role)) {
      return json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400);
    }

    // Verify caller is an active admin/owner of the target organisation.
    const { data: callerMember, error: memberError } = await userSupabase
      .from('organisation_members')
      .select('role')
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError) {
      console.error('[invite-org-member] Admin check failed:', memberError.message);
      return json({ error: 'Failed to verify admin permissions' }, 500);
    }
    if (!callerMember || !['owner', 'admin'].includes(callerMember.role)) {
      return json({ error: 'You must be an admin of this organisation to invite users' }, 403);
    }

    // Check seat limits.
    const { data: seatRows, error: seatError } = await userSupabase
      .rpc('get_user_seat_entitlement', { p_org_id: payload.organisation_id, p_at: new Date().toISOString() });

    if (seatError) {
      console.error('[invite-org-member] Seat check failed:', seatError.message);
      return json({ error: 'Failed to check seat entitlement. Please try again.' }, 500);
    }

    const seat = (seatRows as Array<{ allowed: boolean; reason: string | null }>)?.[0];
    if (seat && !seat.allowed) {
      return json({ error: seat.reason ?? 'User seat limit reached. Upgrade your plan to invite more users.' }, 422);
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Pre-check: catch existing active members and duplicate pending invites
    // (both by invited_email) before sending any email.
    const { data: existingByEmail } = await adminSupabase
      .from('organisation_members')
      .select('status')
      .eq('organisation_id', payload.organisation_id)
      .eq('invited_email', emailNormalised)
      .in('status', ['invited', 'active'])
      .maybeSingle();

    if (existingByEmail?.status === 'active') {
      return json({
        error: `${emailNormalised} is already an active member of this organisation.`,
      }, 409);
    }

    if (existingByEmail?.status === 'invited') {
      return json({
        error: `An invitation already exists for ${emailNormalised}. Use "Copy invite link" to share a fresh link.`,
      }, 409);
    }

    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://ezirisk.co.uk';

    // Manual-link-only strategy: use generateLink() exclusively so no
    // automated invite email is sent by Supabase.
    const inviteMetadata = {
      organisation_id: payload.organisation_id,
      role: payload.role,
      invite_flow: 'true',
      invited_by_user_id: user.id,
      ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
    };

    const { data: inviteGenerated, error: inviteError } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email: emailNormalised,
      options: {
        redirectTo: `${appBaseUrl}/auth/callback`,
        data: inviteMetadata,
      },
    });

    let invitedUserId: string;
    let inviteLink: string | null = (inviteGenerated as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    if (inviteError) {
      const alreadyRegistered = inviteError.message.toLowerCase().includes('already been registered');
      if (!alreadyRegistered) {
        console.error('[invite-org-member] generateLink(invite) failed:', inviteError.message);
        return json({ error: `Failed to create invite link: ${inviteError.message}` }, 400);
      }

      const { data: magicData, error: magicError } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: emailNormalised,
        options: {
          redirectTo: `${appBaseUrl}/auth/callback?type=invite`,
          data: inviteMetadata,
        },
      });

      if (magicError) {
        console.error('[invite-org-member] generateLink(magiclink) fallback failed:', magicError.message);
        return json({ error: `Failed to create invite link: ${magicError.message}` }, 400);
      }

      invitedUserId = magicData.user.id;
      inviteLink = (magicData as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;
    } else {
      invitedUserId = inviteGenerated.user.id;
    }

    if (!inviteLink) {
      return json({ error: 'Failed to create invite link' }, 500);
    }

    // Check whether this user is already an active member (after resolving user_id).
    const { data: existingMember } = await adminSupabase
      .from('organisation_members')
      .select('status')
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', invitedUserId)
      .maybeSingle();

    if (existingMember?.status === 'active') {
      return json({
        error: `${emailNormalised} is already an active member of this organisation.`,
      }, 409);
    }

    // Upsert invited membership row.
    // created_at is intentionally omitted so the DB keeps the original value on update.
    const now = new Date().toISOString();
    const { data: memberRow, error: memberInsertError } = await adminSupabase
      .from('organisation_members')
      .upsert(
        {
          organisation_id: payload.organisation_id,
          user_id: invitedUserId,
          role: payload.role,
          status: 'invited',
          invited_email: emailNormalised,
          invited_by_user_id: user.id,
          invited_at: now,
          updated_at: now,
        },
        { onConflict: 'organisation_id,user_id' },
      )
      .select('id')
      .maybeSingle();

    if (memberInsertError) {
      console.error('[invite-org-member] Membership upsert failed:', memberInsertError.message);
      return json({ error: `Failed to record invitation: ${memberInsertError.message}` }, 400);
    }

    return json({
      success: true,
      email_sent: false,
      pending_invite_created: true,
      invite_link: inviteLink,
      membership_id: (memberRow as { id: string } | null)?.id ?? null,
      user_id: invitedUserId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[invite-org-member] Unhandled exception:', message);
    return json({ error: `Server error: ${message}` }, 500);
  }
});
