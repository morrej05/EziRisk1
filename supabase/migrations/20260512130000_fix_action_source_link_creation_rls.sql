/*
  # Fix detailed finding action source link creation

  Authenticated assessors can create action rows through the existing actions RLS
  policies, but action_source_links used a narrower organisation_members role
  check. That let the action insert succeed and the follow-up link insert fail
  with an RLS HTTP 400/42501, leaving an orphan action.

  This migration centralises action-source-link write authorisation, keeps the
  document/module/action organisation checks, allows legacy can_edit assessor
  accounts, and preserves draft-document isolation for writes.
*/

CREATE OR REPLACE FUNCTION public.can_write_action_source_link(
  p_organisation_id uuid,
  p_document_id uuid,
  p_module_instance_id uuid,
  p_action_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.id = p_document_id
      AND d.organisation_id = p_organisation_id
      AND COALESCE(d.issue_status, 'draft') = 'draft'
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.module_instances mi
    WHERE mi.id = p_module_instance_id
      AND mi.document_id = p_document_id
      AND mi.organisation_id = p_organisation_id
  ) THEN
    RETURN false;
  END IF;

  IF p_action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.actions a
    WHERE a.id = p_action_id
      AND a.document_id = p_document_id
      AND a.organisation_id = p_organisation_id
      AND a.deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.is_platform_admin = true
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = p_organisation_id
      AND om.user_id = v_user_id
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant', 'surveyor')
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.organisation_id = p_organisation_id
      AND up.can_edit = true
      AND up.role IN ('owner', 'admin', 'consultant', 'surveyor')
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_write_action_source_link(uuid, uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view org action source links" ON public.action_source_links;
CREATE POLICY "Users can view org action source links"
ON public.action_source_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = action_source_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND (
        up.is_platform_admin = true
        OR up.organisation_id = action_source_links.organisation_id
      )
  )
);

DROP POLICY IF EXISTS "Editors can create action source links in editable documents" ON public.action_source_links;
CREATE POLICY "Editors can create action source links in editable documents"
ON public.action_source_links FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_action_source_link(
    action_source_links.organisation_id,
    action_source_links.document_id,
    action_source_links.module_instance_id,
    action_source_links.action_id
  )
);

DROP POLICY IF EXISTS "Editors can update action source links in editable documents" ON public.action_source_links;
CREATE POLICY "Editors can update action source links in editable documents"
ON public.action_source_links FOR UPDATE TO authenticated
USING (
  public.can_write_action_source_link(
    action_source_links.organisation_id,
    action_source_links.document_id,
    action_source_links.module_instance_id,
    action_source_links.action_id
  )
)
WITH CHECK (
  public.can_write_action_source_link(
    action_source_links.organisation_id,
    action_source_links.document_id,
    action_source_links.module_instance_id,
    action_source_links.action_id
  )
);

DROP POLICY IF EXISTS "Editors can delete action source links in editable documents" ON public.action_source_links;
CREATE POLICY "Editors can delete action source links in editable documents"
ON public.action_source_links FOR DELETE TO authenticated
USING (
  public.can_write_action_source_link(
    action_source_links.organisation_id,
    action_source_links.document_id,
    action_source_links.module_instance_id,
    action_source_links.action_id
  )
);

-- Keep the central action register view aligned with ActionRegisterEntry after the
-- action-source-links migration recreated it.
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
  a.reference_number,
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
