-- Repair issued document rows that lost their executive summary during issue.
--
-- This copies the executive summary fields from the matching draft row to the
-- issued row when both rows share the same base_document_id and version_number,
-- the issued row has no summary text, and the draft row has summary text.
--
-- Review the RETURNING output before committing this in production. If multiple
-- matching draft rows exist for the same base/version, the most recently updated
-- draft row is used.

WITH draft_summaries AS (
  SELECT
    d.id AS draft_document_id,
    d.base_document_id,
    d.version_number,
    d.executive_summary_ai,
    d.executive_summary_author,
    d.executive_summary_mode,
    row_number() OVER (
      PARTITION BY d.base_document_id, d.version_number
      ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC
    ) AS rn
  FROM public.documents d
  WHERE d.issue_status IN ('draft', 'in_progress_draft', 'pending_review_draft')
    AND (
      nullif(btrim(coalesce(d.executive_summary_ai, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(d.executive_summary_author, '')), '') IS NOT NULL
    )
)
UPDATE public.documents issued
SET
  executive_summary_ai = draft_summaries.executive_summary_ai,
  executive_summary_author = draft_summaries.executive_summary_author,
  executive_summary_mode = draft_summaries.executive_summary_mode,
  updated_at = now()
FROM draft_summaries
WHERE draft_summaries.rn = 1
  AND issued.id <> draft_summaries.draft_document_id
  AND issued.base_document_id = draft_summaries.base_document_id
  AND issued.version_number = draft_summaries.version_number
  AND issued.issue_status = 'issued'
  AND issued.executive_summary_ai IS NULL
  AND issued.executive_summary_author IS NULL
RETURNING
  issued.id AS repaired_issued_document_id,
  draft_summaries.draft_document_id,
  issued.base_document_id,
  issued.version_number,
  issued.executive_summary_mode,
  length(coalesce(issued.executive_summary_ai, '')) AS repaired_ai_length,
  length(coalesce(issued.executive_summary_author, '')) AS repaired_author_length;
