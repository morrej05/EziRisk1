/*
  # Remove surveyor from user_profiles.role allowed values (fail-fast)
  - Preconditions: no user_profiles rows remain with role='surveyor'
  - If rows still exist, migration aborts with a blocking error.
*/

DO $$
DECLARE
  surveyor_count integer;
BEGIN
  SELECT COUNT(*) INTO surveyor_count
  FROM public.user_profiles
  WHERE role = 'surveyor';

  IF surveyor_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove surveyor from user_profiles role constraint; % blocking row(s) remain in public.user_profiles.role=''surveyor''.', surveyor_count;
  END IF;
END $$;

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('owner', 'admin', 'consultant', 'viewer'));
