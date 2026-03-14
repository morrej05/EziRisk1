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

-- 5) Legacy user_profiles-based RLS policies on organisations/re_recommendations (must be zero rows)
SELECT
  schemaname,
  tablename,
  policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('organisations', 're_recommendations')
  AND policyname IN (
    'Users can read own organisation',
    'Organisation admins can update',
    'Platform admins can read all organisations',
    'Platform admins can update all organisations',
    'Users can view recommendations for accessible documents',
    'Users can create recommendations for accessible documents',
    'Users can update recommendations for accessible documents',
    'Users can delete recommendations for accessible documents'
  )
ORDER BY tablename, policyname;

-- 6) re_recommendations with missing documents/org linkage (must be zero)
SELECT
  rr.id AS re_recommendation_id,
  rr.document_id,
  d.organisation_id
FROM public.re_recommendations rr
LEFT JOIN public.documents d ON d.id = rr.document_id
WHERE d.id IS NULL
   OR d.organisation_id IS NULL
ORDER BY rr.created_at DESC;

-- 7) Issued surveys lacking organisation_id (must be zero before strict membership-only signed URL issuance)
SELECT
  sr.id AS survey_report_id,
  sr.status,
  sr.organisation_id,
  sr.user_id,
  sr.updated_at
FROM public.survey_reports sr
WHERE sr.status = 'issued'
  AND sr.organisation_id IS NULL
ORDER BY sr.updated_at DESC;
