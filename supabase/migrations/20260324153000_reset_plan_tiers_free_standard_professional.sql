/*
  # Reset live plan tiers to free / standard / professional

  - Removes legacy plan mappings from live entitlement functions.
  - Makes organisations.plan_id the sole runtime source of truth for tier.
  - Keeps subscription_status separate from plan_id.
  - Updates data and constraints to canonical plan ids.
*/

-- Canonicalise organisation plan ids.
UPDATE public.organisations
SET plan_id = CASE lower(COALESCE(plan_id, 'free'))
  WHEN 'standard' THEN 'standard'
  WHEN 'professional' THEN 'professional'
  WHEN 'free' THEN 'free'
  WHEN 'trial' THEN 'free'
  WHEN 'basic' THEN 'free'
  WHEN 'solo' THEN 'free'
  WHEN 'core' THEN 'standard'
  WHEN 'team' THEN 'standard'
  WHEN 'consultancy' THEN 'professional'
  WHEN 'pro' THEN 'professional'
  WHEN 'enterprise' THEN 'professional'
  ELSE 'free'
END;

-- Canonicalise profile plan values used by the frontend session context.
UPDATE public.user_profiles
SET plan = CASE lower(COALESCE(plan, 'free'))
  WHEN 'standard' THEN 'standard'
  WHEN 'professional' THEN 'professional'
  WHEN 'free' THEN 'free'
  WHEN 'trial' THEN 'free'
  WHEN 'basic' THEN 'free'
  WHEN 'solo' THEN 'free'
  WHEN 'core' THEN 'standard'
  WHEN 'team' THEN 'standard'
  WHEN 'consultancy' THEN 'professional'
  WHEN 'pro' THEN 'professional'
  WHEN 'enterprise' THEN 'professional'
  ELSE 'free'
END;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_plan_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_plan_check
  CHECK (plan IN ('free', 'standard', 'professional'));

-- Keep referenced plan definitions aligned with canonical ids.
INSERT INTO public.plan_definitions (id, name, max_users, max_storage_mb)
VALUES
  ('free', 'Free', 1, 1024),
  ('standard', 'Standard', 2, 10240),
  ('professional', 'Professional', 5, 51200)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  max_users = EXCLUDED.max_users,
  max_storage_mb = EXCLUDED.max_storage_mb,
  updated_at = now();

DELETE FROM public.plan_definitions
WHERE id NOT IN ('free', 'standard', 'professional');

ALTER TABLE public.organisations
  ALTER COLUMN plan_id SET DEFAULT 'free';

-- Ensure trial timestamps exist for free-tier orgs.
UPDATE public.organisations
SET trial_ends_at = COALESCE(trial_ends_at, created_at + interval '7 days')
WHERE COALESCE(plan_id, 'free') = 'free';

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
    RETURN QUERY SELECT false, 'Organisation not found.', 'free', 5, 0, NULL::timestamptz, false;
    RETURN;
  END IF;

  v_plan := lower(COALESCE(v_org.plan_id, 'free'));

  IF v_plan NOT IN ('free', 'standard', 'professional') THEN
    v_plan := 'free';
  END IF;

  v_limit := CASE v_plan
    WHEN 'professional' THEN 30
    WHEN 'standard' THEN 10
    ELSE 5
  END;

  v_count := public.get_monthly_report_count(p_org_id, p_at);

  v_trial_ends_at := v_org.trial_ends_at;
  IF v_plan = 'free' AND v_trial_ends_at IS NULL THEN
    v_trial_ends_at := COALESCE(v_org.created_at, p_at) + interval '7 days';
  END IF;

  v_trial_expired := v_plan = 'free'
    AND v_trial_ends_at IS NOT NULL
    AND p_at >= v_trial_ends_at;

  IF v_trial_expired THEN
    RETURN QUERY SELECT
      false,
      'Your 7-day free trial has expired. Upgrade to continue creating reports.',
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

CREATE OR REPLACE FUNCTION public.get_user_seat_entitlement(
  p_org_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  resolved_plan text,
  user_limit integer,
  active_member_count integer,
  is_over_limit boolean
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
  v_active_count integer;
BEGIN
  SELECT * INTO v_org
  FROM public.organisations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Organisation not found.', 'free', 1, 0, false;
    RETURN;
  END IF;

  v_plan := lower(COALESCE(v_org.plan_id, 'free'));

  IF v_plan NOT IN ('free', 'standard', 'professional') THEN
    v_plan := 'free';
  END IF;

  v_limit := CASE v_plan
    WHEN 'professional' THEN 5
    WHEN 'standard' THEN 2
    ELSE 1
  END;

  SELECT COUNT(*)::integer INTO v_active_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_org_id
    AND om.status = 'active';

  RETURN QUERY SELECT
    v_active_count < v_limit,
    CASE
      WHEN v_active_count >= v_limit THEN format(
        'You have reached your %s plan user seat limit (%s/%s active users). Upgrade to add more users.',
        v_plan,
        v_active_count,
        v_limit
      )
      ELSE NULL::text
    END,
    v_plan,
    v_limit,
    v_active_count,
    v_active_count > v_limit;
END;
$$;
