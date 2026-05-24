/*
  # Exclude soft-deleted draft documents from duplicate draft version guards

  Root cause:
  - Legacy lifecycle guardrail function enforce_single_draft_per_chain() from
    20260122145623_add_lifecycle_guardrails_v3.sql counted every
    issue_status = 'draft' row in a base_document_id chain.
  - A soft-deleted row with issue_status = 'draft', status = 'draft', and
    deleted_at IS NOT NULL therefore still triggered:
    "Cannot have multiple draft documents in the same chain".

  Required active draft rule:
    issue_status = 'draft'
    AND deleted_at IS NULL
    AND COALESCE(status, 'draft') NOT IN ('deleted', 'archived')

  Also ensure draft delete/archive updates mark status = 'deleted' so future
  soft-deleted draft rows are not left with status = 'draft'.
*/

DROP INDEX IF EXISTS idx_documents_one_draft_per_base;
DROP INDEX IF EXISTS idx_documents_one_active_draft_per_base;

CREATE UNIQUE INDEX idx_documents_one_active_draft_per_base
ON public.documents (base_document_id)
WHERE issue_status = 'draft'
  AND deleted_at IS NULL
  AND COALESCE(status, 'draft') NOT IN ('deleted', 'archived');

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_document_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.issue_status = 'draft'
     AND NEW.deleted_at IS NULL
     AND COALESCE(NEW.status, 'draft') NOT IN ('deleted', 'archived') THEN
    IF EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.base_document_id = NEW.base_document_id
        AND d.issue_status = 'draft'
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
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

CREATE OR REPLACE FUNCTION public.enforce_single_draft_per_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_draft_count int;
BEGIN
  IF NEW.issue_status != 'draft'
     OR NEW.deleted_at IS NOT NULL
     OR COALESCE(NEW.status, 'draft') IN ('deleted', 'archived') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_draft_count
  FROM public.documents d
  WHERE d.base_document_id = NEW.base_document_id
    AND d.issue_status = 'draft'
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
    AND d.id <> NEW.id;

  IF v_existing_draft_count > 0 THEN
    RAISE EXCEPTION 'Cannot have multiple draft documents in the same chain'
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
    AND issue_status = 'draft'
    AND deleted_at IS NULL
    AND COALESCE(status, 'draft') NOT IN ('deleted', 'archived');

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
    WHERE d.issue_status = 'draft'
      AND d.deleted_at IS NULL
      AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
  ) AS draft_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'issued') AS issued_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'superseded') AS superseded_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'archived' OR d.deleted_at IS NOT NULL OR d.status = 'archived') AS archived_count,
  MAX(d.version_number) AS latest_version,
  CASE
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') > 1 THEN 'ERROR: Multiple issued'
    WHEN COUNT(*) FILTER (
      WHERE d.issue_status = 'draft'
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
    ) > 1 THEN 'ERROR: Multiple active drafts'
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') = 0
      AND COUNT(*) FILTER (
        WHERE d.issue_status = 'draft'
          AND d.deleted_at IS NULL
          AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
      ) = 0 THEN 'WARNING: No active version'
    ELSE 'OK'
  END AS health_status
FROM public.documents d
GROUP BY d.organisation_id, d.base_document_id;

UPDATE public.documents
SET status = 'deleted'
WHERE issue_status = 'draft'
  AND deleted_at IS NOT NULL
  AND COALESCE(status, 'draft') = 'draft';

COMMENT ON FUNCTION public.enforce_single_draft_per_chain() IS
  'Counts only active drafts: issue_status draft, deleted_at null, and status not deleted/archived; soft-deleted drafts do not block new versions.';

COMMENT ON FUNCTION public.prevent_duplicate_active_document_draft() IS
  'Prevents more than one active draft per base_document_id using the active draft rule; soft-deleted drafts are excluded.';

COMMENT ON INDEX idx_documents_one_active_draft_per_base IS
  'Allows at most one active draft per base_document_id; excludes deleted_at rows and status deleted/archived.';
