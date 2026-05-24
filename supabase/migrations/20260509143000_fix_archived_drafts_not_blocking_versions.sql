/*
  # Archived drafts must not block new document versions

  Root cause:
  - The archive flow soft-deletes draft documents with documents.deleted_at/deleted_by.
  - Older lifecycle guardrails still treated every issue_status = 'draft' row in the
    same base_document_id as an active draft, including archived/soft-deleted rows.
  - That trigger raises P0001 with "Cannot have multiple draft documents in the same chain".

  Fix:
  - Mark archived draft rows with issue_status = 'archived' (and status = 'archived'
    where the lifecycle status column is used).
  - Keep the unique index and duplicate-draft triggers scoped to active editable drafts only.
  - Replace the legacy enforce_single_draft_per_chain trigger/function that caused P0001.
*/

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

ALTER TABLE documents
DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
ADD CONSTRAINT documents_status_check
CHECK (status IN (
  'draft',
  'in_review',
  'approved',
  'issued',
  'superseded',
  'archived',
  'deleted'
));

DROP INDEX IF EXISTS idx_documents_one_draft_per_base;
DROP INDEX IF EXISTS idx_documents_one_active_draft_per_base;

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

-- Replace the legacy trigger/function from 20260122145623 that raised:
-- "Cannot have multiple draft documents in the same chain".
CREATE OR REPLACE FUNCTION public.enforce_single_draft_per_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_draft_count int;
BEGIN
  IF NEW.issue_status NOT IN ('draft', 'in_progress_draft', 'pending_review_draft')
     OR NEW.deleted_at IS NOT NULL
     OR COALESCE(NEW.status, 'draft') IN ('archived', 'deleted', 'superseded', 'issued') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_draft_count
  FROM public.documents d
  WHERE d.base_document_id = NEW.base_document_id
    AND d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued')
    AND d.id <> NEW.id;

  IF v_existing_draft_count > 0 THEN
    RAISE EXCEPTION 'Cannot have multiple active draft documents in the same chain'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_single_draft_per_chain ON public.documents;

CREATE TRIGGER trigger_enforce_single_draft_per_chain
BEFORE INSERT OR UPDATE OF base_document_id, issue_status, status, deleted_at
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_draft_per_chain();

CREATE OR REPLACE FUNCTION public.check_version_chain_integrity(p_base_document_id uuid)
RETURNS TABLE (
  is_valid boolean,
  issue_description text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_issued_count int;
  v_active_draft_count int;
BEGIN
  SELECT COUNT(*) INTO v_issued_count
  FROM public.documents
  WHERE base_document_id = p_base_document_id
    AND issue_status = 'issued';

  IF v_issued_count > 1 THEN
    RETURN QUERY SELECT false, format('Version chain has %s issued documents (should be 0 or 1)', v_issued_count)::text;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_active_draft_count
  FROM public.documents
  WHERE base_document_id = p_base_document_id
    AND issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
    AND deleted_at IS NULL
    AND COALESCE(status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued');

  IF v_active_draft_count > 1 THEN
    RETURN QUERY SELECT false, format('Version chain has %s active draft documents (should be 0 or 1)', v_active_draft_count)::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Version chain integrity is valid'::text;
END;
$$;

DROP VIEW IF EXISTS public.document_lifecycle_health;

CREATE VIEW public.document_lifecycle_health AS
SELECT
  d.organisation_id,
  d.base_document_id,
  COUNT(*) AS total_versions,
  COUNT(*) FILTER (
    WHERE d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
      AND d.deleted_at IS NULL
      AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued')
  ) AS draft_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'issued') AS issued_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'superseded') AS superseded_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'archived' OR d.deleted_at IS NOT NULL OR d.status = 'archived') AS archived_count,
  MAX(d.version_number) AS latest_version,
  CASE
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') > 1 THEN 'ERROR: Multiple issued'
    WHEN COUNT(*) FILTER (
      WHERE d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued')
    ) > 1 THEN 'ERROR: Multiple active drafts'
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') = 0
      AND COUNT(*) FILTER (
        WHERE d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
          AND d.deleted_at IS NULL
          AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted', 'superseded', 'issued')
      ) = 0 THEN 'WARNING: No active version'
    ELSE 'OK'
  END AS health_status
FROM public.documents d
GROUP BY d.organisation_id, d.base_document_id;

COMMENT ON FUNCTION public.enforce_single_draft_per_chain() IS
  'Legacy lifecycle guardrail retained for compatibility, but scoped to active editable drafts only; archived/deleted drafts do not block new versions.';

COMMENT ON INDEX idx_documents_one_active_draft_per_base IS
  'Allows at most one active editable draft per base_document_id; archived/deleted draft rows are excluded.';
