/*
  SUPERSEDED BY 20260525020000_fix_rls_infinite_recursion.sql
  The policies written here caused infinite recursion (500 errors on all auth
  queries) because the organisation_members policy sub-selected the same table.
  They were dropped within minutes and replaced by the SECURITY DEFINER approach
  in the follow-up migration.  This file is kept for history only; do not apply
  it independently.

  Fix RLS policies so org admins (and all active members) can read the full
  member list and associated profiles in their organisation.

  Root cause:
    organisation_members SELECT policy was `user_id = auth.uid()` — each user
    could only see their own membership row.  UserManagement therefore only ever
    returned the current user, regardless of how many active members existed.

    user_profiles SELECT policy was `auth.uid() = id` — same restriction meant
    the profile lookup for other members returned 0 rows, so names were blank.

  Fix:
    Add broader SELECT policies (RLS uses OR semantics across policies — a row
    is visible if ANY policy permits it, so the existing self-read policies are
    preserved and remain the minimum access for non-members).

    1. organisation_members: any active member of an org may read all membership
       rows for that org.
    2. user_profiles: any active member of an org may read profiles where
       user_profiles.organisation_id matches their org.
*/

-- ── organisation_members ──────────────────────────────────────────────────────

-- Allow all active members of an org to read every membership row in that org.
-- Admins need this for User Management; other roles see it for org awareness.
DROP POLICY IF EXISTS "org members can read all org memberships" ON public.organisation_members;

CREATE POLICY "org members can read all org memberships"
ON public.organisation_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members my_membership
    WHERE my_membership.user_id          = auth.uid()
      AND my_membership.organisation_id  = organisation_members.organisation_id
      AND my_membership.status           = 'active'
  )
);

-- ── user_profiles ─────────────────────────────────────────────────────────────

-- Allow active org members to read profiles of users in the same organisation.
-- Complement to the existing "Users can read own profile" policy.
DROP POLICY IF EXISTS "org members can read org profiles" ON public.user_profiles;

CREATE POLICY "org members can read org profiles"
ON public.user_profiles
FOR SELECT
USING (
  organisation_id IS NOT NULL
  AND organisation_id IN (
    SELECT om.organisation_id
    FROM public.organisation_members om
    WHERE om.user_id   = auth.uid()
      AND om.status    = 'active'
  )
);
