/*
  # Fix signup/bootstrap organisation membership integrity

  - Ensure handle_new_user() always creates profile + organisation + active admin membership for self-serve signup.
  - Ensure ensure_org_for_user() heals missing membership (and missing profile/org) without creating duplicates.
  - Ensure organisation_members.id is always explicitly written during bootstrap/heal and has a table default.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organisation_members
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

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
BEGIN
  v_user_display_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''), NEW.email, 'New User');

  SELECT up.organisation_id INTO v_profile_org_id
  FROM public.user_profiles up
  WHERE up.id = NEW.id;

  IF v_profile_org_id IS NULL THEN
    INSERT INTO public.organisations (
      name,
      plan_type,
      plan_id,
      discipline_type,
      enabled_addons,
      max_editors,
      subscription_status,
      storage_used_mb
    ) VALUES (
      v_user_display_name || '''s Organisation',
      'free',
      'solo',
      'both',
      '[]'::jsonb,
      0,
      'active',
      0
    )
    RETURNING id INTO v_org_id;
  ELSE
    v_org_id := v_profile_org_id;
  END IF;

  INSERT INTO public.user_profiles (
    id,
    role,
    name,
    plan,
    discipline_type,
    organisation_id,
    can_edit
  ) VALUES (
    NEW.id,
    'admin',
    v_user_display_name,
    'free',
    'both',
    v_org_id,
    true
  )
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      organisation_id = COALESCE(public.user_profiles.organisation_id, EXCLUDED.organisation_id),
      role = CASE
        WHEN public.user_profiles.organisation_id IS NULL THEN 'admin'
        ELSE public.user_profiles.role
      END,
      can_edit = true;

  SELECT up.organisation_id INTO v_org_id
  FROM public.user_profiles up
  WHERE up.id = NEW.id;

  INSERT INTO public.organisation_members (
    id,
    organisation_id,
    user_id,
    role,
    status,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    NEW.id,
    'admin',
    'active',
    now(),
    now(),
    now()
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
  SET role = 'admin',
      status = 'active',
      updated_at = now();

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
  v_user_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create organisation for other users';
  END IF;

  SELECT up.organisation_id, up.name
  INTO v_org_id, v_user_name
  FROM public.user_profiles up
  WHERE up.id = user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(NULLIF(trim(u.raw_user_meta_data->>'name'), ''), u.email, 'New User')
    INTO v_user_name
    FROM auth.users u
    WHERE u.id = user_id;

    INSERT INTO public.user_profiles (id, role, name, plan, discipline_type, organisation_id, can_edit)
    VALUES (user_id, 'admin', COALESCE(v_user_name, 'New User'), 'free', 'both', NULL, true)
    ON CONFLICT (id) DO NOTHING;

    SELECT up.organisation_id, up.name
    INTO v_org_id, v_user_name
    FROM public.user_profiles up
    WHERE up.id = user_id
    FOR UPDATE;
  END IF;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organisations (
      name,
      plan_type,
      plan_id,
      discipline_type,
      enabled_addons,
      max_editors,
      subscription_status,
      storage_used_mb
    ) VALUES (
      COALESCE(v_user_name || '''s Organisation', 'My Organisation'),
      'free',
      'solo',
      'both',
      '[]'::jsonb,
      0,
      'active',
      0
    )
    RETURNING id INTO v_org_id;

    UPDATE public.user_profiles
    SET organisation_id = v_org_id,
        role = 'admin',
        can_edit = true
    WHERE id = user_id;
  END IF;

  INSERT INTO public.organisation_members (
    id,
    organisation_id,
    user_id,
    role,
    status,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    user_id,
    'admin',
    'active',
    now(),
    now(),
    now()
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
  SET role = 'admin',
      status = 'active',
      updated_at = now();

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_org_for_user(UUID) TO authenticated;
