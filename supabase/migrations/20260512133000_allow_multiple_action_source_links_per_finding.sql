/*
  Allow one detailed assessment finding to link to multiple action register rows.

  The previous active-finding unique index enforced a strict one-finding-one-action
  model. Keep duplicate protection only for the same action being linked to the
  same source area more than once while allowing different action_id values.
*/

DROP INDEX IF EXISTS public.uq_action_source_links_active_finding;

CREATE UNIQUE INDEX IF NOT EXISTS uq_action_source_links_active_finding_action
  ON public.action_source_links(document_id, module_instance_id, source_assessment_type, source_assessment_key, action_id)
  WHERE deleted_at IS NULL;
