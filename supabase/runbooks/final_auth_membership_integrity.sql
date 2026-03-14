-- Final auth launch verification: membership integrity checks
-- Run manually in Supabase SQL editor against production/staging before final launch sign-off.

-- 1) Users with profile org but no active membership (must be zero)
SELECT
  up.id AS user_id,
  up.email,
  up.organisation_id AS profile_organisation_id
FROM public.user_profiles up
WHERE up.organisation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.user_id = up.id
      AND om.organisation_id = up.organisation_id
      AND om.status = 'active'
  )
ORDER BY up.email;

-- 2) Organisations with no active owner (must be zero)
SELECT
  o.id AS organisation_id,
  o.name
FROM public.organisations o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organisation_members om
  WHERE om.organisation_id = o.id
    AND om.status = 'active'
    AND om.role = 'owner'
)
ORDER BY o.name;

-- 3a) Invalid organisation member role values (must be zero)
SELECT
  om.id,
  om.user_id,
  om.organisation_id,
  om.role
FROM public.organisation_members om
WHERE om.role NOT IN ('owner', 'admin', 'consultant', 'viewer')
ORDER BY om.organisation_id, om.user_id;

-- 3b) Invalid organisation member status values (must be zero)
SELECT
  om.id,
  om.user_id,
  om.organisation_id,
  om.status
FROM public.organisation_members om
WHERE om.status NOT IN ('active', 'invited', 'suspended', 'removed')
ORDER BY om.organisation_id, om.user_id;

-- 4) Remaining surveyor user_profile rows (must be zero before removing from constraint)
SELECT
  up.id AS user_id,
  up.email,
  up.organisation_id,
  up.role
FROM public.user_profiles up
WHERE up.role = 'surveyor'
ORDER BY up.email;
