-- Enforce generate-once semantics for auto recommendations
--
-- Prior behaviour: the application pipeline used a read-then-write pattern
-- with no DB-level uniqueness guarantee, so concurrent saves could produce
-- duplicate auto-recommendation rows for the same (document, module, factor,
-- module_instance) identity tuple.
--
-- New behaviour: auto recommendations are created exactly once per identity.
-- The pipeline no longer suppresses or restores rows; once created the record
-- is an independent assessment artefact owned by the assessor.
--
-- Step 1: Delete duplicates first (keep the newest row per identity group,
--         consistent with the previous pipeline which kept created_at DESC).
--         Hard-delete because is_suppressed=true rows would also conflict.
DELETE FROM public.re_recommendations
WHERE source_type = 'auto'
  AND id NOT IN (
    SELECT DISTINCT ON (
      document_id,
      source_module_key,
      COALESCE(source_factor_key, ''),
      COALESCE(module_instance_id::text, '')
    ) id
    FROM public.re_recommendations
    WHERE source_type = 'auto'
    ORDER BY
      document_id,
      source_module_key,
      COALESCE(source_factor_key, ''),
      COALESCE(module_instance_id::text, ''),
      created_at DESC
  );

-- Step 2: Unique partial index on the auto-recommendation identity tuple.
-- COALESCE handles NULLable columns so each combination is treated as distinct.
-- Covers source_type = 'auto' only; manual records are not constrained here.
CREATE UNIQUE INDEX re_recommendations_auto_identity_idx
ON public.re_recommendations (
  document_id,
  source_module_key,
  COALESCE(source_factor_key, ''),
  COALESCE(module_instance_id::text, '')
)
WHERE source_type = 'auto';
