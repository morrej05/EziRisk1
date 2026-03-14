/*
  # Auth hardening phase 2 follow-up
  - Fixes secure lifecycle RPCs for self-delete/member removal/ownership transfer guardrails
  - Removes legacy user_profiles fallback from core documents RLS
  - Finalises report identity split: locked audit identity + editable display identity
*/

-- =========================
-- A) Lifecycle flows (sole-owner guardrails + transfer endpoint support)
-- =========================
CREATE OR REPLACE FUNCTION public.transfer_org_ownership_secure(
  p_organisation_id UUID,
  p_to_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_to_role TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT om.role INTO v_actor_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = v_actor_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can transfer ownership';
  END IF;

  SELECT om.role INTO v_to_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = p_to_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_to_role IS NULL THEN
    RAISE EXCEPTION 'Transfer target must be an active organisation member';
  END IF;

  UPDATE public.organisation_members
  SET role = 'owner', updated_at = now()
  WHERE organisation_id = p_organisation_id
    AND user_id = p_to_user_id
    AND status = 'active';

  INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
  VALUES (
    p_organisation_id,
    v_actor_id,
    p_to_user_id,
    'ownership_transferred',
    jsonb_build_object('from_user_id', v_actor_id, 'to_user_id', p_to_user_id, 'trigger', 'explicit_transfer')
  );

  RETURN jsonb_build_object('ok', true, 'organisation_id', p_organisation_id, 'from_user_id', v_actor_id, 'to_user_id', p_to_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_org_member_secure(
  p_organisation_id UUID,
  p_target_user_id UUID,
  p_transfer_to_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_owner_count INTEGER;
  v_member_count INTEGER;
  v_transfer_role TEXT;
  v_is_self_remove BOOLEAN;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_is_self_remove := v_actor_id = p_target_user_id;

  SELECT om.role INTO v_actor_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = v_actor_id
    AND om.status = 'active'
  LIMIT 1;

  SELECT om.role INTO v_target_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = p_target_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not an active member of this organisation';
  END IF;

  IF NOT (
    v_actor_role IN ('owner', 'admin')
    OR v_is_self_remove
  ) THEN
    RAISE EXCEPTION 'Insufficient privileges to remove members';
  END IF;

  IF v_actor_role = 'admin' AND v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Only owners may remove owners';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.status = 'active'
    AND om.role = 'owner';

  SELECT COUNT(*) INTO v_member_count
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.status = 'active';

  IF v_target_role = 'owner' AND v_owner_count <= 1 THEN
    IF p_transfer_to_user_id IS NULL THEN
      RAISE EXCEPTION 'Cannot remove sole owner without ownership transfer';
    END IF;

    SELECT om.role INTO v_transfer_role
    FROM public.organisation_members om
    WHERE om.organisation_id = p_organisation_id
      AND om.user_id = p_transfer_to_user_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_transfer_role IS NULL THEN
      RAISE EXCEPTION 'Transfer target must be an active organisation member';
    END IF;

    UPDATE public.organisation_members
    SET role = 'owner', updated_at = now()
    WHERE organisation_id = p_organisation_id
      AND user_id = p_transfer_to_user_id
      AND status = 'active';

    INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
    VALUES (
      p_organisation_id,
      v_actor_id,
      p_target_user_id,
      'ownership_transferred',
      jsonb_build_object('from_user_id', p_target_user_id, 'to_user_id', p_transfer_to_user_id, 'trigger', 'member_removal_guardrail')
    );
  END IF;

  IF v_member_count <= 1 THEN
    RAISE EXCEPTION 'Cannot remove last active organisation member';
  END IF;

  UPDATE public.organisation_members
  SET status = 'removed', updated_at = now()
  WHERE organisation_id = p_organisation_id
    AND user_id = p_target_user_id
    AND status = 'active';

  UPDATE public.user_profiles up
  SET organisation_id = NULL,
      role = 'viewer',
      can_edit = false
  WHERE up.id = p_target_user_id
    AND up.organisation_id = p_organisation_id
    AND NOT EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = up.id
        AND om.status = 'active'
    );

  INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
  VALUES (
    p_organisation_id,
    v_actor_id,
    p_target_user_id,
    'member_removed',
    jsonb_build_object('actor_role', v_actor_role, 'target_role', v_target_role, 'is_self_remove', v_is_self_remove)
  );

  RETURN jsonb_build_object('ok', true, 'organisation_id', p_organisation_id, 'target_user_id', p_target_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_org_ownership_secure(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_org_member_secure(UUID, UUID, UUID) TO authenticated;

-- =========================
-- B) Membership-first RLS: remove legacy profile fallback on documents
-- =========================
DROP POLICY IF EXISTS "Users can view org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can create org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete org draft documents" ON public.documents;

CREATE POLICY "Users can view org documents"
ON public.documents FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Users can create org documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Users can update org documents"
ON public.documents FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

CREATE POLICY "Users can delete org draft documents"
ON public.documents FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- =========================
-- C) Report identity completion (audit identity immutable, display identity editable)
-- =========================
CREATE OR REPLACE FUNCTION public.set_document_author_snapshot()
RETURNS trigger AS $$
DECLARE
  v_name text;
  v_role text;
BEGIN
  IF NEW.created_by_user_id IS NULL THEN
    NEW.created_by_user_id := COALESCE(auth.uid(), NEW.created_by_user_id);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.created_by_user_id := OLD.created_by_user_id;
    NEW.author_profile_id := OLD.author_profile_id;

    IF OLD.issued_author_name_snapshot IS NOT NULL THEN
      NEW.issued_author_name_snapshot := OLD.issued_author_name_snapshot;
    END IF;

    IF OLD.issued_author_role_snapshot IS NOT NULL THEN
      NEW.issued_author_role_snapshot := OLD.issued_author_role_snapshot;
    END IF;

    IF OLD.issued_display_author_name IS NOT NULL THEN
      NEW.issued_display_author_name := OLD.issued_display_author_name;
    END IF;

    IF OLD.issued_display_author_role IS NOT NULL THEN
      NEW.issued_display_author_role := OLD.issued_display_author_role;
    END IF;

    IF OLD.issued_display_author_organisation IS NOT NULL THEN
      NEW.issued_display_author_organisation := OLD.issued_display_author_organisation;
    END IF;
  END IF;

  IF NEW.author_profile_id IS NULL THEN
    NEW.author_profile_id := NEW.created_by_user_id;
  END IF;

  IF NEW.author_name_snapshot IS NULL OR NEW.author_role_snapshot IS NULL THEN
    SELECT up.name, up.role INTO v_name, v_role
    FROM public.user_profiles up
    WHERE up.id = NEW.created_by_user_id;

    NEW.author_name_snapshot := COALESCE(NEW.author_name_snapshot, v_name, NEW.assessor_name);
    NEW.author_role_snapshot := COALESCE(NEW.author_role_snapshot, v_role, NEW.assessor_role);
  END IF;

  NEW.display_author_name := COALESCE(NEW.display_author_name, NEW.assessor_name, NEW.author_name_snapshot);
  NEW.display_author_role := COALESCE(NEW.display_author_role, NEW.assessor_role, NEW.author_role_snapshot);

  -- Legacy compatibility: old renderers still consume assessor_* but these are now display fields.
  NEW.assessor_name := COALESCE(NEW.assessor_name, NEW.display_author_name, NEW.author_name_snapshot);
  NEW.assessor_role := COALESCE(NEW.assessor_role, NEW.display_author_role, NEW.author_role_snapshot);

  IF NEW.status = 'issued' THEN
    NEW.issued_author_name_snapshot := COALESCE(NEW.issued_author_name_snapshot, NEW.author_name_snapshot);
    NEW.issued_author_role_snapshot := COALESCE(NEW.issued_author_role_snapshot, NEW.author_role_snapshot);

    NEW.issued_display_author_name := COALESCE(NEW.issued_display_author_name, NEW.display_author_name, NEW.assessor_name);
    NEW.issued_display_author_role := COALESCE(NEW.issued_display_author_role, NEW.display_author_role, NEW.assessor_role);
    NEW.issued_display_author_organisation := COALESCE(NEW.issued_display_author_organisation, NEW.display_author_organisation);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
