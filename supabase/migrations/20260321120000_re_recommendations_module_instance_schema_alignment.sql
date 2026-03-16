/*
  # RE recommendations module_instance_id schema alignment

  - Ensures live DB has module_instance_id for module-scoped RE queries.
  - Backfills module_instance_id from source_module_key when uniquely resolvable.
  - Adds supporting index for document+module filtering.
*/

ALTER TABLE public.re_recommendations
ADD COLUMN IF NOT EXISTS module_instance_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 're_recommendations_module_instance_id_fkey'
      AND conrelid = 'public.re_recommendations'::regclass
  ) THEN
    ALTER TABLE public.re_recommendations
      ADD CONSTRAINT re_recommendations_module_instance_id_fkey
      FOREIGN KEY (module_instance_id)
      REFERENCES public.module_instances(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill only where there is a single module_instances match per document + module_key.
WITH unique_module_match AS (
  SELECT
    rr.id AS recommendation_id,
    MIN(mi.id) AS resolved_module_instance_id
  FROM public.re_recommendations rr
  JOIN public.module_instances mi
    ON mi.document_id = rr.document_id
   AND mi.module_key = rr.source_module_key
  WHERE rr.module_instance_id IS NULL
  GROUP BY rr.id
  HAVING COUNT(mi.id) = 1
)
UPDATE public.re_recommendations rr
SET module_instance_id = umm.resolved_module_instance_id
FROM unique_module_match umm
WHERE rr.id = umm.recommendation_id
  AND rr.module_instance_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_re_recommendations_document_module_instance
ON public.re_recommendations (document_id, module_instance_id);

CREATE INDEX IF NOT EXISTS idx_re_recommendations_module_instance
ON public.re_recommendations (module_instance_id)
WHERE module_instance_id IS NOT NULL;
