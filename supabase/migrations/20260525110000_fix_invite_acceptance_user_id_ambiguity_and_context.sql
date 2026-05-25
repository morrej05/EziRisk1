/*
  Fix invite acceptance reliability and eliminate ambiguous user_id references.

  Why:
    - Invite acceptance intermittently failed with "column reference user_id is ambiguous".
    - When acceptance failed, frontend could still navigate to dashboard, and normal
      bootstrap path could create/select a fallback personal trial org.

  What:
    - Recreate ensure_org_for_user with a parameter name (p_user_id) that cannot
      collide with table columns.
    - Fully qualify all user_id references in SQL statements.
    - Keep invite activation first, set user_profiles.organisation_id to inviter org,
      and return early so no fallback org creation happens for invited users.
*/

CREATE OR REPLACE FUNCTION public.ensure_org_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_membership_org_id UUID;
  v_user_name TEXT;
  v_invited_org_id UUID;
  v_invited_role TEXT;
  v_already_active UUID;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create organisation for other users';
  END IF;

  SELECT om.organisation_id, om.role
  INTO v_invited_org_id, v_invited_role
  FROM public.organisation_members AS om
  WHERE om.user_id = p_user_id
    AND om.status = 'invited'
  ORDER BY om.created_at DESC
  LIMIT 1;

  IF v_invited_org_id IS NOT NULL THEN
    SELECT om.organisation_id
    INTO v_already_active
    FROM public.organisation_members AS om
    WHERE om.user_id = p_user_id
      AND om.organisation_id = v_invited_org_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_already_active IS NULL THEN
      UPDATE public.organisation_members AS om
      SET status = 'active',
          joined_at = now(),
          updated_at = now()
      WHERE om.organisation_id = v_invited_org_id
        AND om.user_id = p_user_id
        AND om.status = 'invited';

      UPDATE public.user_profiles AS up
      SET organisation_id = v_invited_org_id,
          role = v_invited_role,
          can_edit = true
      WHERE up.id = p_user_id;

      RETURN v_invited_org_id;
    END IF;

    UPDATE public.user_profiles AS up
    SET organisation_id = v_invited_org_id,
        role = COALESCE(v_invited_role, up.role),
        can_edit = true
    WHERE up.id = p_user_id
      AND up.organisation_id IS DISTINCT FROM v_invited_org_id;

    RETURN v_invited_org_id;
  END IF;

  SELECT om.organisation_id
  INTO v_membership_org_id
  FROM public.organisation_members AS om
  WHERE om.user_id = p_user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  SELECT up.organisation_id, up.name
  INTO v_org_id, v_user_name
  FROM public.user_profiles AS up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(NULLIF(trim(u.raw_user_meta_data->>'name'), ''), u.email, 'New User')
    INTO v_user_name
    FROM auth.users AS u
    WHERE u.id = p_user_id;

    INSERT INTO public.user_profiles (id, role, name, plan, discipline_type, organisation_id, can_edit)
    VALUES (p_user_id, 'admin', COALESCE(v_user_name, 'New User'), 'free', 'both', v_membership_org_id, true)
    ON CONFLICT (id) DO NOTHING;

    SELECT up.organisation_id, up.name
    INTO v_org_id, v_user_name
    FROM public.user_profiles AS up
    WHERE up.id = p_user_id
    FOR UPDATE;
  END IF;

  IF v_org_id IS NULL AND v_membership_org_id IS NOT NULL THEN
    v_org_id := v_membership_org_id;
    UPDATE public.user_profiles AS up
    SET organisation_id = v_org_id,
        role = 'admin',
        can_edit = true
    WHERE up.id = p_user_id;
  END IF;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  INSERT INTO public.organisations (
    name, plan_type, plan_id, discipline_type, enabled_addons,
    max_editors, subscription_status, storage_used_mb
  ) VALUES (
    COALESCE(v_user_name || '''s Organisation', 'My Organisation'),
    'free', 'free', 'both', '[]'::jsonb, 0, 'active', 0
  )
  RETURNING id INTO v_org_id;

  UPDATE public.user_profiles AS up
  SET organisation_id = v_org_id,
      role = 'admin',
      can_edit = true
  WHERE up.id = p_user_id;

  INSERT INTO public.organisation_members (
    id, organisation_id, user_id, role, status, joined_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    p_user_id,
    'admin',
    'active',
    now(), now(), now()
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
  SET role = 'admin', status = 'active', updated_at = now();

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_org_for_user(UUID) TO authenticated;
