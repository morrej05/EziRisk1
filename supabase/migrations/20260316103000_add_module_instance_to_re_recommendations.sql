/*
  # Add module_instance_id to re_recommendations

  Align RE recommendation schema with application queries and module-scoped UX.
*/

ALTER TABLE public.re_recommendations
ADD COLUMN IF NOT EXISTS module_instance_id uuid REFERENCES public.module_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_re_recommendations_module_instance
ON public.re_recommendations (module_instance_id)
WHERE module_instance_id IS NOT NULL;
