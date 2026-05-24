import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getBearerToken, requireAuthenticatedUser } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });

    const { user, error: authError } = await requireAuthenticatedUser(userSupabase, req);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = (await req.json()) as InvitePayload;
    if (!payload.organisation_id || !payload.email || !payload.role) {
      return new Response(JSON.stringify({ error: 'organisation_id, email, and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validRoles = ['owner', 'admin', 'consultant', 'viewer'];
    if (!validRoles.includes(payload.role)) {
      return new Response(JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'Forbidden: must be an admin of this organisation' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check seat limits before sending the invite.
    const { data: seatRows, error: seatError } = await userSupabase
      .rpc('get_user_seat_entitlement', { p_org_id: payload.organisation_id });

    if (seatError) {
      return new Response(JSON.stringify({ error: 'Failed to check seat entitlement' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const seat = (seatRows as Array<{ allowed: boolean; reason: string | null }>)?.[0];
    if (seat && !seat.allowed) {
      return new Response(JSON.stringify({ error: seat.reason ?? 'User seat limit reached' }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Send invite via Supabase admin. Passes org + role in metadata for handle_new_user() trigger.
    const { data: inviteData, error: inviteError } = await adminSupabase.auth.admin.inviteUserByEmail(
      payload.email.toLowerCase().trim(),
      {
        data: {
          organisation_id: payload.organisation_id,
          role: payload.role,
          invite_flow: 'true',
          invited_by_user_id: user.id,
          ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
        },
      },
    );

    if (inviteError) {
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const invitedUserId = inviteData.user.id;

    // Check whether this user is already an active member of this org.
    const { data: existingMember } = await adminSupabase
      .from('organisation_members')
      .select('status')
      .eq('organisation_id', payload.organisation_id)
      .eq('user_id', invitedUserId)
      .maybeSingle();

    if (existingMember?.status === 'active') {
      return new Response(
        JSON.stringify({ error: 'This user is already an active member of this organisation' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create (or refresh) the invited membership row.
    const now = new Date().toISOString();
    const { error: memberInsertError } = await adminSupabase
      .from('organisation_members')
      .upsert(
        {
          organisation_id: payload.organisation_id,
          user_id: invitedUserId,
          role: payload.role,
          status: 'invited',
          invited_email: payload.email.toLowerCase().trim(),
          invited_by_user_id: user.id,
          invited_at: now,
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'organisation_id,user_id' },
      );

    if (memberInsertError) {
      return new Response(JSON.stringify({ error: memberInsertError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, user_id: invitedUserId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
