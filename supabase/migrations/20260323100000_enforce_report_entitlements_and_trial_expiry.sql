/*
  # Enforce hard report creation entitlements and 7-day trial expiry

  - Adds organisations.trial_ends_at for explicit trial expiry timestamps.
  - Centralises monthly report counting by organisation + calendar month.
  - Enforces hard limits in a BEFORE INSERT trigger on documents.
  - Ensures signup/bootstrap paths assign trial plan with 7-day expiry.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Backfill explicit expiry for existing trial organisations.
UPDATE public.organisations
SET trial_ends_at = COALESCE(trial_ends_at, created_at + interval '7 days')
WHERE (COALESCE(plan_id, plan_type) IN ('trial', 'free', 'solo'));

CREATE OR REPLACE FUNCTION public.get_monthly_report_count(
  p_org_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM public.documents d
  WHERE d.organisation_id = p_org_id
    AND d.created_at >= date_trunc('month', p_at)
    AND d.created_at < (date_trunc('month', p_at) + interval '1 month');
$$;

CREATE OR REPLACE FUNCTION public.get_report_creation_entitlement(
  p_org_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  resolved_plan text,
  monthly_report_limit integer,
  monthly_report_count integer,
  trial_ends_at timestamptz,
  is_trial_expired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org public.organisations%ROWTYPE;
  v_plan text;
  v_limit integer;
  v_count integer;
  v_trial_ends_at timestamptz;
  v_trial_expired boolean;
BEGIN
  SELECT * INTO v_org
  FROM public.organisations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Organisation not found.', 'trial', 5, 0, NULL::timestamptz, false;
    RETURN;
  END IF;

  v_plan := lower(COALESCE(v_org.plan_id, v_org.plan_type, 'trial'));

  IF v_plan IN ('core') THEN
    v_plan := 'standard';
  ELSIF v_plan IN ('pro', 'team', 'enterprise', 'consultancy') THEN
    v_plan := 'professional';
  ELSIF v_plan IN ('free', 'solo') THEN
    v_plan := 'trial';
  ELSIF v_plan NOT IN ('trial', 'standard', 'professional') THEN
    v_plan := 'trial';
  END IF;

  v_limit := CASE v_plan
    WHEN 'professional' THEN 30
    WHEN 'standard' THEN 10
    ELSE 5
  END;

  v_count := public.get_monthly_report_count(p_org_id, p_at);

  v_trial_ends_at := v_org.trial_ends_at;
  IF v_plan = 'trial' AND v_trial_ends_at IS NULL THEN
    v_trial_ends_at := COALESCE(v_org.created_at, p_at) + interval '7 days';
  END IF;

  v_trial_expired := v_plan = 'trial'
    AND v_trial_ends_at IS NOT NULL
    AND p_at >= v_trial_ends_at;

  IF v_trial_expired THEN
    RETURN QUERY SELECT
      false,
      'Your 7-day trial has expired. Upgrade to continue creating reports.',
      v_plan,
      v_limit,
      v_count,
      v_trial_ends_at,
      true;
    RETURN;
  END IF;

  IF v_count >= v_limit THEN
    RETURN QUERY SELECT
      false,
      format('You have reached your %s plan limit of %s reports for this month. Upgrade to continue creating reports.', v_plan, v_limit),
      v_plan,
      v_limit,
      v_count,
      v_trial_ends_at,
      v_trial_expired;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    NULL::text,
    v_plan,
    v_limit,
    v_count,
    v_trial_ends_at,
    v_trial_expired;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_document_creation_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement record;
BEGIN
  SELECT * INTO v_entitlement
  FROM public.get_report_creation_entitlement(NEW.organisation_id, now());

  IF COALESCE(v_entitlement.allowed, false) = false THEN
    RAISE EXCEPTION '%', COALESCE(v_entitlement.reason, 'Report creation is not allowed for this organisation.')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_document_creation_entitlements ON public.documents;
CREATE TRIGGER trigger_enforce_document_creation_entitlements
  BEFORE INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_creation_entitlements();

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

  SELECT up.organisation_id
  INTO v_profile_org_id
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
      storage_used_mb,
      trial_ends_at
    ) VALUES (
      v_user_display_name || '''s Organisation',
      'trial',
      'trial',
      'both',
      '[]'::jsonb,
      1,
      'trialing',
      0,
      now() + interval '7 days'
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
    'trial',
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

  SELECT up.organisation_id
  INTO v_org_id
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
  v_membership_org_id UUID;
  v_user_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create organisation for other users';
  END IF;

  SELECT om.organisation_id
  INTO v_membership_org_id
  FROM public.organisation_members om
  WHERE om.user_id = user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

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
    VALUES (
      user_id,
      'admin',
      COALESCE(v_user_name, 'New User'),
      'trial',
      'both',
      v_membership_org_id,
      true
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT up.organisation_id, up.name
    INTO v_org_id, v_user_name
    FROM public.user_profiles up
    WHERE up.id = user_id
    FOR UPDATE;
  END IF;

  IF v_org_id IS NULL AND v_membership_org_id IS NOT NULL THEN
    v_org_id := v_membership_org_id;

    UPDATE public.user_profiles
    SET organisation_id = v_org_id,
        role = 'admin',
        can_edit = true
    WHERE id = user_id;
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
      storage_used_mb,
      trial_ends_at
    ) VALUES (
      COALESCE(v_user_name || '''s Organisation', 'My Organisation'),
      'trial',
      'trial',
      'both',
      '[]'::jsonb,
      1,
      'trialing',
      0,
      now() + interval '7 days'
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

GRANT EXECUTE ON FUNCTION public.get_monthly_report_count(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_creation_entitlement(uuid, timestamptz) TO authenticated;
