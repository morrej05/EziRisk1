-- ============================================================
-- Migration verification script
-- Paste into Supabase Dashboard SQL editor and run.
-- TRUE = change already applied. FALSE = migration needs applying.
-- ============================================================

SELECT '20260218090000' AS migration, 'create_saved_portfolio_views' AS description,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'saved_portfolio_views') AS applied

UNION ALL SELECT '20260314120000', 'auth_hardening_phase1 — author columns on documents',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'created_by_user_id')

UNION ALL SELECT '20260314120000b', 'auth_hardening_phase1 — user_legal_acceptances table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user_legal_acceptances')

UNION ALL SELECT '20260314120000c', 'auth_hardening_phase1 — organisation_members table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'organisation_members')

UNION ALL SELECT '20260314135000', 'auth_compat — organisation_members.status column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'organisation_members'
            AND column_name = 'status')

UNION ALL SELECT '20260314143000', 'auth_hardening_phase2 — display_author_name column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'display_author_name')

UNION ALL SELECT '20260314143000b', 'auth_hardening_phase2 — issued_display_author_name column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'issued_display_author_name')

UNION ALL SELECT '20260314170000', 'auth_hardening_phase2_followup — set_document_author_snapshot fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'set_document_author_snapshot'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260314193000', 'auth_launch_round2 — membership-first survey_reports policy',
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'survey_reports'
            AND policyname ILIKE '%org%survey%')

UNION ALL SELECT '20260314210000', 'auth_launch_round3 — attachments policy',
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'attachments'
            AND policyname ILIKE '%organisation%')

UNION ALL SELECT '20260315100000', 'remove_surveyor_role_check — consultant allowed in role check',
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'user_profiles_role_check'
            AND conrelid = 'public.user_profiles'::regclass)

UNION ALL SELECT '20260316103000', 'add_module_instance_to_re_recommendations',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 're_recommendations'
            AND column_name = 'module_instance_id')

UNION ALL SELECT '20260317110000', 'solo_owner_self_delete — self_delete_solo_owner_account_secure fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'self_delete_solo_owner_account_secure'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260318090000', 'fix_signup_membership — ensure_org_for_user fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'ensure_org_for_user'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260319101500', 'v1_signup_membership_blocker_fix — module_instances INSERT policy',
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'module_instances'
            AND policyname ILIKE '%create%')

UNION ALL SELECT '20260320113000', 'fix_module_instances_insert_rls — via documents join',
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'module_instances'
            AND policyname ILIKE '%create%')

UNION ALL SELECT '20260321120000', 're_recommendations module_instance index',
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 're_recommendations'
            AND indexname LIKE '%module_instance%')

UNION ALL SELECT '20260323100000', 'report_entitlements — get_report_creation_entitlement fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'get_report_creation_entitlement'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260323100000b', 'report_entitlements — organisations.trial_ends_at column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'organisations'
            AND column_name = 'trial_ends_at')

UNION ALL SELECT '20260323113000', 'user_seat_limits — get_user_seat_entitlement fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'get_user_seat_entitlement'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260324120000', 'seat_entitlement single-arg wrapper (pronargs=1)',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'get_user_seat_entitlement' AND pronargs = 1
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260324153000', 'plan_tiers — plan_definitions table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'plan_definitions')

UNION ALL SELECT '20260325110000', 'signup_rate_limit — signup_attempts table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'signup_attempts')

UNION ALL SELECT '20260509000000', 'single_active_draft — prevent_duplicate_active_document_draft fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'prevent_duplicate_active_document_draft'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260509_changeSummary', 'document_change_summaries table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'document_change_summaries')

UNION ALL SELECT '20260509_changeSummaryRLS', 'can_write_document_change_summary fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'can_write_document_change_summary'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260509_pdfStorage', 'document-pdfs storage bucket',
  EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'document-pdfs')

UNION ALL SELECT '20260509123000', 'preserve_version_identity — documents.meta column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'meta')

UNION ALL SELECT '20260509131500', 'scope_active_draft — in_progress_draft status value',
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'documents_issue_status_check'
            AND conrelid = 'public.documents'::regclass
            AND pg_get_constraintdef(oid) ILIKE '%in_progress_draft%')

UNION ALL SELECT '20260509143000', 'fix_archived_drafts — deleted_at on documents',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'deleted_at')

UNION ALL SELECT '20260509160000', 'repair_revision_history — document_change_summaries.base_document_id',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'document_change_summaries'
            AND column_name = 'base_document_id')

UNION ALL SELECT '20260510120000', 'exclude_soft_deleted_drafts — active draft index',
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'documents'
            AND indexname LIKE '%one_active_draft%')

UNION ALL SELECT '20260512110000', 'action_recommendation_detail — actions.recommendation_detail column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'actions'
            AND column_name = 'recommendation_detail')

UNION ALL SELECT '20260512120000', 'action_source_links table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'action_source_links')

UNION ALL SELECT '20260512130000', 'action_source_link RLS — can_write_action_source_link fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'can_write_action_source_link'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260512133000', 'allow_multiple_source_links — per-finding-action unique index',
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'action_source_links'
            AND indexname ILIKE '%finding_action%')

UNION ALL SELECT '20260513120000', 're_recommendations.category column',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 're_recommendations'
            AND column_name = 'category')

-- Phase 9 migrations
UNION ALL SELECT '20260522100000', 'phase9_rls_hardening — membership-first documents policy (no user_profiles fallback)',
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'documents'
            AND policyname = 'Users can view org documents')

UNION ALL SELECT '20260522110000', 'phase9_platform_admin — super_admins table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'super_admins')

UNION ALL SELECT '20260522120000', 'phase9_audit_log_integrity — audit_log table',
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'audit_log')

-- Phase 9C: the new migration
UNION ALL SELECT '20260522130000', 'phase9c_assessor_identity — resolve_display_name_for_user fn',
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'resolve_display_name_for_user'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))

UNION ALL SELECT '20260522130000b', 'phase9c_assessor_identity — trg_enforce_document_author_identity trigger',
  EXISTS (SELECT 1 FROM information_schema.triggers
          WHERE event_object_schema = 'public'
            AND event_object_table = 'documents'
            AND trigger_name = 'trg_enforce_document_author_identity')

UNION ALL SELECT '20260522130000c', 'phase9c_assessor_identity — trg_enforce_module_instance_assessor_name trigger',
  EXISTS (SELECT 1 FROM information_schema.triggers
          WHERE event_object_schema = 'public'
            AND event_object_table = 'module_instances'
            AND trigger_name = 'trg_enforce_module_instance_assessor_name')

ORDER BY migration;
