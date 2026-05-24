/*
  Invite-member flow:
  - Adds invited_email column to organisation_members for pending invite display
  - Updates handle_new_user() to create user_profiles for invited users without creating
    an active membership (the edge function creates the invited membership row)
  - Updates ensure_org_for_user() to activate invited memberships before creating new orgs,
    so new users land directly in their invited organisation on first login
*/

ALTER TABLE public.organisation_members
  ADD COLUMN IF NOT EXISTS invited_email TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_profile_org_id UUID;
  v_user_display_name TEXT;
  v_is_invite_flow BOOLEAN;
  v_meta_org_id UUID;
  v_meta_role TEXT;
BEGIN
  v_user_display_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''), NEW.email, 'New User');
  v_is_invite_flow := (NEW.raw_user_meta_data->>'invite_flow') = 'true';

  IF v_is_invite_flow THEN
    -- Invited user: create user_profiles with invited org + role from metadata.
    -- The organisation_members row is created by the invite-org-member edge function.
    v_meta_org_id := (NEW.raw_user_meta_data->>'organisation_id')::UUID;
    v_meta_role := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'role'), ''), 'consultant');

    INSERT INTO public.user_profiles (
      id, role, name, plan, discipline_type, organisation_id, can_edit
    ) VALUES (
      NEW.id,
      v_meta_role,
      v_user_display_name,
      'free',
      'both',
      v_meta_org_id,
      true
    )
    ON CONFLICT (id) DO UPDATE
    SET
      organisation_id = COALESCE(public.user_profiles.organisation_id, EXCLUDED.organisation_id),
      role = CASE
        WHEN public.user_profiles.organisation_id IS NULL THEN v_meta_role
        ELSE public.user_profiles.role
      END;

    RETURN NEW;
  END IF;

  -- Self-serve signup flow (unchanged)
  SELECT up.organisation_id
  INTO v_profile_org_id
  FROM public.user_profiles up
  WHERE up.id = NEW.id;

  IF v_profile_org_id IS NULL THEN
    INSERT INTO public.organisations (
      name, plan_type, plan_id, discipline_type, enabled_addons, max_editors, subscription_status, storage_used_mb
    ) VALUES (
      v_user_display_name || '''s Organisation',
      'free', 'free', 'both', '[]'::jsonb, 0, 'active', 0
    )
    RETURNING id INTO v_org_id;
  ELSE
    v_org_id := v_profile_org_id;
  END IF;

  INSERT INTO public.user_profiles (
    id, role, name, plan, discipline_type, organisation_id, can_edit
  ) VALUES (
    NEW.id, 'admin', v_user_display_name, 'free', 'both', v_org_id, true
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = EXCLUDED.name,
    organisation_id = COALESCE(public.user_profiles.organisation_id, EXCLUDED.organisation_id),
    role = CASE
      WHEN public.user_profiles.organisation_id IS NULL THEN 'admin'
      ELSE public.user_profiles.role
    END,
    can_edit = true;

  SELECT up.organisation_id INTO v_org_id FROM public.user_profiles up WHERE up.id = NEW.id;

  INSERT INTO public.organisation_members (
    id, organisation_id, user_id, role, status, joined_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_org_id, NEW.id, 'admin', 'active', now(), now(), now()
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
  SET role = 'admin', status = 'active', updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_org_for_user(user_id UUID)
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
BEGIN
  IF auth.uid() IS NULL OR user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create organisation for other users';
  END IF;

  -- Activate a pending invitation before falling through to new-org creation.
  -- Only applies when the user has no active membership yet (new invited users).
  SELECT om.organisation_id, om.role
  INTO v_invited_org_id, v_invited_role
  FROM public.organisation_members om
  WHERE om.user_id = ensure_org_for_user.user_id
    AND om.status = 'invited'
  ORDER BY om.created_at DESC
  LIMIT 1;

  IF v_invited_org_id IS NOT NULL THEN
    -- Check there is no existing active membership — if there is, leave it alone.
    SELECT om.organisation_id INTO v_membership_org_id
    FROM public.organisation_members om
    WHERE om.user_id = ensure_org_for_user.user_id AND om.status = 'active'
    LIMIT 1;

    IF v_membership_org_id IS NULL THEN
      -- Activate the invitation (seat limit trigger fires here).
      UPDATE public.organisation_members
      SET status = 'active',
          joined_at = now(),
          updated_at = now()
      WHERE organisation_id = v_invited_org_id
        AND user_id = ensure_org_for_user.user_id
        AND status = 'invited';

      UPDATE public.user_profiles
      SET organisation_id = v_invited_org_id,
          role = v_invited_role,
          can_edit = true
      WHERE id = ensure_org_for_user.user_id;

      RETURN v_invited_org_id;
    END IF;
  END IF;

  -- If membership already exists, prefer that org to avoid creating duplicate organisations.
  SELECT om.organisation_id
  INTO v_membership_org_id
  FROM public.organisation_members om
  WHERE om.user_id = ensure_org_for_user.user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  SELECT up.organisation_id, up.name
  INTO v_org_id, v_user_name
  FROM public.user_profiles up
  WHERE up.id = ensure_org_for_user.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(NULLIF(trim(u.raw_user_meta_data->>'name'), ''), u.email, 'New User')
    INTO v_user_name
    FROM auth.users u
    WHERE u.id = ensure_org_for_user.user_id;

    INSERT INTO public.user_profiles (id, role, name, plan, discipline_type, organisation_id, can_edit)
    VALUES (
      ensure_org_for_user.user_id,
      'admin',
      COALESCE(v_user_name, 'New User'),
      'free',
      'both',
      v_membership_org_id,
      true
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT up.organisation_id, up.name
    INTO v_org_id, v_user_name
    FROM public.user_profiles up
    WHERE up.id = ensure_org_for_user.user_id
    FOR UPDATE;
  END IF;

  IF v_org_id IS NULL AND v_membership_org_id IS NOT NULL THEN
    v_org_id := v_membership_org_id;

    UPDATE public.user_profiles
    SET organisation_id = v_org_id,
        role = 'admin',
        can_edit = true
    WHERE id = ensure_org_for_user.user_id;
  END IF;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organisations (
      name, plan_type, plan_id, discipline_type, enabled_addons, max_editors, subscription_status, storage_used_mb
    ) VALUES (
      COALESCE(v_user_name || '''s Organisation', 'My Organisation'),
      'free', 'free', 'both', '[]'::jsonb, 0, 'active', 0
    )
    RETURNING id INTO v_org_id;

    UPDATE public.user_profiles
    SET organisation_id = v_org_id,
        role = 'admin',
        can_edit = true
    WHERE id = ensure_org_for_user.user_id;
  END IF;

  INSERT INTO public.organisation_members (
    id, organisation_id, user_id, role, status, joined_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    ensure_org_for_user.user_id,
    'admin',
    'active',
    now(),
    now(),
    now()
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
  SET role = 'admin', status = 'active', updated_at = now();

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_org_for_user(UUID) TO authenticated;
