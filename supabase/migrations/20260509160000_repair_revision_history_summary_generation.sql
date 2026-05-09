/*
  # Repair revision history and change-summary generation

  Root cause repaired here:
  - Draft replacement versions were creating document_change_summaries immediately.
    Those draft summaries used the replacement version_number and summary text "Initial issue".
  - When the draft was later issued, the unique (base_document_id, version_number)
    summary constraint could retain/block the correct "Changes Since Last Issue" row.
  - Some historical chains also contain duplicate active rows for the same
    (base_document_id, version_number), so source queries can see duplicate/draft rows.

  Fix:
  - Archive duplicate active document rows for the same chain/version, keeping the best
    issued/superseded row first and otherwise the newest active draft.
  - Add a partial unique index so active, non-archived rows cannot reuse a version_number.
  - Delete change summaries attached to draft/archived/deleted document rows.
  - Keep one change summary per active issued/superseded document version.
  - Backfill missing summaries: only the first issued/superseded version gets
    "Initial issue"; later versions get generate_change_summary against the latest
    lower issued/superseded version in the same base_document_id chain.
*/

-- 1) Repair duplicate active document rows per chain/version before enforcing uniqueness.
WITH ranked_versions AS (
  SELECT
    d.id,
    d.base_document_id,
    d.version_number,
    row_number() OVER (
      PARTITION BY d.base_document_id, d.version_number
      ORDER BY
        CASE d.issue_status WHEN 'issued' THEN 1 WHEN 'superseded' THEN 2 ELSE 3 END,
        COALESCE(d.issue_date, d.updated_at::date, d.created_at::date) DESC NULLS LAST,
        d.updated_at DESC NULLS LAST,
        d.created_at DESC NULLS LAST,
        d.id DESC
    ) AS rn
  FROM public.documents d
  WHERE d.base_document_id IS NOT NULL
    AND d.version_number IS NOT NULL
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted')
    AND d.issue_status <> 'archived'
)
UPDATE public.documents d
SET
  issue_status = 'archived',
  status = 'archived',
  deleted_at = COALESCE(d.deleted_at, now()),
  updated_at = now()
FROM ranked_versions r
WHERE d.id = r.id
  AND r.rn > 1;

-- 2) Enforce one active, non-archived row per chain/version going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_one_active_row_per_base_version
ON public.documents (base_document_id, version_number)
WHERE base_document_id IS NOT NULL
  AND version_number IS NOT NULL
  AND deleted_at IS NULL
  AND issue_status <> 'archived'
  AND COALESCE(status, 'draft') NOT IN ('archived', 'deleted');

-- 3) Remove summaries that belong to draft or archived/deleted documents.
DELETE FROM public.document_change_summaries dcs
USING public.documents d
WHERE dcs.document_id = d.id
  AND (
    d.issue_status NOT IN ('issued', 'superseded')
    OR d.deleted_at IS NOT NULL
    OR d.issue_status = 'archived'
    OR COALESCE(d.status, 'draft') IN ('archived', 'deleted')
  );

-- 4) If duplicate summary rows exist for the same active issued/superseded version,
-- keep the newest row for that exact document/version and remove the rest.
WITH ranked_summaries AS (
  SELECT
    dcs.id,
    row_number() OVER (
      PARTITION BY dcs.base_document_id, dcs.version_number
      ORDER BY
        CASE WHEN dcs.document_id = d.id THEN 0 ELSE 1 END,
        dcs.created_at DESC NULLS LAST,
        dcs.id DESC
    ) AS rn
  FROM public.document_change_summaries dcs
  JOIN public.documents d
    ON d.base_document_id = dcs.base_document_id
   AND d.version_number = dcs.version_number
   AND d.issue_status IN ('issued', 'superseded')
   AND d.deleted_at IS NULL
   AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted')
)
DELETE FROM public.document_change_summaries dcs
USING ranked_summaries r
WHERE dcs.id = r.id
  AND r.rn > 1;

-- 5) Remove retained later-version fallback summaries that incorrectly say "Initial issue";
-- the backfill below regenerates them as changes against the latest lower issued/superseded version.
WITH issued_chain AS (
  SELECT
    d.id,
    d.base_document_id,
    d.version_number,
    min(d.version_number) OVER (PARTITION BY d.base_document_id) AS first_issued_version
  FROM public.documents d
  WHERE d.issue_status IN ('issued', 'superseded')
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted')
)
DELETE FROM public.document_change_summaries dcs
USING issued_chain ic
WHERE dcs.document_id = ic.id
  AND ic.version_number > ic.first_issued_version
  AND btrim(COALESCE(dcs.summary_text, dcs.summary_markdown, '')) = 'Initial issue';

-- 6) Backfill missing first-issue summaries.
WITH first_versions AS (
  SELECT DISTINCT ON (d.base_document_id)
    d.id,
    d.organisation_id,
    d.base_document_id,
    d.version_number,
    d.issued_by
  FROM public.documents d
  WHERE d.issue_status IN ('issued', 'superseded')
    AND d.deleted_at IS NULL
    AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted')
  ORDER BY d.base_document_id, d.version_number ASC, d.created_at ASC
)
INSERT INTO public.document_change_summaries (
  organisation_id,
  base_document_id,
  document_id,
  previous_document_id,
  version_number,
  new_actions_count,
  closed_actions_count,
  reopened_actions_count,
  outstanding_actions_count,
  new_actions,
  closed_actions,
  reopened_actions,
  risk_rating_changes,
  material_field_changes,
  summary_text,
  has_material_changes,
  visible_to_client,
  generated_by
)
SELECT
  fv.organisation_id,
  fv.base_document_id,
  fv.id,
  NULL,
  fv.version_number,
  COALESCE(action_counts.open_count, 0),
  0,
  0,
  COALESCE(action_counts.open_count, 0),
  COALESCE(action_counts.open_actions, '[]'::jsonb),
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'Initial issue',
  false,
  true,
  fv.issued_by
FROM first_versions fv
LEFT JOIN LATERAL (
  SELECT
    count(*)::int AS open_count,
    jsonb_agg(jsonb_build_object(
      'id', a.id,
      'recommended_action', a.recommended_action,
      'priority_band', a.priority_band,
      'status', a.status
    )) AS open_actions
  FROM public.actions a
  WHERE a.document_id = fv.id
    AND a.deleted_at IS NULL
    AND a.status IN ('open', 'in_progress', 'deferred')
) action_counts ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_change_summaries existing
  WHERE existing.document_id = fv.id
);

-- 7) Backfill missing later-version summaries using the latest lower issued/superseded version.
DO $$
DECLARE
  rec record;
  generated_id uuid;
BEGIN
  FOR rec IN
    SELECT
      d.id AS document_id,
      d.issued_by,
      prev.id AS previous_document_id
    FROM public.documents d
    JOIN LATERAL (
      SELECT p.id
      FROM public.documents p
      WHERE p.base_document_id = d.base_document_id
        AND p.id <> d.id
        AND p.issue_status IN ('issued', 'superseded')
        AND p.version_number < d.version_number
        AND p.deleted_at IS NULL
        AND COALESCE(p.status, 'draft') NOT IN ('archived', 'deleted')
      ORDER BY p.version_number DESC, p.issue_date DESC NULLS LAST, p.created_at DESC
      LIMIT 1
    ) prev ON true
    WHERE d.issue_status IN ('issued', 'superseded')
      AND d.deleted_at IS NULL
      AND COALESCE(d.status, 'draft') NOT IN ('archived', 'deleted')
      AND NOT EXISTS (
        SELECT 1 FROM public.document_change_summaries existing
        WHERE existing.document_id = d.id
      )
    ORDER BY d.base_document_id, d.version_number
  LOOP
    generated_id := public.generate_change_summary(rec.document_id, rec.previous_document_id, rec.issued_by);
  END LOOP;
END $$;
