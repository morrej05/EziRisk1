import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { requireAuthenticatedUser } from './auth.ts';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function enforceAiEndpointProtection(
  supabase: SupabaseClient,
  req: Request,
  endpointKey: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const { user, error } = await requireAuthenticatedUser(supabase, req);
  if (error || !user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: error ?? 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const now = Date.now();
  const key = `${endpointKey}:${user.id}`;
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, userId: user.id };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Rate limit exceeded', retry_after_seconds: retryAfterSec }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec),
        },
      }),
    };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { ok: true, userId: user.id };
}
