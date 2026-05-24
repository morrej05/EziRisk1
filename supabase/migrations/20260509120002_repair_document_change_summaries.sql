/*
  # Repair document_change_summaries availability

  Production safety migration for environments where the historical outputs
  migration did not create public.document_change_summaries or PostgREST cannot
  expose it. The application treats issue/change summaries as informational, but
  the table should exist for audit/change-history features.
*/

CREATE TABLE IF NOT EXISTS public.document_change_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  base_document_id uuid,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  previous_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  version_number int,

  new_actions_count int DEFAULT 0,
  closed_actions_count int DEFAULT 0,
  reopened_actions_count int DEFAULT 0,
  outstanding_actions_count int DEFAULT 0,
  new_actions jsonb DEFAULT '[]'::jsonb,
  closed_actions jsonb DEFAULT '[]'::jsonb,
  reopened_actions jsonb DEFAULT '[]'::jsonb,

  risk_rating_changes jsonb DEFAULT '[]'::jsonb,
  material_field_changes jsonb DEFAULT '[]'::jsonb,

  summary_text text,
  summary_markdown text,
  has_material_changes boolean DEFAULT false,
  visible_to_client boolean DEFAULT true,

  generated_at timestamptz DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.document_change_summaries
  ADD COLUMN IF NOT EXISTS base_document_id uuid,
  ADD COLUMN IF NOT EXISTS version_number int,
  ADD COLUMN IF NOT EXISTS summary_markdown text;

CREATE INDEX IF NOT EXISTS idx_change_summaries_document
  ON public.document_change_summaries(document_id);
CREATE INDEX IF NOT EXISTS idx_change_summaries_org
  ON public.document_change_summaries(organisation_id);
CREATE INDEX IF NOT EXISTS idx_change_summaries_base_document
  ON public.document_change_summaries(organisation_id, base_document_id);
CREATE INDEX IF NOT EXISTS idx_document_change_summaries_base_version
  ON public.document_change_summaries(base_document_id, version_number DESC);

ALTER TABLE public.document_change_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own org summaries" ON public.document_change_summaries;
CREATE POLICY "Users view own org summaries"
ON public.document_change_summaries FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_change_summaries.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS "Editors create summaries" ON public.document_change_summaries;
CREATE POLICY "Editors create summaries"
ON public.document_change_summaries FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_change_summaries.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP POLICY IF EXISTS "Editors delete summaries" ON public.document_change_summaries;
CREATE POLICY "Editors delete summaries"
ON public.document_change_summaries FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = document_change_summaries.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

GRANT SELECT, INSERT, DELETE ON public.document_change_summaries TO authenticated;
