/*
  # Section-owned RE recommendation context

  Adds lightweight metadata to the existing recommendation register so module-created
  recommendations can be rendered back under the exact section/source area that
  created them. This avoids a new finding table and preserves the existing register.
*/

ALTER TABLE public.re_recommendations
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_re_recommendations_section_context
ON public.re_recommendations (
  document_id,
  module_instance_id,
  source_factor_key
)
WHERE is_suppressed = false;

CREATE INDEX IF NOT EXISTS idx_re_recommendations_metadata_section
ON public.re_recommendations
USING gin (metadata);
