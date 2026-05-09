/*
  # Scope duplicate-draft blocking to active editable drafts only

  Archived/deleted drafts are represented by documents.deleted_at/deleted_by in the
  app's archive flow, and some lifecycle deployments may also mirror inactive states
  in documents.status. Only active editable draft issue statuses should block creating
  a replacement draft version.
*/

DROP INDEX IF EXISTS idx_documents_one_draft_per_base;
DROP INDEX IF EXISTS idx_documents_one_active_draft_per_base;

ALTER TABLE documents
DROP CONSTRAINT IF EXISTS documents_issue_status_check;

ALTER TABLE documents
ADD CONSTRAINT documents_issue_status_check
CHECK (issue_status IN (
  'draft',
  'in_progress_draft',
  'pending_review_draft',
  'issued',
  'superseded',
  'archived',
  'deleted'
));

CREATE UNIQUE INDEX idx_documents_one_active_draft_per_base
ON documents (base_document_id)
WHERE issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
  AND deleted_at IS NULL
  AND COALESCE(status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued');

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_document_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
     AND NEW.deleted_at IS NULL
     AND COALESCE(NEW.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued') THEN
    IF EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.base_document_id = NEW.base_document_id
        AND d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued')
        AND d.id <> NEW.id
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'A draft version already exists and must be issued or deleted before creating another version.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_active_document_draft ON public.documents;

CREATE TRIGGER trg_prevent_duplicate_active_document_draft
BEFORE INSERT OR UPDATE OF base_document_id, issue_status, status, deleted_at
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_active_document_draft();

COMMENT ON FUNCTION public.prevent_duplicate_active_document_draft() IS
  'Prevents more than one active editable draft document version per base_document_id; archived/deleted/superseded/issued versions do not block new drafts.';
