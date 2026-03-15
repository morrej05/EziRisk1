/*
  # Align assessment creation RLS with canonical V1 roles

  - Update documents/module_instances write policies to use admin|surveyor roles.
  - Keep view policies membership-first and status-gated.
  - This removes launch-blocking dependency on legacy consultant role names.
*/

-- documents (create/update/delete draft)
DROP POLICY IF EXISTS "Users can create org documents" ON public.documents;
CREATE POLICY "Users can create org documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);

DROP POLICY IF EXISTS "Users can update org documents" ON public.documents;
CREATE POLICY "Users can update org documents"
ON public.documents FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);

DROP POLICY IF EXISTS "Users can delete org draft documents" ON public.documents;
CREATE POLICY "Users can delete org draft documents"
ON public.documents FOR DELETE TO authenticated
USING (
  COALESCE(documents.issue_status, 'draft') = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);

-- module_instances (insert/update/delete for editable docs)
DROP POLICY IF EXISTS "Editors can create org modules" ON public.module_instances;
CREATE POLICY "Editors can create org modules"
ON public.module_instances FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = module_instances.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);

DROP POLICY IF EXISTS "Editors can update modules in editable documents" ON public.module_instances;
CREATE POLICY "Editors can update modules in editable documents"
ON public.module_instances FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = module_instances.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = module_instances.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);

DROP POLICY IF EXISTS "Editors can delete modules in editable documents" ON public.module_instances;
CREATE POLICY "Editors can delete modules in editable documents"
ON public.module_instances FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = module_instances.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('admin', 'surveyor')
  )
);
