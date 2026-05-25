/*
  Fix ensure_org_for_user() to activate pending invitations even when the user
  already has an active membership in another organisation.

  Root cause:
    The previous implementation guarded the invite-activation block with
    "IF v_membership_org_id IS NULL" — meaning if the invitee already belonged
    to any org, their pending invite to the NEW org was silently skipped and
    they remained on their old org after accepting.

  Fix:
    Remove the guard.  When a pending invite exists, activate it unconditionally
    (as long as there is not already an active membership in THAT SAME org).
    The user's existing active memberships in other orgs are left untouched.

  Side-effect / intentional behaviour change:
    A user invited to org B while already a member of org A will now have TWO
    active memberships.  AuthContext resolves membership by user_profiles.
    organisation_id; the dashboard will continue to show org A until the user
    explicitly switches context (a future feature).  What matters for correctness
    is that the membership row exists so RLS, seat counts, and admin views all
    reflect reality.
*/

CREATE OR REPLACE FUNCTION public.ensure_org_for_user(user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id              UUID;
  v_membership_org_id   UUID;
  v_user_name           TEXT;
  v_invited_org_id      UUID;
  v_invited_role        TEXT;
  v_already_active      UUID;
BEGIN
  IF auth.uid() IS NULL OR user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create organisation for other users';
  END IF;

  -- ── Activate the most-recent pending invitation, if any ──────────────────
  -- This runs regardless of whether the user already has another active
  -- membership — being in org A does not prevent being activated into org B.
  SELECT om.organisation_id, om.role
  INTO v_invited_org_id, v_invited_role
  FROM public.organisation_members om
  WHERE om.user_id = ensure_org_for_user.user_id
    AND om.status  = 'invited'
  ORDER BY om.created_at DESC
  LIMIT 1;

  IF v_invited_org_id IS NOT NULL THEN
    -- Guard: do not activate if an active row already exists for THIS org
    -- (e.g. a race condition where the user somehow got activated already).
    SELECT om.organisation_id
    INTO v_already_active
    FROM public.organisation_members om
    WHERE om.user_id        = ensure_org_for_user.user_id
      AND om.organisation_id = v_invited_org_id
      AND om.status          = 'active'
    LIMIT 1;

    IF v_already_active IS NULL THEN
      -- Activate the invited membership (seat-limit trigger fires here).
      UPDATE public.organisation_members
      SET status    = 'active',
          joined_at = now(),
          updated_at = now()
      WHERE organisation_id = v_invited_org_id
        AND user_id          = ensure_org_for_user.user_id
        AND status           = 'invited';

      -- Point user_profiles at the invited org so AuthContext loads the right
      -- organisation on first login.  For users who already belong to another
      -- org this overwrites their profile org; if multi-org switching is added
      -- later this can be revisited.
      UPDATE public.user_profiles
      SET organisation_id = v_invited_org_id,
          role            = v_invited_role,
          can_edit        = true
      WHERE id = ensure_org_for_user.user_id;

      RETURN v_invited_org_id;
    END IF;
  END IF;

  -- ── No pending invite — return existing active membership org ─────────────
  SELECT om.organisation_id
  INTO v_membership_org_id
  FROM public.organisation_members om
  WHERE om.user_id = ensure_org_for_user.user_id
    AND om.status  = 'active'
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
        role            = 'admin',
        can_edit        = true
    WHERE id = ensure_org_for_user.user_id;
  END IF;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  -- ── No org at all — create a personal organisation ────────────────────────
  INSERT INTO public.organisations (
    name, plan_type, plan_id, discipline_type, enabled_addons,
    max_editors, subscription_status, storage_used_mb
  ) VALUES (
    COALESCE(v_user_name || '''s Organisation', 'My Organisation'),
    'free', 'free', 'both', '[]'::jsonb, 0, 'active', 0
  )
  RETURNING id INTO v_org_id;

  UPDATE public.user_profiles
  SET organisation_id = v_org_id,
      role            = 'admin',
      can_edit        = true
  WHERE id = ensure_org_for_user.user_id;

  INSERT INTO public.organisation_members (
    id, organisation_id, user_id, role, status, joined_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    ensure_org_for_user.user_id,
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
