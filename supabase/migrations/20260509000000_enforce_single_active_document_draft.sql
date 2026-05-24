/*
  # Enforce one active draft document version per base document

  - Allows multiple issued/superseded versions in a document family.
  - Allows at most one non-deleted draft version per base_document_id.
  - Raises the product-facing duplicate-draft message before insert/update, so callers get
    a deterministic validation error instead of relying only on a unique-index violation.
*/

DROP INDEX IF EXISTS idx_documents_one_draft_per_base;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_one_active_draft_per_base
ON documents (base_document_id)
WHERE issue_status = 'draft' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_document_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.issue_status = 'draft' AND NEW.deleted_at IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.base_document_id = NEW.base_document_id
        AND d.issue_status = 'draft'
        AND d.deleted_at IS NULL
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
BEFORE INSERT OR UPDATE OF base_document_id, issue_status, deleted_at
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_active_document_draft();

COMMENT ON FUNCTION public.prevent_duplicate_active_document_draft() IS
  'Prevents more than one non-deleted draft document version per base_document_id before insert/update.';
