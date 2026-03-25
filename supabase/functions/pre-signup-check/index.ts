import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { isDisposableEmailDomain } from '../_shared/emailDomainValidation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_SIGNUP_ATTEMPTS_PER_IP = 5;

interface SignupCheckRequest {
  email?: string;
}

function getClientIp(req: Request): string {
  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  const fallbackHeaders = ['cf-connecting-ip', 'fly-client-ip', 'x-real-ip'];
  for (const header of fallbackHeaders) {
    const value = req.headers.get(header);
    if (value) return value.trim();
  }

  return 'unknown';
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body: SignupCheckRequest = await req.json();
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return jsonResponse({ message: 'Email is required.' }, 400);
    }

    const ipAddress = getClientIp(req);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment for pre-signup-check function');
      return jsonResponse({ message: 'Unable to process signup right now. Please try again.' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('signup_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ipAddress)
      .gte('attempted_at', windowStart);

    if (countError) {
      console.error('Failed counting signup attempts', countError);
      return jsonResponse({ message: 'Unable to process signup right now. Please try again.' }, 500);
    }

    if ((count ?? 0) >= MAX_SIGNUP_ATTEMPTS_PER_IP) {
      return jsonResponse({ message: 'Too many signup attempts. Please try again later.' }, 429);
    }

    const { error: insertError } = await supabase.from('signup_attempts').insert({
      ip_address: ipAddress,
      email,
    });

    if (insertError) {
      console.error('Failed storing signup attempt', insertError);
      return jsonResponse({ message: 'Unable to process signup right now. Please try again.' }, 500);
    }

    if (isDisposableEmailDomain(email)) {
      return jsonResponse({ message: 'Please use a business or personal email address.' }, 400);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    console.error('Unexpected pre-signup-check error', error);
    return jsonResponse({ message: 'Unable to process signup right now. Please try again.' }, 500);
  }
});
