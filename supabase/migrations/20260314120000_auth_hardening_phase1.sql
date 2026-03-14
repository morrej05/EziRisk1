/*
  # Auth hardening phase 1 (launch)
  - Adds legal disclaimer acceptance audit trail
  - Adds organisation_members as source-of-truth membership table (with backfill)
  - Introduces owner/admin/consultant/viewer role model with surveyor compatibility
  - Hardens documents author identity with authenticated creator and immutable issue snapshot
  - Adds helper functions and policy updates to move authorization toward organisation_members
*/

-- =========================
-- Phase A: Legal disclaimer gate
-- =========================
CREATE TABLE IF NOT EXISTS public.user_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_document_type TEXT NOT NULL CHECK (legal_document_type IN ('disclaimer')),
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_ip INET,
  accepted_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, legal_document_type, version)
);

ALTER TABLE public.user_legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own legal acceptances" ON public.user_legal_acceptances;
CREATE POLICY "Users can view own legal acceptances"
ON public.user_legal_acceptances FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own legal acceptances" ON public.user_legal_acceptances;
CREATE POLICY "Users can insert own legal acceptances"
ON public.user_legal_acceptances FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- =========================
-- Phase B/C: organisation membership + roles
-- =========================
CREATE TABLE IF NOT EXISTS public.organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'consultant', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  invited_by_user_id UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organisation_members_user_id ON public.organisation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organisation_members_org_status ON public.organisation_members(organisation_id, status);

ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org memberships" ON public.organisation_members;
CREATE POLICY "Users can view own org memberships"
ON public.organisation_members FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Org admins can view org memberships" ON public.organisation_members;
CREATE POLICY "Org admins can view org memberships"
ON public.organisation_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisation_members.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS "Org owners and admins can manage memberships" ON public.organisation_members;
CREATE POLICY "Org owners and admins can manage memberships"
ON public.organisation_members FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisation_members.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = organisation_members.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);

-- Backfill from legacy user_profiles.organisation_id / role
INSERT INTO public.organisation_members (organisation_id, user_id, role, status, joined_at)
SELECT
  up.organisation_id,
  up.id,
  CASE
    WHEN up.role = 'owner' THEN 'owner'
    WHEN up.role = 'admin' THEN 'admin'
    WHEN up.role IN ('surveyor', 'consultant') THEN 'consultant'
    ELSE 'viewer'
  END,
  'active',
  now()
FROM public.user_profiles up
WHERE up.organisation_id IS NOT NULL
ON CONFLICT (organisation_id, user_id) DO NOTHING;

-- keep legacy roles temporarily compatible while migrating UI and policies
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('owner', 'admin', 'consultant', 'viewer', 'surveyor'));

UPDATE public.user_profiles
SET role = 'consultant'
WHERE role = 'surveyor';

ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'viewer';

-- =========================
-- Phase D: author identity hardening
-- =========================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS author_profile_id UUID REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS author_role_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS issued_author_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS issued_author_role_snapshot TEXT;

UPDATE public.documents d
SET created_by_user_id = up.id
FROM public.user_profiles up
WHERE d.created_by_user_id IS NULL
  AND up.organisation_id = d.organisation_id
  AND up.role IN ('owner', 'admin', 'consultant', 'surveyor')
  AND up.id = (
    SELECT up2.id
    FROM public.user_profiles up2
    WHERE up2.organisation_id = d.organisation_id
      AND up2.role IN ('owner', 'admin', 'consultant', 'surveyor')
    ORDER BY up2.created_at ASC
    LIMIT 1
  );

UPDATE public.documents d
SET author_profile_id = up.id,
    author_name_snapshot = COALESCE(d.author_name_snapshot, up.name, d.assessor_name),
    author_role_snapshot = COALESCE(d.author_role_snapshot, up.role, d.assessor_role)
FROM public.user_profiles up
WHERE up.id = d.created_by_user_id
  AND d.author_profile_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_document_author_snapshot()
RETURNS trigger AS $$
DECLARE
  v_name text;
  v_role text;
BEGIN
  IF NEW.created_by_user_id IS NULL THEN
    NEW.created_by_user_id := auth.uid();
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

  IF COALESCE(to_jsonb(NEW)->>'issue_status', to_jsonb(NEW)->>'status') = 'issued' THEN
    NEW.issued_author_name_snapshot := COALESCE(NEW.issued_author_name_snapshot, NEW.author_name_snapshot);
    NEW.issued_author_role_snapshot := COALESCE(NEW.issued_author_role_snapshot, NEW.author_role_snapshot);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_set_document_author_snapshot ON public.documents;
CREATE TRIGGER trg_set_document_author_snapshot
BEFORE INSERT OR UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.set_document_author_snapshot();

-- =========================
-- Phases E/G: helper functions + initial policy alignment
-- =========================
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.organisation_id
  FROM public.organisation_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_org_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.role
  FROM public.organisation_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;
$$;

-- Documents policies: prefer membership model with legacy fallback
DROP POLICY IF EXISTS "Users can view org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can create org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete org documents" ON public.documents;

CREATE POLICY "Users can view org documents"
ON public.documents FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
  OR organisation_id IN (
    SELECT organisation_id FROM public.user_profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can create org documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  (
    EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.organisation_id = documents.organisation_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND om.role IN ('owner', 'admin', 'consultant')
    )
  )
  OR (
    organisation_id IN (
      SELECT organisation_id FROM public.user_profiles WHERE id = auth.uid()
    )
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
  OR organisation_id IN (
    SELECT organisation_id FROM public.user_profiles WHERE id = auth.uid()
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
  OR organisation_id IN (
    SELECT organisation_id FROM public.user_profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can delete org draft documents"
ON public.documents FOR DELETE TO authenticated
USING (
  COALESCE(issue_status, 'draft') = 'draft'
  AND (
    EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.organisation_id = documents.organisation_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND om.role IN ('owner', 'admin')
    )
    OR organisation_id IN (
      SELECT organisation_id FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
    )
  )
);
