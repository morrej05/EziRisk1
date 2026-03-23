/*
  # Enforce hard per-plan active user seat limits

  - Adds central entitlement function driven by organisations.plan_id.
  - Enforces limits in organisation_members insert/update paths.
  - Supports downgrade-over-limit behavior by only blocking net-new active seats.
*/

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

CREATE OR REPLACE FUNCTION public.enforce_org_member_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement record;
  v_requires_check boolean;
BEGIN
  v_requires_check := NEW.status = 'active';

  IF TG_OP = 'UPDATE' THEN
    -- Pure updates that do not create a new active seat should always pass.
    IF OLD.status = 'active'
      AND NEW.status = 'active'
      AND OLD.organisation_id = NEW.organisation_id
      AND OLD.user_id = NEW.user_id THEN
      RETURN NEW;
    END IF;

    -- Seat check is required when activating a user or moving an active seat to another org/user.
    v_requires_check := NEW.status = 'active'
      AND (
        OLD.status IS DISTINCT FROM 'active'
        OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id
        OR OLD.user_id IS DISTINCT FROM NEW.user_id
      );
  END IF;

  IF NOT v_requires_check THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_entitlement
  FROM public.get_user_seat_entitlement(NEW.organisation_id, p_at => now());

  IF COALESCE(v_entitlement.allowed, false) = false THEN
    RAISE EXCEPTION '%', COALESCE(v_entitlement.reason, 'User seat limit reached for this organisation.')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_org_member_seat_limit ON public.organisation_members;
CREATE TRIGGER trigger_enforce_org_member_seat_limit
  BEFORE INSERT OR UPDATE OF organisation_id, user_id, status
  ON public.organisation_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_member_seat_limit();

GRANT EXECUTE ON FUNCTION public.get_user_seat_entitlement(uuid, timestamptz) TO authenticated;
