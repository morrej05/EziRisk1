import { supabase } from '../supabase';

/**
 * Persists a new display name to public.user_profiles.
 * Caller is responsible for calling refreshUserRole() afterwards
 * to update the in-memory auth context.
 */
export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ name: name.trim() })
    .eq('id', userId);

  if (error) throw error;
}
