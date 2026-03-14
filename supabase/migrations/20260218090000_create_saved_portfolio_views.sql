/*
  # Create Saved Portfolio Views table

  Stores reusable portfolio filter scopes (not computed analytics).
*/

CREATE TABLE IF NOT EXISTS public.saved_portfolio_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_portfolio_views_org_created_at
  ON public.saved_portfolio_views (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_portfolio_views_created_by
  ON public.saved_portfolio_views (created_by);

ALTER TABLE public.saved_portfolio_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view saved portfolio views in their organisation" ON public.saved_portfolio_views;
CREATE POLICY "Users can view saved portfolio views in their organisation"
  ON public.saved_portfolio_views
  FOR SELECT
  USING (
    organisation_id = (
      SELECT organisation_id
      FROM public.user_profiles
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create saved portfolio views in their organisation" ON public.saved_portfolio_views;
CREATE POLICY "Users can create saved portfolio views in their organisation"
  ON public.saved_portfolio_views
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND organisation_id = (
      SELECT organisation_id
      FROM public.user_profiles
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their saved portfolio views" ON public.saved_portfolio_views;
CREATE POLICY "Users can delete their saved portfolio views"
  ON public.saved_portfolio_views
  FOR DELETE
  USING (
    organisation_id = (
      SELECT organisation_id
      FROM public.user_profiles
      WHERE id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.user_profiles
        WHERE id = auth.uid()
          AND is_platform_admin = true
      )
    )
  );
