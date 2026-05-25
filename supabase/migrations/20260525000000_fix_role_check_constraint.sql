/*
  Fix user_profiles_role_check constraint to include 'consultant' and 'owner'.

  Root cause:
    Migration 20260315100000_remove_surveyor_from_user_profiles_role_check.sql was
    recorded as applied in the migration tracking table but was never actually executed
    against the live database.  The constraint on disk remained the original definition
    from 20260118143603, which only allowed ('admin', 'surveyor', 'viewer').

  Impact:
    handle_new_user() trigger inserts user_profiles with role='consultant' for invited
    users.  The stale constraint raised a check_violation (23514) which the trigger's
    EXCEPTION handler swallowed silently — so no user_profiles row was ever created for
    invited users, causing AuthContext to reject them at login with "User profile not
    found."

  Fix:
    Replace the constraint with the intended definition that includes all valid roles.
    'surveyor' is intentionally omitted — it was an interim value removed in the schema
    evolution and is no longer a valid role.  AuthContext.normalizeRole() maps the
    legacy 'surveyor' value to 'consultant' at runtime for any rows that may exist.

  Applied directly to production via Management API on 2026-05-25 before this
  migration was written.  This file records the change so the migration tracker stays
  aligned with the live schema.  Do NOT run this migration against the production
  database again — the constraint is already in place.
*/

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('owner', 'admin', 'consultant', 'viewer'));
