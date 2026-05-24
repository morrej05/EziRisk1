/*
  # Auth final closure: membership-first RLS for re_recommendations + organisations
*/

-- re_recommendations: membership-first via documents.organisation_id
DROP POLICY IF EXISTS "Users can view recommendations for accessible documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Users can create recommendations for accessible documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Users can update recommendations for accessible documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Users can delete recommendations for accessible documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Users can view recommendations for organisation documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Editors can create recommendations for organisation documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Editors can update recommendations for organisation documents" ON public.re_recommendations;
DROP POLICY IF EXISTS "Editors can delete recommendations for organisation documents" ON public.re_recommendations;

CREATE POLICY "Users can view recommendations for organisation documents"
ON public.re_recommendations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = re_recommendations.document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);

CREATE POLICY "Editors can create recommendations for organisation documents"
ON public.re_recommendations FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = re_recommendations.document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);

CREATE POLICY "Editors can update recommendations for organisation documents"
ON public.re_recommendations FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = re_recommendations.document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = re_recommendations.document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);

CREATE POLICY "Editors can delete recommendations for organisation documents"
ON public.re_recommendations FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = re_recommendations.document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);

-- organisations: membership-first, owner/admin for writes
DROP POLICY IF EXISTS "Users can read own organisation" ON public.organisations;
DROP POLICY IF EXISTS "Organisation admins can update" ON public.organisations;
DROP POLICY IF EXISTS "Platform admins can read all organisations" ON public.organisations;
DROP POLICY IF EXISTS "Platform admins can update all organisations" ON public.organisations;
DROP POLICY IF EXISTS "Users can read member organisations" ON public.organisations;
DROP POLICY IF EXISTS "Owners and admins can update member organisations" ON public.organisations;

CREATE POLICY "Users can read member organisations"
ON public.organisations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisations.id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);

CREATE POLICY "Owners and admins can update member organisations"
ON public.organisations FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisations.id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisations.id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.super_admins sa WHERE sa.id = auth.uid()
  )
);
