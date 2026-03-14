import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader) return null;

  const [scheme, token] = authHeader.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export async function requireAuthenticatedUser(supabase: SupabaseClient, req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return { user: null, error: 'Missing or invalid authorization bearer token' };
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: 'Unauthorized' };
  }

  return { user, error: null };
}
