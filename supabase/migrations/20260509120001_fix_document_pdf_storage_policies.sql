/*
  # Fix issued document PDF storage access

  The issued-document PDF flow stores locked PDFs in the private `document-pdfs`
  bucket under `{organisation_id}/{document_id}/{filename}.pdf`.

  Older policies checked `user_profiles.organisation_id` / `user_profiles.can_edit`,
  which can reject valid organisation members after the membership-first auth
  migration. This caused 403 storage/resource responses after a document had
  already transitioned to issued.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('document-pdfs', 'document-pdfs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Users can view organisation document PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can upload document PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can delete document PDFs" ON storage.objects;

CREATE POLICY "Members can view organisation document PDFs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'document-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id::text = (storage.foldername(storage.objects.name))[1]
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

CREATE POLICY "Editors can upload organisation document PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'document-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id::text = (storage.foldername(storage.objects.name))[1]
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant', 'surveyor')
  )
);

CREATE POLICY "Editors can update organisation document PDFs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'document-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id::text = (storage.foldername(storage.objects.name))[1]
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant', 'surveyor')
  )
)
WITH CHECK (
  bucket_id = 'document-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id::text = (storage.foldername(storage.objects.name))[1]
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'consultant', 'surveyor')
  )
);

CREATE POLICY "Org admins can delete organisation document PDFs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'document-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id::text = (storage.foldername(storage.objects.name))[1]
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  )
);
