/*
  # Auth launch round 2: membership-first survey RLS normalization
  - Normalize survey-era authorization to organisation_members-first checks
  - Align role checks to owner/admin/consultant/viewer
  - Remove profile organisation fallback in active survey paths
*/

-- =========================
-- A) survey_reports membership-first policies
-- =========================
DROP POLICY IF EXISTS "Users can view own surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can view their survey reports" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can create surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can create reports" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can update own surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can update own reports" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can update own draft surveys only" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can delete own surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Users can delete own reports" ON public.survey_reports;
DROP POLICY IF EXISTS "Editors and admins can create surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Editors and admins can update own surveys" ON public.survey_reports;
DROP POLICY IF EXISTS "Editors and admins can delete own surveys" ON public.survey_reports;

CREATE POLICY "Users can view org surveys"
ON public.survey_reports FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = survey_reports.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create org surveys"
ON public.survey_reports FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = survey_reports.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update org draft surveys"
ON public.survey_reports FOR UPDATE TO authenticated
USING (
  status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = survey_reports.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = survey_reports.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Owners admins can delete org draft surveys"
ON public.survey_reports FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = survey_reports.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- =========================
-- B) survey_recommendations membership-first policies
-- =========================
DROP POLICY IF EXISTS "Users can view recommendations for own surveys" ON public.survey_recommendations;
DROP POLICY IF EXISTS "Users can insert recommendations for own surveys" ON public.survey_recommendations;
DROP POLICY IF EXISTS "Users can update recommendations for own surveys" ON public.survey_recommendations;
DROP POLICY IF EXISTS "Users can delete recommendations for own surveys" ON public.survey_recommendations;

CREATE POLICY "Users can view recommendations for org surveys"
ON public.survey_recommendations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = survey_recommendations.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can insert recommendations for org surveys"
ON public.survey_recommendations FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = survey_recommendations.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update recommendations for org surveys"
ON public.survey_recommendations FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = survey_recommendations.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = survey_recommendations.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Owners admins can delete recommendations for org surveys"
ON public.survey_recommendations FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = survey_recommendations.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);
