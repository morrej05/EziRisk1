/*
  # Auth hardening phase 2
  - Secure account/member deletion lifecycle with sole-owner guardrails
  - Membership-first RLS completion on core defence/audit tables
  - Stronger document author identity immutability with display/audit separation
*/

-- =========================
-- A) Lifecycle audit and secure member/account operations
-- =========================
CREATE TABLE IF NOT EXISTS public.account_lifecycle_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  organisation_id UUID REFERENCES public.organisations(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('member_removed', 'ownership_transferred', 'account_self_delete_requested')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_account_lifecycle_audit_org_created_at
  ON public.account_lifecycle_audit (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_lifecycle_audit_target
  ON public.account_lifecycle_audit (target_user_id, created_at DESC);

ALTER TABLE public.account_lifecycle_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org owners/admins can view lifecycle audit" ON public.account_lifecycle_audit;
CREATE POLICY "Org owners/admins can view lifecycle audit"
ON public.account_lifecycle_audit FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = account_lifecycle_audit.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
  OR actor_user_id = auth.uid()
  OR target_user_id = auth.uid()
);

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
  v_transfer_role TEXT;
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

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient privileges to remove members';
  END IF;

  SELECT om.role INTO v_target_role
  FROM public.organisation_members om
  WHERE om.organisation_id = p_organisation_id
    AND om.user_id = p_target_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not an active member of this organisation';
  END IF;

  IF v_actor_role = 'admin' AND v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Only owners may remove owners';
  END IF;

  IF v_target_role = 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.organisation_members om
    WHERE om.organisation_id = p_organisation_id
      AND om.status = 'active'
      AND om.role = 'owner';

    IF v_owner_count <= 1 THEN
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
        jsonb_build_object('from_user_id', p_target_user_id, 'to_user_id', p_transfer_to_user_id)
      );
    END IF;
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
    jsonb_build_object('actor_role', v_actor_role, 'target_role', v_target_role)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.self_delete_account_secure(
  p_transfer_organisation_id UUID DEFAULT NULL,
  p_transfer_to_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_membership RECORD;
  v_owner_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  FOR v_membership IN
    SELECT organisation_id, role
    FROM public.organisation_members
    WHERE user_id = v_user_id
      AND status = 'active'
  LOOP
    IF v_membership.role = 'owner' THEN
      SELECT COUNT(*) INTO v_owner_count
      FROM public.organisation_members om
      WHERE om.organisation_id = v_membership.organisation_id
        AND om.status = 'active'
        AND om.role = 'owner';

      IF v_owner_count <= 1 THEN
        IF p_transfer_organisation_id IS DISTINCT FROM v_membership.organisation_id OR p_transfer_to_user_id IS NULL THEN
          RAISE EXCEPTION 'Ownership transfer required before deleting sole owner account for organisation %', v_membership.organisation_id;
        END IF;

        PERFORM public.remove_org_member_secure(v_membership.organisation_id, v_user_id, p_transfer_to_user_id);
      ELSE
        PERFORM public.remove_org_member_secure(v_membership.organisation_id, v_user_id, NULL);
      END IF;
    ELSE
      PERFORM public.remove_org_member_secure(v_membership.organisation_id, v_user_id, NULL);
    END IF;
  END LOOP;

  UPDATE public.user_profiles
  SET name = 'Deleted User',
      role = 'viewer',
      can_edit = false,
      organisation_id = NULL,
      is_platform_admin = false
  WHERE id = v_user_id;

  DELETE FROM public.user_legal_acceptances
  WHERE user_id = v_user_id;

  INSERT INTO public.account_lifecycle_audit (organisation_id, actor_user_id, target_user_id, event_type, details)
  VALUES (NULL, v_user_id, v_user_id, 'account_self_delete_requested', jsonb_build_object('strategy', 'anonymise_and_auth_delete'));

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_org_member_secure(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.self_delete_account_secure(UUID, UUID) TO authenticated;

-- =========================
-- B) Membership-first authorisation completion on core defence/audit tables
-- =========================
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

DROP POLICY IF EXISTS "Users view own links" ON public.external_access_links;
CREATE POLICY "Users view own links"
ON public.external_access_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = external_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS "Editors create links" ON public.external_access_links;
CREATE POLICY "Editors create links"
ON public.external_access_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = external_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP POLICY IF EXISTS "Editors update links" ON public.external_access_links;
CREATE POLICY "Editors update links"
ON public.external_access_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = external_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = external_access_links.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP POLICY IF EXISTS "Users view own audit" ON public.access_audit_log;
CREATE POLICY "Users view own audit"
ON public.access_audit_log FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = access_audit_log.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS "Users view own packs" ON public.defence_packs;
CREATE POLICY "Users view own packs"
ON public.defence_packs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = defence_packs.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS "Editors create packs" ON public.defence_packs;
CREATE POLICY "Editors create packs"
ON public.defence_packs FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = defence_packs.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant')
  )
);

DROP POLICY IF EXISTS "Users can view audit logs for their org surveys" ON public.audit_log;
CREATE POLICY "Users can view audit logs for their org surveys"
ON public.audit_log FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = audit_log.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

-- =========================
-- C) Report identity completion (audit identity immutable, display identity editable)
-- =========================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS display_author_name TEXT,
  ADD COLUMN IF NOT EXISTS display_author_role TEXT,
  ADD COLUMN IF NOT EXISTS display_author_organisation TEXT,
  ADD COLUMN IF NOT EXISTS issued_display_author_name TEXT,
  ADD COLUMN IF NOT EXISTS issued_display_author_role TEXT,
  ADD COLUMN IF NOT EXISTS issued_display_author_organisation TEXT;

UPDATE public.documents
SET display_author_name = COALESCE(display_author_name, assessor_name),
    display_author_role = COALESCE(display_author_role, assessor_role),
    issued_display_author_name = COALESCE(issued_display_author_name, issued_author_name_snapshot, assessor_name),
    issued_display_author_role = COALESCE(issued_display_author_role, issued_author_role_snapshot, assessor_role)
WHERE display_author_name IS NULL
   OR display_author_role IS NULL
   OR issued_display_author_name IS NULL
   OR issued_display_author_role IS NULL;

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
