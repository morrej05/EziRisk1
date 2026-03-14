/*
  # Solo owner/member self-delete workflow (Option A)
  - Adds dedicated secure RPC for sole owner + sole member account deletion.
  - Deactivates organisation as part of the same transaction.
  - Preserves existing generic self-delete/member-removal behavior for all other cases.
*/

CREATE OR REPLACE FUNCTION public.self_delete_solo_owner_account_secure(
  p_confirmation_phrase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_membership RECORD;
  v_owner_count INTEGER;
  v_member_count INTEGER;
  v_expected_phrase CONSTANT TEXT := 'CLOSE ORGANISATION AND DELETE ACCOUNT';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF btrim(COALESCE(p_confirmation_phrase, '')) <> v_expected_phrase THEN
    RAISE EXCEPTION 'Invalid confirmation phrase';
  END IF;

  SELECT om.organisation_id, om.role
  INTO v_membership
  FROM public.organisation_members om
  WHERE om.user_id = v_user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_membership.organisation_id IS NULL THEN
    RAISE EXCEPTION 'Active organisation membership required';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
  FROM public.organisation_members om
  WHERE om.organisation_id = v_membership.organisation_id
    AND om.status = 'active'
    AND om.role = 'owner';

  SELECT COUNT(*) INTO v_member_count
  FROM public.organisation_members om
  WHERE om.organisation_id = v_membership.organisation_id
    AND om.status = 'active';

  IF v_membership.role <> 'owner' OR v_owner_count <> 1 OR v_member_count <> 1 THEN
    RAISE EXCEPTION 'Dedicated self-delete workflow is only valid for sole active owner and sole active member';
  END IF;

  UPDATE public.organisations
  SET subscription_status = 'inactive',
      updated_at = now()
  WHERE id = v_membership.organisation_id;

  UPDATE public.organisation_members
  SET status = 'removed',
      updated_at = now()
  WHERE organisation_id = v_membership.organisation_id
    AND user_id = v_user_id
    AND status = 'active';

  UPDATE public.user_profiles
  SET name = 'Deleted User',
      role = 'viewer',
      can_edit = false,
      organisation_id = NULL,
      is_platform_admin = false
  WHERE id = v_user_id;

  DELETE FROM public.user_legal_acceptances
  WHERE user_id = v_user_id;

  INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
  VALUES (
    v_membership.organisation_id,
    v_user_id,
    v_user_id,
    'account_self_delete_requested',
    jsonb_build_object(
      'strategy', 'solo_owner_close_org_then_auth_delete',
      'organisation_deactivated', true,
      'confirmation_phrase_validated', true,
      'guardrails', jsonb_build_object('sole_owner_count', v_owner_count, 'sole_member_count', v_member_count)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'organisation_id', v_membership.organisation_id,
    'organisation_deactivated', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_delete_solo_owner_account_secure(TEXT) TO authenticated;
