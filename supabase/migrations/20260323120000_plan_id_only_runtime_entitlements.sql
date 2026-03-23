/*
  # Enforce runtime entitlements strictly from organisations.plan_id

  - Removes legacy plan_type fallback from report creation entitlement resolution.
  - Removes legacy plan_type fallback from user seat entitlement resolution.
  - Keeps existing plan mappings and limits unchanged.
*/

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

  v_plan := lower(COALESCE(v_org.plan_id, 'trial'));

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
  v_count integer;
BEGIN
  SELECT * INTO v_org
  FROM public.organisations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Organisation not found.', 'trial', 1, 0, false;
    RETURN;
  END IF;

  v_plan := lower(COALESCE(v_org.plan_id, 'trial'));

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
    WHEN 'professional' THEN 5
    WHEN 'standard' THEN 2
    ELSE 1
  END;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_org_id
    AND om.status = 'active';

  IF v_count > v_limit THEN
    RETURN QUERY SELECT
      false,
      format(
        'Your organisation is over the %s plan user seat limit (%s/%s active users). Remove users or upgrade before adding more.',
        v_plan,
        v_count,
        v_limit
      ),
      v_plan,
      v_limit,
      v_count,
      true;
    RETURN;
  END IF;

  IF v_count >= v_limit THEN
    RETURN QUERY SELECT
      false,
      format(
        'You have reached your %s plan user seat limit (%s/%s active users). Upgrade to add more users.',
        v_plan,
        v_count,
        v_limit
      ),
      v_plan,
      v_limit,
      v_count,
      false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    NULL::text,
    v_plan,
    v_limit,
    v_count,
    false;
END;
$$;
