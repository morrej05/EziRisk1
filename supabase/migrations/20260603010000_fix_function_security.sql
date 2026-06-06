-- Fix: function security hardening
--
-- Two classes of Supabase linter warnings resolved here:
--
--  1. security_definer_view / exposed SECURITY DEFINER functions
--     Revoke execute from anon and the broad 'public' role, then re-grant
--     only to 'authenticated' for the RPCs the app actually calls from
--     the client.  Trigger functions are internal-only; they receive no
--     public grant.
--
--  2. function_search_path_mutable
--     Four trigger functions lack a fixed search_path, which means a
--     malicious schema placed earlier on the search_path could shadow
--     objects they reference.  Pinning to 'public, pg_temp' removes the
--     attack surface.

-- ---------------------------------------------------------------------------
-- PART 1 — Revoke broad execute grants
-- ---------------------------------------------------------------------------

-- Remove execute from the implicit 'public' role (covers both anon and
-- authenticated unless re-granted below) and from 'anon' explicitly.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public;

-- ---------------------------------------------------------------------------
-- PART 2 — Re-grant only the RPCs the client actually calls
-- ---------------------------------------------------------------------------

-- Auth / org bootstrap
GRANT EXECUTE ON FUNCTION public.ensure_org_for_user(uuid)
  TO authenticated;

-- Document lifecycle guards (called from lifecycleGuards.ts)
GRANT EXECUTE ON FUNCTION public.can_user_issue_document(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_close_action(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_document_be_edited(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_document_for_issue(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_version_chain_integrity(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_locked_pdf_integrity()
  TO authenticated;

-- Document versioning / change summaries
GRANT EXECUTE ON FUNCTION public.generate_change_summary(uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_issued_document(uuid)
  TO authenticated;

-- PDF locking
GRANT EXECUTE ON FUNCTION public.should_regenerate_pdf(uuid)
  TO authenticated;

-- External access links (called from externalAccess.ts)
GRANT EXECUTE ON FUNCTION public.create_external_access_link(uuid, text, text, integer, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_and_log_access(text, uuid, inet, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_access_token()
  TO authenticated;

-- Entitlement checks
GRANT EXECUTE ON FUNCTION public.get_report_creation_entitlement(uuid, timestamptz)
  TO authenticated;
-- Two overloads exist; grant both so PostgREST can resolve either call form.
GRANT EXECUTE ON FUNCTION public.get_user_seat_entitlement(uuid, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_seat_entitlement(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- PART 3 — Fix mutable search_path on trigger / utility functions
--
-- Pinning search_path = public, pg_temp prevents a hostile schema placed
-- earlier on the path from shadowing the tables and functions these
-- trigger functions reference.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.prevent_documents_organisation_id_update()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.prevent_duplicate_active_document_draft()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.enforce_single_draft_per_chain()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.check_version_chain_integrity(uuid)
  SET search_path = public, pg_temp;
