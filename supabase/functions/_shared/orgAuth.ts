import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

export const ORG_MEMBER_ROLES = ['owner', 'admin', 'consultant', 'viewer'] as const;
export type OrgMemberRole = typeof ORG_MEMBER_ROLES[number];

export async function getActiveOrganisationMembership(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
) {
  return supabase
    .from('organisation_members')
    .select('organisation_id, role, status')
    .eq('organisation_id', organisationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
}

export async function hasRequiredOrganisationRole(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
  allowedRoles: readonly OrgMemberRole[],
): Promise<boolean> {
  const { data: membership, error } = await getActiveOrganisationMembership(supabase, userId, organisationId);
  if (error || !membership) {
    return false;
  }

  return allowedRoles.includes(membership.role as OrgMemberRole);
}
