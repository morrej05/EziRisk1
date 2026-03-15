/*
  # Fix module_instances INSERT RLS for assessment creation

  - Validate module insert permissions via parent document membership.
  - Keep tenant isolation by requiring module_instances.organisation_id to match documents.organisation_id.
  - Restore compatible editor roles: owner/admin/consultant (+surveyor legacy compatibility).
*/

DROP POLICY IF EXISTS "Editors can create org modules" ON public.module_instances;

CREATE POLICY "Editors can create org modules"
ON public.module_instances FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = module_instances.document_id
      AND d.organisation_id = module_instances.organisation_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant', 'surveyor')
  )
);
