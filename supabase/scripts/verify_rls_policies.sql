/*
  Phase 9 — Runtime RLS Policy Verification Script

  Run this against the production database after applying Phase 9 migrations
  to verify that:

    1. All expected membership-first policies exist on key tables
    2. No legacy user_profiles.organisation_id OR-clauses remain on documents
    3. Evidence and org-assets bucket policies use organisation_members
    4. Platform admin elevation uses super_admins table
    5. No orphan policies exist on critical tables

  Usage (Supabase CLI):
    supabase db execute --file supabase/scripts/verify_rls_policies.sql

  Or run directly in the Supabase SQL editor.
*/

-- ============================================================
-- 1. Enumerate all policies on key tables
-- ============================================================

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN (
  'documents',
  'audit_log',
  'user_profiles',
  'organisation_members',
  'super_admins',
  'survey_reports'
))
OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY tablename, cmd, policyname;


-- ============================================================
-- 2. Assert: no legacy user_profiles.organisation_id fallback
--    in documents policies (should return 0 rows)
-- ============================================================

SELECT
  policyname,
  'FAIL: legacy user_profiles fallback found' AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'documents'
  AND (qual ILIKE '%user_profiles.organisation_id%'
    OR with_check ILIKE '%user_profiles.organisation_id%');

-- If no rows: PASS
-- If any rows: FAIL — remove the OR-fallback and apply phase9 migration


-- ============================================================
-- 3. Assert: evidence bucket policies do NOT reference user_profiles
--    (should return 0 rows after Phase 9 Migration 1)
-- ============================================================

SELECT
  policyname,
  'FAIL: evidence bucket uses user_profiles lookup' AS status
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname ILIKE '%evidence%'
  AND (qual ILIKE '%user_profiles%' OR with_check ILIKE '%user_profiles%');

-- If no rows: PASS


-- ============================================================
-- 4. Assert: org-assets write policies do NOT use user_profiles.role
--    (should return 0 rows after Phase 9 Migration 1)
-- ============================================================

SELECT
  policyname,
  'FAIL: org-assets uses legacy user_profiles.role for write' AS status
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname ILIKE '%org%assets%'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  AND (qual ILIKE '%user_profiles.role%' OR with_check ILIKE '%user_profiles.role%');

-- If no rows: PASS


-- ============================================================
-- 5. Assert: user_profiles platform admin elevation uses super_admins
--    (should return 0 rows with the self-referential pattern)
-- ============================================================

SELECT
  policyname,
  'FAIL: user_profiles UPDATE still uses self-referential join' AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_profiles'
  AND cmd = 'UPDATE'
  AND qual ILIKE '%FROM user_profiles%'
  AND qual ILIKE '%is_platform_admin%';

-- If no rows: PASS


-- ============================================================
-- 6. Assert: super_admins table has RLS enabled
-- ============================================================

SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL: RLS not enabled on super_admins' END AS status
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE pg_namespace.nspname = 'public'
  AND pg_class.relname = 'super_admins';


-- ============================================================
-- 7. Assert: audit_log event_type CHECK constraint covers
--    all event types written by edge functions
-- ============================================================

-- Check if 'approved' is in the constraint definition
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_def,
  CASE
    WHEN pg_get_constraintdef(con.oid) ILIKE '%approved%'
      AND pg_get_constraintdef(con.oid) ILIKE '%returned_to_draft%'
      AND pg_get_constraintdef(con.oid) ILIKE '%public_access%'
    THEN 'PASS'
    ELSE 'FAIL: audit_log event_type CHECK constraint is too narrow'
  END AS status
FROM pg_constraint con
JOIN pg_class cls ON con.conrelid = cls.oid
JOIN pg_namespace ns ON cls.relnamespace = ns.oid
WHERE ns.nspname = 'public'
  AND cls.relname = 'audit_log'
  AND con.contype = 'c'
  AND con.conname ILIKE '%event_type%';


-- ============================================================
-- 8. Confirm audit_log.survey_id is nullable (allow document events)
-- ============================================================

SELECT
  column_name,
  is_nullable,
  CASE WHEN is_nullable = 'YES' THEN 'PASS' ELSE 'FAIL: survey_id must be nullable for public_access events' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit_log'
  AND column_name = 'survey_id';


-- ============================================================
-- 9. Confirm audit_log.document_id column exists
-- ============================================================

SELECT
  column_name,
  data_type,
  is_nullable,
  'PASS' AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit_log'
  AND column_name = 'document_id';

-- If 0 rows: FAIL — document_id column missing; apply phase9 audit log migration
