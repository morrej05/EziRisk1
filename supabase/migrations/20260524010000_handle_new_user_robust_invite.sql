/*
  # Harden handle_new_user() for invite flow reliability

  Root causes of "Database error saving new user" from inviteUserByEmail:

  1. Unguarded UUID cast — `(raw_user_meta_data->>'organisation_id')::UUID` raises
     an exception for any non-UUID value (empty string, null-ish content, etc.).
     PostgreSQL does not coerce bad UUID strings to NULL; it throws.

  2. No exception handling anywhere — any PL/pgSQL RAISE inside the trigger
     propagates to GoTrue, which maps it to "Database error saving new user"
     and rolls back the auth.users INSERT. The user never gets created.

  3. Role not normalised in trigger — if 'surveyor' reaches the INSERT
     (e.g. older client, re-invite after schema change), the
     user_profiles_role_check constraint fires and kills the trigger.

  4. ON CONFLICT DO UPDATE omitted plan — if an existing user_profiles row
     carries plan='trial' (the column's original DEFAULT, now invalid per the
     20260324153000 constraint reset), the UPDATE re-evaluates CHECK constraints
     against the stale value and raises a violation.

  Fixes:
  - UUID cast is now wrapped in its own inner BEGIN/EXCEPTION.
  - Role is normalised through a CASE expression; 'surveyor' → 'consultant'.
  - ON CONFLICT DO UPDATE now also sets plan = 'free' to repair stale defaults.
  - The entire invite-flow path and the self-serve path each have their own
    EXCEPTION WHEN OTHERS handler that RAISE LOGs the error and continues,
    so auth.users INSERT always succeeds.
  - RAISE LOG at key decision points for visibility in Supabase DB logs.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id             UUID;
  v_profile_org_id     UUID;
  v_user_display_name  TEXT;
  v_is_invite_flow     BOOLEAN;
  v_meta_org_id        UUID;
  v_meta_role          TEXT;
BEGIN
  v_user_display_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    NEW.email,
    'New User'
  );

  v_is_invite_flow := (NEW.raw_user_meta_data->>'invite_flow') = 'true';

  -- ──────────────────────────────────────────────────────────────────────────
  -- INVITE FLOW
  -- The organisation_members row is created by the invite-org-member Edge
  -- Function after inviteUserByEmail returns.  The trigger's only job here is
  -- to materialise a user_profiles row so the new user has a profile ready.
  -- ──────────────────────────────────────────────────────────────────────────
  IF v_is_invite_flow THEN
    BEGIN

      -- Safe UUID cast — a bad value logs and falls back to NULL rather than
      -- raising an exception that would block auth.users INSERT.
      BEGIN
        v_meta_org_id := (NEW.raw_user_meta_data->>'organisation_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG '[handle_new_user] invite flow: bad organisation_id "%" for user %: %',
          NEW.raw_user_meta_data->>'organisation_id', NEW.id, SQLERRM;
        v_meta_org_id := NULL;
      END;

      -- Normalise role: map legacy/UI values to the DB-valid set.
      -- 'surveyor' is the UI label for the DB value 'consultant'.
      v_meta_role := CASE lower(COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'role'), ''), ''))
        WHEN 'owner'      THEN 'owner'
        WHEN 'admin'      THEN 'admin'
        WHEN 'consultant' THEN 'consultant'
        WHEN 'surveyor'   THEN 'consultant'   -- UI alias
        WHEN 'viewer'     THEN 'viewer'
        ELSE                   'consultant'   -- safe default
      END;

      RAISE LOG '[handle_new_user] invite flow: user=%, org=%, role=%',
        NEW.id, v_meta_org_id, v_meta_role;

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
        -- Repair stale plan values (original column DEFAULT was 'trial',
        -- which is no longer allowed by user_profiles_plan_check).
        plan            = 'free',
        organisation_id = COALESCE(public.user_profiles.organisation_id, EXCLUDED.organisation_id),
        role            = CASE
          WHEN public.user_profiles.organisation_id IS NULL THEN v_meta_role
          ELSE public.user_profiles.role
        END;

    EXCEPTION WHEN OTHERS THEN
      -- Log but do NOT re-raise — auth.users INSERT must always succeed.
      RAISE LOG '[handle_new_user] invite flow failed for user % (SQLSTATE %): %',
        NEW.id, SQLSTATE, SQLERRM;
    END;

    RETURN NEW;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- SELF-SERVE SIGNUP FLOW
  -- Creates a personal organisation, user_profiles row, and an active
  -- organisation_members row for the new owner/admin.
  -- ──────────────────────────────────────────────────────────────────────────
  BEGIN

    SELECT up.organisation_id
    INTO v_profile_org_id
    FROM public.user_profiles up
    WHERE up.id = NEW.id;

    IF v_profile_org_id IS NULL THEN
      INSERT INTO public.organisations (
        name, plan_type, plan_id, discipline_type, enabled_addons,
        max_editors, subscription_status, storage_used_mb
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
      name            = EXCLUDED.name,
      plan            = 'free',
      organisation_id = COALESCE(public.user_profiles.organisation_id, EXCLUDED.organisation_id),
      role            = CASE
        WHEN public.user_profiles.organisation_id IS NULL THEN 'admin'
        ELSE public.user_profiles.role
      END,
      can_edit        = true;

    SELECT up.organisation_id
    INTO v_org_id
    FROM public.user_profiles up
    WHERE up.id = NEW.id;

    INSERT INTO public.organisation_members (
      id, organisation_id, user_id, role, status, joined_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_org_id, NEW.id, 'admin', 'active', now(), now(), now()
    )
    ON CONFLICT (organisation_id, user_id) DO UPDATE
    SET role = 'admin', status = 'active', updated_at = now();

  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[handle_new_user] self-serve flow failed for user % (SQLSTATE %): %',
      NEW.id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
