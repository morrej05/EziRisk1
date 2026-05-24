/*
  # Durable action source links for detailed FRA findings

  Links detailed module assessment findings to real action register rows without
  relying on module_instances.data free-text references.
*/

CREATE TABLE IF NOT EXISTS public.action_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  module_instance_id uuid NOT NULL REFERENCES public.module_instances(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
  source_assessment_type text NOT NULL,
  source_assessment_key text NOT NULL,
  source_assessment_label text,
  source_finding_hash text,
  created_at timestamptz DEFAULT now(),
  carried_from_link_id uuid NULL REFERENCES public.action_source_links(id),
  deleted_at timestamptz NULL,
  CONSTRAINT action_source_links_module_document_check
    CHECK (source_assessment_type <> '' AND source_assessment_key <> '')
);

CREATE INDEX IF NOT EXISTS idx_action_source_links_action_id
  ON public.action_source_links(action_id);
CREATE INDEX IF NOT EXISTS idx_action_source_links_document_id
  ON public.action_source_links(document_id);
CREATE INDEX IF NOT EXISTS idx_action_source_links_module_instance_id
  ON public.action_source_links(module_instance_id);
CREATE INDEX IF NOT EXISTS idx_action_source_links_source_assessment
  ON public.action_source_links(source_assessment_type, source_assessment_key);
CREATE INDEX IF NOT EXISTS idx_action_source_links_organisation_id
  ON public.action_source_links(organisation_id);
CREATE INDEX IF NOT EXISTS idx_action_source_links_active_finding
  ON public.action_source_links(document_id, module_instance_id, source_assessment_type, source_assessment_key)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_source_links_active_finding
  ON public.action_source_links(document_id, module_instance_id, source_assessment_type, source_assessment_key)
  WHERE deleted_at IS NULL;

ALTER TABLE public.action_source_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org action source links"
ON public.action_source_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = action_source_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can create action source links in editable documents"
ON public.action_source_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = action_source_links.document_id
      AND d.organisation_id = action_source_links.organisation_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
  AND EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_source_links.action_id
      AND a.document_id = action_source_links.document_id
      AND a.organisation_id = action_source_links.organisation_id
      AND a.deleted_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.module_instances mi
    WHERE mi.id = action_source_links.module_instance_id
      AND mi.document_id = action_source_links.document_id
      AND mi.organisation_id = action_source_links.organisation_id
  )
);

CREATE POLICY "Editors can update action source links in editable documents"
ON public.action_source_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = action_source_links.document_id
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
    WHERE d.id = action_source_links.document_id
      AND d.organisation_id = action_source_links.organisation_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Editors can delete action source links in editable documents"
ON public.action_source_links FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.organisation_members om ON om.organisation_id = d.organisation_id
    WHERE d.id = action_source_links.document_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP VIEW IF EXISTS public.action_register_site_level;
CREATE OR REPLACE VIEW public.action_register_site_level AS
SELECT
  a.id,
  a.organisation_id,
  a.document_id,
  d.title AS document_title,
  d.document_type,
  d.base_document_id,
  d.version_number,
  d.issue_status,
  d.issue_date,
  a.module_instance_id,
  mi.module_key,
  mi.outcome AS module_outcome,
  a.recommended_action,
  a.priority_band,
  a.timescale,
  a.target_date,
  a.status,
  a.owner_user_id,
  up.name AS owner_name,
  a.source,
  a.created_at,
  a.closed_at,
  a.carried_from_document_id,
  a.origin_action_id,
  COALESCE(jsonb_agg(jsonb_build_object(
    'id', asl.id,
    'module_key', mi.module_key,
    'source_assessment_type', asl.source_assessment_type,
    'source_assessment_key', asl.source_assessment_key,
    'source_assessment_label', asl.source_assessment_label,
    'source_finding_hash', asl.source_finding_hash
  ) ORDER BY asl.created_at) FILTER (WHERE asl.id IS NOT NULL), '[]'::jsonb) AS source_links,
  string_agg(DISTINCT concat_ws(' — ', CASE asl.source_assessment_type WHEN 'ignition_source_assessments' THEN 'Fire hazards' WHEN 'means_of_escape_assessments' THEN 'Means of Escape' WHEN 'passive_fire_protection_assessments' THEN 'Passive Fire Protection' WHEN 'fire_safety_management_assessments' THEN 'Fire Safety Management' ELSE mi.module_key END, asl.source_assessment_label), '; ') FILTER (WHERE asl.id IS NOT NULL) AS source_context,
  CASE
    WHEN a.status = 'closed' THEN 'closed'
    WHEN a.target_date < CURRENT_DATE THEN 'overdue'
    WHEN a.target_date < CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
    ELSE 'on_track'
  END AS tracking_status,
  EXTRACT(DAY FROM (CURRENT_DATE::timestamp with time zone - a.created_at)) AS age_days
FROM public.actions a
LEFT JOIN public.documents d ON a.document_id = d.id
LEFT JOIN public.user_profiles up ON a.owner_user_id = up.id
LEFT JOIN public.module_instances mi ON a.module_instance_id = mi.id
LEFT JOIN public.action_source_links asl ON asl.action_id = a.id AND asl.deleted_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, d.title, d.document_type, d.base_document_id, d.version_number, d.issue_status, d.issue_date, mi.module_key, mi.outcome, up.name;

GRANT SELECT ON public.action_register_site_level TO authenticated;
