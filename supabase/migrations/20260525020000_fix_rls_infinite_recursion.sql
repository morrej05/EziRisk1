/*
  Fix infinite-recursion 500 errors caused by self-referential RLS policies
  introduced in migration 20260525010000.

  Root cause:
    The "org members can read all org memberships" policy on organisation_members
    contained a sub-SELECT that queried organisation_members itself:

      EXISTS (SELECT 1 FROM organisation_members my_membership WHERE ...)

    PostgreSQL evaluates the RLS policy for every row access, including the
    sub-SELECT, which re-evaluates the policy, which re-runs the sub-SELECT,
    producing infinite recursion and a 500 error on every REST API call that
    touches either table.

    The "org members can read org profiles" policy on user_profiles joined
    organisation_members directly, which triggered the recursive policy there
    as well.

  Fix:
    Use a SECURITY DEFINER function (current_user_org_ids) that queries
    organisation_members with the privileges of its owner (postgres, which has
    BYPASSRLS).  The inner query therefore bypasses RLS entirely, breaking the
    cycle.  Both policies now call this function rather than issuing inline
    sub-SELECTs against the same table.

  Applied to production on 2026-05-25 as an emergency patch.
  This migration records what is currently live.
*/

-- ── Helper function ───────────────────────────────────────────────────────────

-- Returns the set of organisation_ids the calling user is an active member of.
-- SECURITY DEFINER so the inner query runs as the function owner (postgres /
-- BYPASSRLS) and does not recursively trigger the RLS policy on the same table.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organisation_id
  FROM public.organisation_members
  WHERE user_id  = auth.uid()
    AND status   = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated, anon;

-- ── organisation_members ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "org members can read all org memberships" ON public.organisation_members;

CREATE POLICY "org members can read all org memberships"
ON public.organisation_members
FOR SELECT
USING (
  organisation_id IN (SELECT public.current_user_org_ids())
);

-- ── user_profiles ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "org members can read org profiles" ON public.user_profiles;

CREATE POLICY "org members can read org profiles"
ON public.user_profiles
FOR SELECT
USING (
  organisation_id IS NOT NULL
  AND organisation_id IN (SELECT public.current_user_org_ids())
);
