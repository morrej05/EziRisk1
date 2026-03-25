import { supabase } from '../lib/supabase';

export async function setDevForcePro(organisationId: string, enabled: boolean): Promise<void> {
  if (!import.meta.env.DEV) return;

  const targetPlanId = enabled ? 'professional' : 'standard';

  const { error } = await supabase
    .from('organisations')
    .update({ plan_id: targetPlanId })
    .eq('id', organisationId);

  if (error) {
    console.error('[devFlags] Error updating plan:', error);
    throw error;
  }

  console.log('[devFlags] Updated plan to:', targetPlanId);
}

export async function toggleDevForcePro(organisationId: string, currentPlanId: string): Promise<boolean> {
  if (!import.meta.env.DEV) return false;

  const newEnabled = currentPlanId !== 'professional';
  await setDevForcePro(organisationId, newEnabled);
  return newEnabled;
}
