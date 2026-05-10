/*
  Verification SQL for the soft-deleted draft duplicate-version guard fix.

  Replace :base_document_id with the chain containing the soft-deleted draft,
  for example the base_document_id for document 0ba1da61-1899-454c-8d72-9dbf5b329a0c.
*/

-- BEFORE (legacy trigger/RPC semantics): soft-deleted draft rows were counted.
SELECT COUNT(*) AS legacy_draft_count
FROM public.documents d
WHERE d.base_document_id = :base_document_id
  AND d.issue_status = 'draft';

-- AFTER (required active draft rule): soft-deleted and archived/deleted lifecycle rows are ignored.
SELECT COUNT(*) AS active_draft_count
FROM public.documents d
WHERE d.base_document_id = :base_document_id
  AND d.issue_status = 'draft'
  AND d.deleted_at IS NULL
  AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived');

-- Evidence row check: this should return is_active_draft = false for
-- document 0ba1da61-1899-454c-8d72-9dbf5b329a0c when deleted_at is not null.
SELECT
  d.id,
  d.issue_status,
  d.status,
  d.deleted_at,
  (
    d.issue_status = 'draft'
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
  ) AS is_active_draft
FROM public.documents d
WHERE d.id = '0ba1da61-1899-454c-8d72-9dbf5b329a0c';
