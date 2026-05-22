/*
  # Phase 9 — Audit Log Schema Integrity

  Two problems fixed:

  1. Narrow event_type CHECK constraint
     The original constraint (from 20260124180652) only permitted:
       'issued', 'revision_created', 'action_closed', 'action_reopened'
     But approve-survey inserts 'approved' and return-to-draft inserts
     'returned_to_draft' — both currently fail the constraint, causing
     silent audit log gaps (the functions log the error but do not abort).

     This migration expands the constraint to cover all event types that
     are actually inserted by edge functions.

  2. survey_id NOT NULL blocks public-document audit events
     Public document access events (from the public-document and
     public-document-download edge functions) have a document_id but no
     survey_id. The survey_id NOT NULL constraint prevents inserting these
     rows.

     This migration:
       a. Makes survey_id nullable (backward-compatible — existing rows
          all have survey_id populated; no data is changed)
       b. Adds a nullable document_id UUID column with FK to documents

  No existing rows are modified. No existing indexes are dropped.
*/

-- ============================================================
-- 1. Expand event_type CHECK constraint
-- ============================================================

-- PostgreSQL assigns an auto-generated name to inline CHECK constraints.
-- We locate and drop it by table + constraint type before adding our own.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
    INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class cls ON con.conrelid = cls.oid
    JOIN pg_namespace ns ON cls.relnamespace = ns.oid
   WHERE ns.nspname = 'public'
     AND cls.relname = 'audit_log'
     AND con.contype = 'c'   -- CHECK constraint
     AND con.conname ILIKE '%event_type%'
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_log DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type IN (
    'issued',
    'revision_created',
    'action_closed',
    'action_reopened',
    'approved',
    'returned_to_draft',
    'document_deleted',
    'public_access'
  ));

-- ============================================================
-- 2. Make survey_id nullable; add document_id column
-- ============================================================

-- Relax the NOT NULL constraint so public-document access events
-- (which have no survey context) can be inserted.
ALTER TABLE public.audit_log
  ALTER COLUMN survey_id DROP NOT NULL;

-- Add nullable document_id for direct document-level events
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS document_id UUID
    REFERENCES public.documents(id) ON DELETE CASCADE;

-- Sparse index — most rows will not have document_id
CREATE INDEX IF NOT EXISTS idx_audit_log_document
  ON public.audit_log (document_id)
  WHERE document_id IS NOT NULL;

-- Update table comment to reflect expanded scope
COMMENT ON TABLE public.audit_log IS
  'Comprehensive audit trail of all significant platform events. '
  'Either survey_id or document_id must be present; both may be null '
  'only for platform-level events with no document context.';

COMMENT ON COLUMN public.audit_log.survey_id IS
  'Survey context (nullable for document-level or platform events)';

COMMENT ON COLUMN public.audit_log.document_id IS
  'Document context for document-level events such as public_access (nullable)';
