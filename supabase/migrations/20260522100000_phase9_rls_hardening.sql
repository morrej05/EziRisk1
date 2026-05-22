/*
  # Phase 9 — Membership-First RLS Hardening

  Removes all legacy `user_profiles.organisation_id` OR-fallback clauses from
  three sets of policies:

    1. public.documents — 4 policies
    2. storage.objects (evidence bucket) — 4 policies
    3. storage.objects (org-assets bucket) — 4 policies

  After this migration, tenant isolation flows exclusively through
  organisation_members (status = 'active'). The denormalized
  user_profiles.organisation_id field is no longer used as an authorization
  fallback. Removed or suspended members lose access immediately on the next
  request without waiting for profile data to be updated.

  All restrictive conditions are tightened — no existing permission is widened.
  Platform-admin checks (is_platform_admin) are preserved unchanged in this
  migration; they are addressed in Phase 9 Migration 2 (super_admins elevation).

  Replaces policies originally created in:
    - 20260314120000_auth_hardening_phase1.sql  (documents)
    - 20260120231544_create_evidence_storage_bucket.sql  (evidence)
    - 20260215121936_fix_org_assets_storage_policies.sql  (org-assets)
*/

-- ============================================================
-- 1. public.documents — membership-first, no user_profiles fallback
-- ============================================================

DROP POLICY IF EXISTS "Users can view org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can create org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update org documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete org draft documents" ON public.documents;

-- SELECT: any active member of the document's org
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

-- INSERT: active member with write role
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

-- UPDATE: active member with write role (both USING and WITH CHECK required)
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

-- DELETE: draft documents only; owner/admin only
CREATE POLICY "Users can delete org draft documents"
ON public.documents FOR DELETE TO authenticated
USING (
  COALESCE(issue_status, 'draft') = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = documents.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);


-- ============================================================
-- 2. evidence storage bucket — membership-first
--
--    Path inside bucket: {org_id}/{doc_id}/{date}/{uuid}.ext
--    (storage.foldername(name))[1] extracts the org_id segment.
-- ============================================================

DROP POLICY IF EXISTS "Users can read organisation evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload organisation evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can update organisation evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete organisation evidence" ON storage.objects;

-- SELECT
CREATE POLICY "Users can read organisation evidence"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = auth.uid()
        AND om.organisation_id::text = (storage.foldername(name))[1]
        AND om.status = 'active'
    )
  );

-- INSERT
CREATE POLICY "Users can upload organisation evidence"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = auth.uid()
        AND om.organisation_id::text = (storage.foldername(name))[1]
        AND om.status = 'active'
    )
  );

-- UPDATE (both USING and WITH CHECK required for storage UPDATE)
CREATE POLICY "Users can update organisation evidence"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = auth.uid()
        AND om.organisation_id::text = (storage.foldername(name))[1]
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = auth.uid()
        AND om.organisation_id::text = (storage.foldername(name))[1]
        AND om.status = 'active'
    )
  );

-- DELETE
CREATE POLICY "Users can delete organisation evidence"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.user_id = auth.uid()
        AND om.organisation_id::text = (storage.foldername(name))[1]
        AND om.status = 'active'
    )
  );


-- ============================================================
-- 3. org-assets storage bucket — membership-first
--
--    Path inside bucket: org-logos/{org_id}/{filename}
--    split_part(name, '/', 2) extracts the org_id segment.
--
--    Platform admin access uses the super_admins table (PK = id,
--    which references auth.users.id). No reference to
--    user_profiles.is_platform_admin, user_profiles.role, or
--    user_profiles.organisation_id remains in these policies.
-- ============================================================

DROP POLICY IF EXISTS "Users can read own org assets" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can upload org assets" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can update org assets" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can delete org assets" ON storage.objects;

-- SELECT: active member of the org whose assets are being read, OR platform admin
CREATE POLICY "Users can read own org assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'org-assets'
    AND (
      EXISTS (
        SELECT 1 FROM public.organisation_members om
        WHERE om.user_id = auth.uid()
          AND om.organisation_id::text = split_part(storage.objects.name, '/', 2)
          AND om.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.id = auth.uid()
      )
    )
  );

-- INSERT: owner/admin of the org, OR platform admin
CREATE POLICY "Org admins can upload org assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-assets'
    AND (
      EXISTS (
        SELECT 1 FROM public.organisation_members om
        WHERE om.user_id = auth.uid()
          AND om.organisation_id::text = split_part(storage.objects.name, '/', 2)
          AND om.status = 'active'
          AND om.role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.id = auth.uid()
      )
    )
  );

-- UPDATE: owner/admin of the org, OR platform admin
CREATE POLICY "Org admins can update org assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-assets'
    AND (
      EXISTS (
        SELECT 1 FROM public.organisation_members om
        WHERE om.user_id = auth.uid()
          AND om.organisation_id::text = split_part(storage.objects.name, '/', 2)
          AND om.status = 'active'
          AND om.role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.id = auth.uid()
      )
    )
  );

-- DELETE: owner/admin of the org, OR platform admin
CREATE POLICY "Org admins can delete org assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-assets'
    AND (
      EXISTS (
        SELECT 1 FROM public.organisation_members om
        WHERE om.user_id = auth.uid()
          AND om.organisation_id::text = split_part(storage.objects.name, '/', 2)
          AND om.status = 'active'
          AND om.role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.id = auth.uid()
      )
    )
  );
