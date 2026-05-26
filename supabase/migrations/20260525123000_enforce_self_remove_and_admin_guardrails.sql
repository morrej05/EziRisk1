CREATE OR REPLACE FUNCTION public.remove_org_member_secure(
  p_organisation_id UUID,
  p_target_user_id UUID,
  p_transfer_to_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_owner_count INTEGER;
  v_member_count INTEGER;
  v_transfer_role TEXT;
  v_admin_or_owner_count INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'You cannot remove yourself from this organisation.';
  END IF;

  SELECT om.role INTO v_actor_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = v_actor_id
    AND om.status = 'active'
  LIMIT 1;

  SELECT om.role INTO v_target_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = p_target_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not an active member of this organisation';
  END IF;

  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient privileges to remove members';
  END IF;

  IF v_actor_role = 'admin' AND v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Only owners may remove owners';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.status = 'active'
    AND om.role = 'owner';

  SELECT COUNT(*) INTO v_admin_or_owner_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.status = 'active'
    AND om.role IN ('owner', 'admin');

  IF v_target_role IN ('owner', 'admin') AND v_admin_or_owner_count <= 1 THEN
    RAISE EXCEPTION 'An organisation must have at least one admin.';
  END IF;

  SELECT COUNT(*) INTO v_member_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.status = 'active';

  IF v_target_role = 'owner' AND v_owner_count <= 1 THEN
    IF p_transfer_to_user_id IS NULL THEN
      RAISE EXCEPTION 'Cannot remove sole owner without ownership transfer';
    END IF;

    SELECT om.role INTO v_transfer_role
    FROM public.organisation_members om
    WHERE om.organisation_id = p_organisation_id
      AND om.user_id = p_transfer_to_user_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_transfer_role IS NULL THEN
      RAISE EXCEPTION 'Transfer target must be an active organisation member';
    END IF;

    UPDATE public.organisation_members
    SET role = 'owner', updated_at = now()
    WHERE organisation_id = p_organisation_id
      AND user_id = p_transfer_to_user_id
      AND status = 'active';

    INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
    VALUES (
      p_organisation_id,
      v_actor_id,
      p_target_user_id,
      'ownership_transferred',
      jsonb_build_object('from_user_id', p_target_user_id, 'to_user_id', p_transfer_to_user_id, 'trigger', 'member_removal_guardrail')
    );
  END IF;

  IF v_member_count <= 1 THEN
    RAISE EXCEPTION 'Cannot remove last active organisation member';
  END IF;

  UPDATE public.organisation_members
  SET status = 'removed', updated_at = now()
  WHERE organisation_id = p_organisation_id
    AND user_id = p_target_user_id
    AND status = 'active';

  UPDATE public.user_profiles up
  SET organisation_id = NULL,
      role = 'viewer',
      can_edit = false
  WHERE up.id = p_target_user_id
    AND up.organisation_id = p_organisation_id
    AND NOT EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = up.id
        AND om.status = 'active'
    );

  INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
  VALUES (
    p_organisation_id,
    v_actor_id,
    p_target_user_id,
    'member_removed',
    jsonb_build_object('actor_role', v_actor_role, 'target_role', v_target_role, 'is_self_remove', false)
  );

  RETURN jsonb_build_object('ok', true, 'organisation_id', p_organisation_id, 'target_user_id', p_target_user_id);
END;
$$;
