/*
  # Phase 9 — Platform Admin Elevation via super_admins Table

  Replaces the self-referential user_profiles UPDATE policy that controlled
  who can set is_platform_admin = true on other users' profiles.

  Before: the policy queried user_profiles for the caller's own row and checked
  (role = 'admin' AND is_platform_admin = true). This is a self-referential
  trust model — anyone who already has is_platform_admin = true in user_profiles
  can grant the flag to others, including themselves after a compromise.

  After: the policy queries the super_admins table, which is the canonical
  authority for platform admin status. The super_admins table was created in
  migration 20260117160636 and has its own RLS (only existing super_admins can
  insert/delete). This eliminates the circular trust.

  Scope: only the user_profiles UPDATE elevation policy is changed here.
  The is_platform_admin column itself is preserved for now; it may be removed
  in a future migration once all callers have been verified to use super_admins
  directly.
*/

-- Drop the self-referential platform admin elevation policy
DROP POLICY IF EXISTS "Platform admins can update platform admin status" ON public.user_profiles;

-- New policy: only users in the super_admins table can update
-- is_platform_admin on any user_profiles row
CREATE POLICY "Platform admins can update platform admin status"
ON public.user_profiles FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.super_admins sa
    WHERE sa.id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.super_admins sa
    WHERE sa.id = auth.uid()
  )
);
