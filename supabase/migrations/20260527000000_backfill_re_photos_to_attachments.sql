/*
  # P1: Backfill RE JSONB photos into unified attachments table

  ## Overview

  Risk Engineering photo evidence is currently stored in two JSONB locations:
    1. module_instances.data->'photos'[]     (RE-10 site photos)
    2. module_instances.data->'site_plan'    (RE-10 site plan — single object)
    3. re_recommendations.photos[]           (recommendation evidence photos)

  This migration creates rows in the unified `attachments` table that point to the
  same storage paths already in the `evidence` bucket. No files are moved — only
  metadata rows are created.

  After this migration:
    - RE photos appear in DocumentEvidenceV2 and evidence quality panels
    - Workspace sidebar evidence count badges include RE modules
    - EvidenceQualitySummary covers RE documents
    - carryForwardEvidence() picks up RE photos on next version creation
    - JSONB source fields are untouched and remain readable by the PDF builder
      until P2 (component refactor) and P3 (PDF migration) are complete

  ## Execution

  MUST RUN as postgres superuser or service_role.
  Supabase SQL editor runs as postgres by default, which bypasses all RLS.
  Do NOT run as an authenticated end-user — the INSERT policy gates on org
  membership + editor role and will block rows for some documents.

  ## Idempotency

  Adds a partial unique index on (document_id, file_path) WHERE deleted_at IS NULL.
  This index:
    - Prevents duplicate backfill on re-run
    - Prevents future duplicate evidence rows from any source
    - Does NOT block carry-forward (same file_path, different document_id is allowed)

  WHERE clauses additionally guard via NOT EXISTS before attempting each insert.
  ON CONFLICT on the same index silently skips any row that races to duplicate.

  ## Rollback

  All inserted rows have:
    - uploaded_by IS NULL        (application-uploaded rows always have a user id)
    - taken_at IS NULL           (no capture-time metadata in JSONB sources)
    - created_at <= now()        (backfilled rows won't have future timestamps)

  To roll back:
    DELETE FROM public.attachments
    WHERE uploaded_by IS NULL
      AND taken_at IS NULL
      AND created_at >= '<migration-start-timestamp>';

  Verify rollback count matches the post-flight inserted count before committing.

  ## Affected tables

  MODIFIED:  public.attachments  (INSERT + new unique index)
  READ-ONLY: public.module_instances, public.re_recommendations, public.documents
*/

-- ===========================================================================
-- 0. Pre-conditions check
-- ===========================================================================

DO $$
BEGIN
  -- Confirm we have the tables we need
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attachments' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Table public.attachments does not exist — aborting migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'module_instances' AND column_name = 'data' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Column module_instances.data does not exist — aborting migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 're_recommendations' AND column_name = 'photos' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Column re_recommendations.photos does not exist — aborting migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'base_document_id' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Column attachments.base_document_id does not exist — run 20260122162015 migration first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'deleted_at' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'Column attachments.deleted_at does not exist — run 20260122162015 migration first';
  END IF;
  RAISE NOTICE 'Pre-conditions OK';
END $$;


-- ===========================================================================
-- 1. Add partial unique index on (document_id, file_path) for idempotency
--    Partial: only active rows (deleted_at IS NULL) are constrained.
--    Carry-forward rows share file_path across document_ids — this is correct.
-- ===========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_doc_filepath_unique
  ON public.attachments (document_id, file_path)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  RAISE NOTICE 'Unique index idx_attachments_doc_filepath_unique ensured';
END $$;


-- ===========================================================================
-- 2. PRE-FLIGHT: counts of what will be inserted
--    Copy-paste these queries into SQL editor and run first to verify scope.
--    They are also evaluated during migration execution for the NOTICE log.
-- ===========================================================================

DO $$
DECLARE
  v_re10_photos_total     int := 0;
  v_re10_photos_new       int := 0;
  v_re10_photos_existing  int := 0;
  v_re10_plans_total      int := 0;
  v_re10_plans_new        int := 0;
  v_re10_plans_existing   int := 0;
  v_rec_photos_total      int := 0;
  v_rec_photos_new        int := 0;
  v_rec_photos_existing   int := 0;
BEGIN

  -- RE-10 site photos
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = mi.document_id
          AND a.file_path = photo->>'storage_path'
          AND a.deleted_at IS NULL
      )
    ),
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = mi.document_id
          AND a.file_path = photo->>'storage_path'
          AND a.deleted_at IS NULL
      )
    )
  INTO v_re10_photos_total, v_re10_photos_new, v_re10_photos_existing
  FROM public.module_instances mi
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(mi.data->'photos') = 'array' THEN mi.data->'photos' ELSE '[]'::jsonb END
  ) AS photo
  WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
    AND jsonb_typeof(mi.data->'photos') = 'array'
    AND (photo->>'storage_path') IS NOT NULL
    AND (photo->>'storage_path') <> '';

  RAISE NOTICE 'PRE-FLIGHT RE-10 photos  — total: %, to insert: %, already in attachments: %',
    v_re10_photos_total, v_re10_photos_new, v_re10_photos_existing;

  -- RE-10 site plans
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = mi.document_id
          AND a.file_path = mi.data->'site_plan'->>'storage_path'
          AND a.deleted_at IS NULL
      )
    ),
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = mi.document_id
          AND a.file_path = mi.data->'site_plan'->>'storage_path'
          AND a.deleted_at IS NULL
      )
    )
  INTO v_re10_plans_total, v_re10_plans_new, v_re10_plans_existing
  FROM public.module_instances mi
  WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
    AND jsonb_typeof(mi.data->'site_plan') = 'object'
    AND (mi.data->'site_plan'->>'storage_path') IS NOT NULL
    AND (mi.data->'site_plan'->>'storage_path') <> '';

  RAISE NOTICE 'PRE-FLIGHT RE-10 plans   — total: %, to insert: %, already in attachments: %',
    v_re10_plans_total, v_re10_plans_new, v_re10_plans_existing;

  -- RE recommendation photos
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = rr.document_id
          AND a.file_path = photo->>'path'
          AND a.deleted_at IS NULL
      )
    ),
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.document_id = rr.document_id
          AND a.file_path = photo->>'path'
          AND a.deleted_at IS NULL
      )
    )
  INTO v_rec_photos_total, v_rec_photos_new, v_rec_photos_existing
  FROM public.re_recommendations rr
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(rr.photos) = 'array' THEN rr.photos ELSE '[]'::jsonb END
  ) AS photo
  WHERE jsonb_typeof(rr.photos) = 'array'
    AND (photo->>'path') IS NOT NULL
    AND (photo->>'path') <> '';

  RAISE NOTICE 'PRE-FLIGHT rec photos    — total: %, to insert: %, already in attachments: %',
    v_rec_photos_total, v_rec_photos_new, v_rec_photos_existing;

  RAISE NOTICE 'PRE-FLIGHT TOTAL to insert: %',
    v_re10_photos_new + v_re10_plans_new + v_rec_photos_new;

END $$;


-- ===========================================================================
-- 3. BACKFILL: RE-10 site photos
--
--    Source schema:
--      { id: string, storage_path: string, caption: string, uploaded_at: string }
--
--    file_name  — derived from last path segment (no original name stored)
--    file_type  — inferred from extension (no mime_type stored in RE-10 JSONB)
--    file_size  — NULL (not stored in RE-10 JSONB)
--    caption    — from JSONB; NULLIF empty string
-- ===========================================================================

INSERT INTO public.attachments (
  organisation_id,
  document_id,
  base_document_id,
  module_instance_id,
  action_id,
  file_path,
  file_name,
  file_type,
  file_size_bytes,
  caption,
  taken_at,
  uploaded_by,
  created_at,
  updated_at
)
SELECT
  mi.organisation_id,
  mi.document_id,
  d.base_document_id,
  mi.id                                                                          AS module_instance_id,
  NULL::uuid                                                                     AS action_id,
  photo->>'storage_path'                                                         AS file_path,
  -- Derive file_name from the last segment of the storage path
  regexp_replace(photo->>'storage_path', '^.+/', '')                             AS file_name,
  -- Infer MIME type from file extension
  CASE
    WHEN lower(photo->>'storage_path') LIKE '%.png'  THEN 'image/png'
    WHEN lower(photo->>'storage_path') LIKE '%.heic' THEN 'image/heic'
    WHEN lower(photo->>'storage_path') LIKE '%.webp' THEN 'image/webp'
    ELSE                                                   'image/jpeg'           -- default: jpeg covers .jpg/.jpeg
  END                                                                            AS file_type,
  NULL::bigint                                                                   AS file_size_bytes,
  NULLIF(trim(COALESCE(photo->>'caption', '')), '')                              AS caption,
  NULL::timestamptz                                                              AS taken_at,
  NULL::uuid                                                                     AS uploaded_by,
  COALESCE(
    NULLIF(trim(photo->>'uploaded_at'), '')::timestamptz,
    now()
  )                                                                              AS created_at,
  now()                                                                          AS updated_at

FROM public.module_instances mi
JOIN public.documents d
  ON d.id = mi.document_id
CROSS JOIN jsonb_array_elements(mi.data->'photos') AS photo

WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
  AND jsonb_typeof(mi.data->'photos') = 'array'
  AND (photo->>'storage_path') IS NOT NULL
  AND (photo->>'storage_path') <> ''
  -- Idempotency guard: skip rows already in attachments
  AND NOT EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = mi.document_id
      AND a.file_path   = photo->>'storage_path'
      AND a.deleted_at IS NULL
  )

ON CONFLICT (document_id, file_path)
  WHERE deleted_at IS NULL
  DO NOTHING;


-- ===========================================================================
-- 4. BACKFILL: RE-10 site plans (single object, not an array)
--
--    Source schema:
--      { storage_path: string, description: string, uploaded_at: string }
--
--    caption  — from description field; NULLIF empty string
--    PDF      — included in CASE (site plan can be a PDF)
-- ===========================================================================

INSERT INTO public.attachments (
  organisation_id,
  document_id,
  base_document_id,
  module_instance_id,
  action_id,
  file_path,
  file_name,
  file_type,
  file_size_bytes,
  caption,
  taken_at,
  uploaded_by,
  created_at,
  updated_at
)
SELECT
  mi.organisation_id,
  mi.document_id,
  d.base_document_id,
  mi.id                                                                          AS module_instance_id,
  NULL::uuid                                                                     AS action_id,
  mi.data->'site_plan'->>'storage_path'                                         AS file_path,
  regexp_replace(mi.data->'site_plan'->>'storage_path', '^.+/', '')             AS file_name,
  CASE
    WHEN lower(mi.data->'site_plan'->>'storage_path') LIKE '%.pdf'  THEN 'application/pdf'
    WHEN lower(mi.data->'site_plan'->>'storage_path') LIKE '%.png'  THEN 'image/png'
    WHEN lower(mi.data->'site_plan'->>'storage_path') LIKE '%.heic' THEN 'image/heic'
    WHEN lower(mi.data->'site_plan'->>'storage_path') LIKE '%.webp' THEN 'image/webp'
    ELSE                                                                   'image/jpeg'
  END                                                                            AS file_type,
  NULL::bigint                                                                   AS file_size_bytes,
  NULLIF(trim(COALESCE(mi.data->'site_plan'->>'description', '')), '')          AS caption,
  NULL::timestamptz                                                              AS taken_at,
  NULL::uuid                                                                     AS uploaded_by,
  COALESCE(
    NULLIF(trim(mi.data->'site_plan'->>'uploaded_at'), '')::timestamptz,
    now()
  )                                                                              AS created_at,
  now()                                                                          AS updated_at

FROM public.module_instances mi
JOIN public.documents d
  ON d.id = mi.document_id

WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
  AND jsonb_typeof(mi.data->'site_plan') = 'object'
  AND (mi.data->'site_plan'->>'storage_path') IS NOT NULL
  AND (mi.data->'site_plan'->>'storage_path') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = mi.document_id
      AND a.file_path   = mi.data->'site_plan'->>'storage_path'
      AND a.deleted_at IS NULL
  )

ON CONFLICT (document_id, file_path)
  WHERE deleted_at IS NULL
  DO NOTHING;


-- ===========================================================================
-- 5. BACKFILL: RE recommendation photos
--
--    Source schema:
--      { path: string, file_name: string, size_bytes: number,
--        mime_type: string, uploaded_at: string }
--
--    caption      — NULL (no caption field in recommendation photo schema)
--    file_size    — cast from size_bytes; guarded against non-numeric values
--    module_instance_id — from rr.module_instance_id (may be NULL for old recs)
-- ===========================================================================

INSERT INTO public.attachments (
  organisation_id,
  document_id,
  base_document_id,
  module_instance_id,
  action_id,
  file_path,
  file_name,
  file_type,
  file_size_bytes,
  caption,
  taken_at,
  uploaded_by,
  created_at,
  updated_at
)
SELECT
  d.organisation_id,
  rr.document_id,
  d.base_document_id,
  rr.module_instance_id                                                          AS module_instance_id,
  NULL::uuid                                                                     AS action_id,
  photo->>'path'                                                                 AS file_path,
  -- Prefer stored file_name; fall back to last path segment
  COALESCE(
    NULLIF(trim(photo->>'file_name'), ''),
    regexp_replace(photo->>'path', '^.+/', '')
  )                                                                              AS file_name,
  -- Prefer stored mime_type; fall back to extension inference
  COALESCE(
    NULLIF(trim(photo->>'mime_type'), ''),
    CASE
      WHEN lower(photo->>'path') LIKE '%.png'  THEN 'image/png'
      WHEN lower(photo->>'path') LIKE '%.heic' THEN 'image/heic'
      WHEN lower(photo->>'path') LIKE '%.webp' THEN 'image/webp'
      ELSE                                          'image/jpeg'
    END
  )                                                                              AS file_type,
  -- Guard against non-numeric size_bytes values
  CASE
    WHEN (photo->>'size_bytes') ~ '^\d+$'
    THEN (photo->>'size_bytes')::bigint
    ELSE NULL
  END                                                                            AS file_size_bytes,
  NULL                                                                           AS caption,
  NULL::timestamptz                                                              AS taken_at,
  NULL::uuid                                                                     AS uploaded_by,
  COALESCE(
    NULLIF(trim(photo->>'uploaded_at'), '')::timestamptz,
    now()
  )                                                                              AS created_at,
  now()                                                                          AS updated_at

FROM public.re_recommendations rr
JOIN public.documents d
  ON d.id = rr.document_id
CROSS JOIN jsonb_array_elements(rr.photos) AS photo

WHERE jsonb_typeof(rr.photos) = 'array'
  AND (photo->>'path') IS NOT NULL
  AND (photo->>'path') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = rr.document_id
      AND a.file_path   = photo->>'path'
      AND a.deleted_at IS NULL
  )

ON CONFLICT (document_id, file_path)
  WHERE deleted_at IS NULL
  DO NOTHING;


-- ===========================================================================
-- 6. POST-FLIGHT VERIFICATION
-- ===========================================================================

DO $$
DECLARE
  v_missing_org       int;
  v_missing_doc       int;
  v_missing_path      int;
  v_missing_name      int;
  v_missing_type      int;
  v_duplicate_pairs   int;
  v_re10_total        int;
  v_rec_total         int;
  v_re10_unmatched    int;
  v_rec_unmatched     int;
BEGIN

  -- 6a. Rows with missing NOT NULL fields (should always be 0)
  SELECT
    COUNT(*) FILTER (WHERE organisation_id IS NULL),
    COUNT(*) FILTER (WHERE document_id IS NULL),
    COUNT(*) FILTER (WHERE file_path IS NULL OR file_path = ''),
    COUNT(*) FILTER (WHERE file_name IS NULL OR file_name = ''),
    COUNT(*) FILTER (WHERE file_type IS NULL OR file_type = '')
  INTO v_missing_org, v_missing_doc, v_missing_path, v_missing_name, v_missing_type
  FROM public.attachments
  WHERE deleted_at IS NULL;

  IF v_missing_org + v_missing_doc + v_missing_path + v_missing_name + v_missing_type > 0 THEN
    RAISE WARNING 'POST-FLIGHT FAIL: rows with missing required fields: org=%, doc=%, path=%, name=%, type=%',
      v_missing_org, v_missing_doc, v_missing_path, v_missing_name, v_missing_type;
  ELSE
    RAISE NOTICE 'POST-FLIGHT PASS: no rows with missing required fields';
  END IF;

  -- 6b. Duplicate check (unique index should prevent this — should always be 0)
  SELECT COUNT(*)
  INTO v_duplicate_pairs
  FROM (
    SELECT document_id, file_path
    FROM public.attachments
    WHERE deleted_at IS NULL
    GROUP BY document_id, file_path
    HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicate_pairs > 0 THEN
    RAISE WARNING 'POST-FLIGHT FAIL: % duplicate (document_id, file_path) pairs found — investigate before deploying P2', v_duplicate_pairs;
  ELSE
    RAISE NOTICE 'POST-FLIGHT PASS: no duplicate (document_id, file_path) pairs';
  END IF;

  -- 6c. Coverage check: every RE-10 JSONB photo should now have an attachment row
  SELECT COUNT(*)
  INTO v_re10_total
  FROM public.module_instances mi
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(mi.data->'photos') = 'array' THEN mi.data->'photos' ELSE '[]'::jsonb END
  ) AS photo
  WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
    AND jsonb_typeof(mi.data->'photos') = 'array'
    AND (photo->>'storage_path') IS NOT NULL
    AND (photo->>'storage_path') <> '';

  SELECT COUNT(*)
  INTO v_re10_unmatched
  FROM public.module_instances mi
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(mi.data->'photos') = 'array' THEN mi.data->'photos' ELSE '[]'::jsonb END
  ) AS photo
  WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
    AND jsonb_typeof(mi.data->'photos') = 'array'
    AND (photo->>'storage_path') IS NOT NULL
    AND (photo->>'storage_path') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE a.document_id = mi.document_id
        AND a.file_path   = photo->>'storage_path'
        AND a.deleted_at IS NULL
    );

  RAISE NOTICE 'POST-FLIGHT RE-10 photos: % total in JSONB, % unmatched in attachments (should be 0)',
    v_re10_total, v_re10_unmatched;

  -- 6d. Coverage check: every RE recommendation photo
  SELECT COUNT(*)
  INTO v_rec_total
  FROM public.re_recommendations rr
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(rr.photos) = 'array' THEN rr.photos ELSE '[]'::jsonb END
  ) AS photo
  WHERE jsonb_typeof(rr.photos) = 'array'
    AND (photo->>'path') IS NOT NULL
    AND (photo->>'path') <> '';

  SELECT COUNT(*)
  INTO v_rec_unmatched
  FROM public.re_recommendations rr
  CROSS JOIN jsonb_array_elements(
    CASE WHEN jsonb_typeof(rr.photos) = 'array' THEN rr.photos ELSE '[]'::jsonb END
  ) AS photo
  WHERE jsonb_typeof(rr.photos) = 'array'
    AND (photo->>'path') IS NOT NULL
    AND (photo->>'path') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE a.document_id = rr.document_id
        AND a.file_path   = photo->>'path'
        AND a.deleted_at IS NULL
    );

  RAISE NOTICE 'POST-FLIGHT rec photos:  % total in JSONB, % unmatched in attachments (should be 0)',
    v_rec_total, v_rec_unmatched;

  IF v_re10_unmatched + v_rec_unmatched = 0 THEN
    RAISE NOTICE 'POST-FLIGHT PASS: all JSONB photo records now have attachment rows';
  ELSE
    RAISE WARNING 'POST-FLIGHT WARNING: % JSONB photos have no attachment row — manual review needed',
      v_re10_unmatched + v_rec_unmatched;
  END IF;

END $$;


-- ===========================================================================
-- 7. Dry-run queries (safe to run standalone before committing)
--    Copy-paste these into Supabase SQL editor to preview scope.
-- ===========================================================================

/*

-- RE-10 photos scope
SELECT
  d.id          AS document_id,
  d.title       AS document_title,
  d.issue_status,
  mi.id         AS module_instance_id,
  photo->>'storage_path'                           AS file_path,
  regexp_replace(photo->>'storage_path', '^.+/', '') AS file_name,
  NULLIF(trim(COALESCE(photo->>'caption', '')), '')  AS caption,
  (photo->>'uploaded_at')::timestamptz              AS uploaded_at,
  EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = mi.document_id
      AND a.file_path = photo->>'storage_path'
      AND a.deleted_at IS NULL
  )                                                AS already_in_attachments
FROM public.module_instances mi
JOIN public.documents d ON d.id = mi.document_id
CROSS JOIN jsonb_array_elements(
  CASE WHEN jsonb_typeof(mi.data->'photos') = 'array' THEN mi.data->'photos' ELSE '[]'::jsonb END
) AS photo
WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
  AND jsonb_typeof(mi.data->'photos') = 'array'
  AND (photo->>'storage_path') IS NOT NULL
  AND (photo->>'storage_path') <> ''
ORDER BY d.created_at DESC, mi.id, photo->>'uploaded_at';


-- RE-10 site plans scope
SELECT
  d.id          AS document_id,
  d.title       AS document_title,
  d.issue_status,
  mi.id         AS module_instance_id,
  mi.data->'site_plan'->>'storage_path'                           AS file_path,
  regexp_replace(mi.data->'site_plan'->>'storage_path', '^.+/', '') AS file_name,
  NULLIF(trim(COALESCE(mi.data->'site_plan'->>'description', '')), '') AS caption,
  EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = mi.document_id
      AND a.file_path = mi.data->'site_plan'->>'storage_path'
      AND a.deleted_at IS NULL
  )                                                                AS already_in_attachments
FROM public.module_instances mi
JOIN public.documents d ON d.id = mi.document_id
WHERE mi.module_key = 'RE_10_SITE_PHOTOS'
  AND jsonb_typeof(mi.data->'site_plan') = 'object'
  AND (mi.data->'site_plan'->>'storage_path') IS NOT NULL
  AND (mi.data->'site_plan'->>'storage_path') <> ''
ORDER BY d.created_at DESC;


-- RE recommendation photos scope
SELECT
  d.id          AS document_id,
  d.title       AS document_title,
  d.issue_status,
  rr.id         AS recommendation_id,
  rr.rec_number,
  rr.module_instance_id,
  photo->>'path'                                               AS file_path,
  COALESCE(NULLIF(trim(photo->>'file_name'), ''),
    regexp_replace(photo->>'path', '^.+/', ''))                AS file_name,
  COALESCE(NULLIF(trim(photo->>'mime_type'), ''), 'image/jpeg') AS mime_type,
  (photo->>'size_bytes')::bigint                               AS size_bytes,
  EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.document_id = rr.document_id
      AND a.file_path = photo->>'path'
      AND a.deleted_at IS NULL
  )                                                             AS already_in_attachments
FROM public.re_recommendations rr
JOIN public.documents d ON d.id = rr.document_id
CROSS JOIN jsonb_array_elements(
  CASE WHEN jsonb_typeof(rr.photos) = 'array' THEN rr.photos ELSE '[]'::jsonb END
) AS photo
WHERE jsonb_typeof(rr.photos) = 'array'
  AND (photo->>'path') IS NOT NULL
  AND (photo->>'path') <> ''
ORDER BY d.created_at DESC, rr.rec_number;

*/
