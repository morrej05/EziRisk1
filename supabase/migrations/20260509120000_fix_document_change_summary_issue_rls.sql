/*
  # Fix document issue change-summary RLS

  The issue flow marks a document as issued and then writes a row to
  document_change_summaries for the issue/change audit summary. The previous
  INSERT policy only allowed a narrow organisation_members role set and did not
  account for platform admins or the legacy can_edit editor entitlement, which
  caused authenticated users who could issue the document to fail the later
  summary insert with RLS error 42501.
*/

CREATE OR REPLACE FUNCTION public.can_write_document_change_summary(
  p_organisation_id uuid,
  p_document_id uuid,
  p_generated_by uuid DEFAULT NULL
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

  -- Client-side inserts must attribute the summary to the signed-in actor.
  IF p_generated_by IS NOT NULL AND p_generated_by <> v_user_id THEN
    RETURN false;
  END IF;

  -- The summary must belong to the same organisation as the document it audits.
  IF NOT EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.id = p_document_id
      AND d.organisation_id = p_organisation_id
  ) THEN
    RETURN false;
  END IF;

  -- Platform admins may support issue flows across organisations without
  -- disabling RLS or using an anon/service bypass from the client.
  IF EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.is_platform_admin = true
  ) THEN
    RETURN true;
  END IF;

  -- Membership-first authorisation for organisation owners/admins/editors.
  IF EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = p_organisation_id
      AND om.user_id = v_user_id
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  ) THEN
    RETURN true;
  END IF;

  -- Legacy editor entitlement compatibility for accounts not yet represented
  -- as consultant rows in organisation_members.
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

GRANT EXECUTE ON FUNCTION public.can_write_document_change_summary(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Editors create summaries" ON public.document_change_summaries;
CREATE POLICY "Editors create summaries"
ON public.document_change_summaries FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_document_change_summary(
    document_change_summaries.organisation_id,
    document_change_summaries.document_id,
    document_change_summaries.generated_by
  )
);

DROP POLICY IF EXISTS "Editors delete summaries" ON public.document_change_summaries;
CREATE POLICY "Editors delete summaries"
ON public.document_change_summaries FOR DELETE TO authenticated
USING (
  public.can_write_document_change_summary(
    document_change_summaries.organisation_id,
    document_change_summaries.document_id,
    auth.uid()
  )
);
