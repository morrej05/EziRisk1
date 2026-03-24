/*
  # Add single-argument wrapper for get_user_seat_entitlement RPC

  - Ensures PostgREST can resolve rpc('get_user_seat_entitlement', { p_org_id }) consistently.
  - Keeps existing two-argument implementation intact.
  - Grants execute to authenticated users and requests schema cache reload.
*/

CREATE OR REPLACE FUNCTION public.get_user_seat_entitlement(
  p_org_id uuid
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  resolved_plan text,
  user_limit integer,
  active_member_count integer,
  is_over_limit boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT *
  FROM public.get_user_seat_entitlement(p_org_id, now());
$$;

GRANT EXECUTE ON FUNCTION public.get_user_seat_entitlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_seat_entitlement(uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
