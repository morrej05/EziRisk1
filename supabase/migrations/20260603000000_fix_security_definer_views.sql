-- Fix: security_definer_view linter warning
--
-- PostgreSQL views run as the view owner by default (SECURITY DEFINER semantics),
-- which bypasses RLS on the underlying tables.
-- Recreating both affected views with security_invoker = true means they execute
-- as the querying user, so RLS policies on the underlying tables are enforced.
--
-- Affected views:
--   public.document_lifecycle_health
--   public.action_register_site_level

-- ---------------------------------------------------------------------------
-- 1. document_lifecycle_health
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.document_lifecycle_health;

CREATE VIEW public.document_lifecycle_health
WITH (security_invoker = true)
AS
SELECT
  d.organisation_id,
  d.base_document_id,
  COUNT(*) AS total_versions,
  COUNT(*) FILTER (
    WHERE d.issue_status = 'draft'
      AND d.deleted_at IS NULL
      AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
  ) AS draft_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'issued') AS issued_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'superseded') AS superseded_count,
  COUNT(*) FILTER (WHERE d.issue_status = 'archived' OR d.deleted_at IS NOT NULL OR d.status = 'archived') AS archived_count,
  MAX(d.version_number) AS latest_version,
  CASE
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') > 1 THEN 'ERROR: Multiple issued'
    WHEN COUNT(*) FILTER (
      WHERE d.issue_status = 'draft'
        AND d.deleted_at IS NULL
        AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
    ) > 1 THEN 'ERROR: Multiple active drafts'
    WHEN COUNT(*) FILTER (WHERE d.issue_status = 'issued') = 0
      AND COUNT(*) FILTER (
        WHERE d.issue_status = 'draft'
          AND d.deleted_at IS NULL
          AND COALESCE(d.status, 'draft') NOT IN ('deleted', 'archived')
      ) = 0 THEN 'WARNING: No active version'
    ELSE 'OK'
  END AS health_status
FROM public.documents d
GROUP BY d.organisation_id, d.base_document_id;

GRANT SELECT ON public.document_lifecycle_health TO authenticated;
REVOKE ALL ON public.document_lifecycle_health FROM anon;

-- ---------------------------------------------------------------------------
-- 2. action_register_site_level
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.action_register_site_level;

CREATE VIEW public.action_register_site_level
WITH (security_invoker = true)
AS
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
REVOKE ALL ON public.action_register_site_level FROM anon;
