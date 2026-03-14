/*
  # Auth launch round 3: final membership-first hardening
  - Removes remaining org fallback/legacy role literals on targeted legacy tables
  - Aligns RLS write access to owner/admin/consultant/viewer model
*/

-- attachments
DROP POLICY IF EXISTS "Users can view organisation attachments" ON public.attachments;
DROP POLICY IF EXISTS "Users can insert organisation attachments" ON public.attachments;
DROP POLICY IF EXISTS "Users can update organisation attachments" ON public.attachments;
DROP POLICY IF EXISTS "Users can delete organisation attachments" ON public.attachments;
DROP POLICY IF EXISTS "Users can update attachments in editable documents" ON public.attachments;
DROP POLICY IF EXISTS "Users can delete attachments in editable documents" ON public.attachments;

CREATE POLICY "Users can view organisation attachments"
ON public.attachments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = attachments.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can insert organisation attachments"
ON public.attachments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = attachments.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update attachments in editable documents"
ON public.attachments FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = attachments.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = attachments.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can delete attachments in editable documents"
ON public.attachments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = attachments.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

-- module_instances
DROP POLICY IF EXISTS "Users can view org modules" ON public.module_instances;
DROP POLICY IF EXISTS "Users can create org modules" ON public.module_instances;
DROP POLICY IF EXISTS "Users can update org modules" ON public.module_instances;
DROP POLICY IF EXISTS "Users can delete org modules" ON public.module_instances;
DROP POLICY IF EXISTS "Users can update modules in editable documents" ON public.module_instances;
DROP POLICY IF EXISTS "Users can delete modules in editable documents" ON public.module_instances;

CREATE POLICY "Users can view org modules"
ON public.module_instances FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = module_instances.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create org modules"
ON public.module_instances FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = module_instances.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

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
      AND om.role IN ('owner', 'admin', 'consultant')
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
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

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
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

-- actions
DROP POLICY IF EXISTS "Users can view org actions" ON public.actions;
DROP POLICY IF EXISTS "Users can create org actions" ON public.actions;
DROP POLICY IF EXISTS "Users can update org actions" ON public.actions;
DROP POLICY IF EXISTS "Users can delete org actions" ON public.actions;
DROP POLICY IF EXISTS "Users can update actions in editable documents" ON public.actions;
DROP POLICY IF EXISTS "Users can delete actions in editable documents" ON public.actions;

CREATE POLICY "Users can view org actions"
ON public.actions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = actions.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create org actions"
ON public.actions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = actions.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update actions in editable documents"
ON public.actions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = actions.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = actions.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can delete actions in editable documents"
ON public.actions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = actions.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

-- assessments
DROP POLICY IF EXISTS "Platform admins can view all assessments" ON public.assessments;
DROP POLICY IF EXISTS "Organisation members can view org assessments" ON public.assessments;
DROP POLICY IF EXISTS "Organisation members can create assessments" ON public.assessments;
DROP POLICY IF EXISTS "Organisation members can update org assessments" ON public.assessments;
DROP POLICY IF EXISTS "Organisation members can delete org draft assessments" ON public.assessments;

CREATE POLICY "Users can view org assessments"
ON public.assessments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = assessments.org_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create org assessments"
ON public.assessments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = assessments.org_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update org assessments"
ON public.assessments FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = assessments.org_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = assessments.org_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Owners admins can delete org draft assessments"
ON public.assessments FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = assessments.org_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- assessment_responses
DROP POLICY IF EXISTS "Organisation members can view assessment responses" ON public.assessment_responses;
DROP POLICY IF EXISTS "Organisation members can create assessment responses" ON public.assessment_responses;
DROP POLICY IF EXISTS "Organisation members can update assessment responses" ON public.assessment_responses;
DROP POLICY IF EXISTS "Organisation members can delete assessment responses" ON public.assessment_responses;

CREATE POLICY "Users can view assessment responses"
ON public.assessment_responses FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessments a
    JOIN public.organisation_members om ON om.organisation_id = a.org_id
    WHERE a.id = assessment_responses.assessment_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create assessment responses"
ON public.assessment_responses FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.assessments a
    JOIN public.organisation_members om ON om.organisation_id = a.org_id
    WHERE a.id = assessment_responses.assessment_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update assessment responses"
ON public.assessment_responses FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessments a
    JOIN public.organisation_members om ON om.organisation_id = a.org_id
    WHERE a.id = assessment_responses.assessment_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.assessments a
    JOIN public.organisation_members om ON om.organisation_id = a.org_id
    WHERE a.id = assessment_responses.assessment_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can delete assessment responses"
ON public.assessment_responses FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.assessments a
    JOIN public.organisation_members om ON om.organisation_id = a.org_id
    WHERE a.id = assessment_responses.assessment_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

-- document_access_links
DROP POLICY IF EXISTS "Users can view organisation access links" ON public.document_access_links;
DROP POLICY IF EXISTS "Users can create organisation access links" ON public.document_access_links;
DROP POLICY IF EXISTS "Users can update organisation access links" ON public.document_access_links;
DROP POLICY IF EXISTS "Users can delete organisation access links" ON public.document_access_links;

CREATE POLICY "Users can view organisation access links"
ON public.document_access_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create organisation access links"
ON public.document_access_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can update organisation access links"
ON public.document_access_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Owners admins can delete organisation access links"
ON public.document_access_links FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- organisation_settings
DROP POLICY IF EXISTS "Organisation members can view settings" ON public.organisation_settings;
DROP POLICY IF EXISTS "Org admins can update settings" ON public.organisation_settings;

CREATE POLICY "Organisation members can view settings"
ON public.organisation_settings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = organisation_settings.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Owners admins can update settings"
ON public.organisation_settings FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = organisation_settings.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = organisation_settings.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- external link tables
DROP POLICY IF EXISTS "Admin users can manage all external links" ON public.external_links;
DROP POLICY IF EXISTS "Surveyors can manage links for own surveys" ON public.external_links;

CREATE POLICY "Members can view external links for org surveys"
ON public.external_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = external_links.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can manage external links for org surveys"
ON public.external_links FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.survey_reports sr
    JOIN public.organisation_members om ON om.organisation_id = sr.organisation_id
    WHERE sr.id = external_links.survey_id
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
    WHERE sr.id = external_links.survey_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP POLICY IF EXISTS "Internal users can view organisation client users" ON public.client_users;
DROP POLICY IF EXISTS "Org admins can manage client users" ON public.client_users;
DROP POLICY IF EXISTS "Internal users can view client access grants" ON public.client_document_access;
DROP POLICY IF EXISTS "Org admins can manage client access" ON public.client_document_access;
DROP POLICY IF EXISTS "Internal users can view external links" ON public.document_external_links;
DROP POLICY IF EXISTS "Editors can create external links" ON public.document_external_links;
DROP POLICY IF EXISTS "Org admins can manage external links" ON public.document_external_links;

CREATE POLICY "Members can view organisation client users"
ON public.client_users FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = client_users.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Owners admins can manage client users"
ON public.client_users FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = client_users.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = client_users.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Members can view client access grants"
ON public.client_document_access FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.client_users cu
    JOIN public.organisation_members om ON om.organisation_id = cu.organisation_id
    WHERE cu.id = client_document_access.client_user_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Owners admins can manage client access"
ON public.client_document_access FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.client_users cu
    JOIN public.organisation_members om ON om.organisation_id = cu.organisation_id
    WHERE cu.id = client_document_access.client_user_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.client_users cu
    JOIN public.organisation_members om ON om.organisation_id = cu.organisation_id
    WHERE cu.id = client_document_access.client_user_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Members can view document external links"
ON public.document_external_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.base_document_id = document_external_links.base_document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create document external links"
ON public.document_external_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.base_document_id = document_external_links.base_document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Owners admins can manage document external links"
ON public.document_external_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.base_document_id = document_external_links.base_document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.base_document_id = document_external_links.base_document_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);
