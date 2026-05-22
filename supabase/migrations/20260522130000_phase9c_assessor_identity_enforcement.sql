/*
  # Phase 9C — Assessor Identity Enforcement

  Replaces the legacy trg_set_document_author_snapshot trigger (Phase 1/Phase 2)
  with a comprehensive trigger that:

    1. On INSERT: derives ALL identity fields from auth context, overwriting any
       client-supplied values for assessor_name, display_author_name,
       author_name_snapshot, created_by_user_id, and author_profile_id.
    2. On UPDATE: locks those fields to their INSERT-time values.
    3. On first transition to issue_status = 'issued': captures all six issued
       snapshot fields (the Phase 2 trigger checked NEW.status which does not
       exist — those snapshots were never set). This migration fixes that.

  Resolution order for display name (mirrors src/utils/pdfIdentity.ts):
    1. user_profiles.name
    2. auth.users.raw_user_meta_data->>'full_name'
    3. first_name + last_name from raw_user_meta_data
    4. raw_user_meta_data->>'name'
    5. SPLIT_PART(email, '@', 1)  — email prefix only, never raw full email

  Also adds trg_enforce_module_instance_assessor_name on module_instances, which
  overwrites data->'assessor'->'name' (if present) using the same resolution chain
  applied to the document's creator. Rows without an 'assessor' object in data
  are skipped immediately and not modified.

  Service-role bypass: both triggers skip when auth.uid() IS NULL.

  Columns used (all exist after Phase 1 + Phase 2a migrations):
    documents: created_by_user_id, author_profile_id, assessor_name, assessor_role,
               author_name_snapshot, author_role_snapshot,
               issued_author_name_snapshot, issued_author_role_snapshot,
               display_author_name, display_author_role, display_author_organisation,
               issued_display_author_name, issued_display_author_role,
               issued_display_author_organisation, issue_status
    module_instances: document_id, data (jsonb)
    user_profiles: name (only — no full_name / first_name / last_name columns)
    auth.users: raw_user_meta_data (jsonb), email
*/

-- ============================================================
-- Helper: resolve display name for a given user id
-- Resolution order mirrors pdfIdentity.ts::resolveDisplayName
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_display_name_for_user(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_name text;
  v_meta         jsonb;
  v_email        text;
  v_first        text;
  v_last         text;
  v_composite    text;
BEGIN
  -- 1. user_profiles.name (the only name column in this schema)
  SELECT NULLIF(TRIM(up.name), '')
    INTO v_profile_name
    FROM public.user_profiles up
   WHERE up.id = p_user_id;

  IF v_profile_name IS NOT NULL THEN
    RETURN v_profile_name;
  END IF;

  -- Load auth row once for raw_user_meta_data + email
  SELECT au.raw_user_meta_data, au.email
    INTO v_meta, v_email
    FROM auth.users au
   WHERE au.id = p_user_id;

  -- 2. raw_user_meta_data->>'full_name'  (OAuth / signup flows)
  IF v_meta IS NOT NULL AND NULLIF(TRIM(v_meta->>'full_name'), '') IS NOT NULL THEN
    RETURN TRIM(v_meta->>'full_name');
  END IF;

  -- 3. first_name + last_name from raw_user_meta_data
  v_first := NULLIF(TRIM(COALESCE(v_meta->>'first_name', '')), '');
  v_last  := NULLIF(TRIM(COALESCE(v_meta->>'last_name',  '')), '');
  IF v_first IS NOT NULL OR v_last IS NOT NULL THEN
    v_composite := TRIM(COALESCE(v_first, '') || ' ' || COALESCE(v_last, ''));
    IF NULLIF(v_composite, '') IS NOT NULL THEN
      RETURN v_composite;
    END IF;
  END IF;

  -- 4. raw_user_meta_data->>'name'
  IF v_meta IS NOT NULL AND NULLIF(TRIM(v_meta->>'name'), '') IS NOT NULL THEN
    RETURN TRIM(v_meta->>'name');
  END IF;

  -- 5. Email prefix only — never the full raw email address
  IF v_email IS NOT NULL AND TRIM(v_email) <> '' THEN
    RETURN SPLIT_PART(TRIM(v_email), '@', 1);
  END IF;

  RETURN NULL;
END;
$$;


-- ============================================================
-- 1. documents — enforce author identity on INSERT, lock on UPDATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_document_author_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_name text;
  v_role          text;
BEGIN
  -- Service-role / internal bypass (service key has no auth.uid())
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_resolved_name := public.resolve_display_name_for_user(auth.uid());

    SELECT NULLIF(TRIM(up.role), '')
      INTO v_role
      FROM public.user_profiles up
     WHERE up.id = auth.uid();

    -- Identity enforcement — overwrite any client-supplied values
    NEW.created_by_user_id   := auth.uid();
    NEW.author_profile_id    := auth.uid();
    NEW.assessor_name        := COALESCE(v_resolved_name, 'Authenticated User');
    NEW.author_name_snapshot := COALESCE(v_resolved_name, 'Authenticated User');
    NEW.display_author_name  := COALESCE(v_resolved_name, 'Authenticated User');

    -- Role: prefer any explicitly supplied value, then profile role, then assessor_role
    NEW.author_role_snapshot := COALESCE(NEW.author_role_snapshot, v_role, NEW.assessor_role);
    NEW.display_author_role  := COALESCE(NEW.display_author_role,  v_role, NEW.assessor_role);
    -- Legacy field sync: keep assessor_role consistent
    NEW.assessor_role        := COALESCE(NEW.assessor_role, NEW.display_author_role);

  ELSIF TG_OP = 'UPDATE' THEN

    -- ── Lock core identity fields to INSERT-time values ──────────────────────
    NEW.created_by_user_id   := OLD.created_by_user_id;
    NEW.author_profile_id    := OLD.author_profile_id;
    NEW.assessor_name        := OLD.assessor_name;
    NEW.author_name_snapshot := OLD.author_name_snapshot;
    NEW.display_author_name  := OLD.display_author_name;

    -- Lock role snapshot once set
    IF OLD.author_role_snapshot IS NOT NULL THEN
      NEW.author_role_snapshot := OLD.author_role_snapshot;
    END IF;

    -- ── Lock issued snapshot fields once captured ─────────────────────────────
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

    -- ── Capture issued snapshots on first transition to 'issued' ─────────────
    -- Fix: Phase 2 triggers checked NEW.status (column does not exist) so these
    -- snapshots were never captured. We use issue_status (the correct column).
    IF NEW.issue_status = 'issued' AND OLD.issue_status IS DISTINCT FROM 'issued' THEN
      IF NEW.issued_author_name_snapshot IS NULL THEN
        NEW.issued_author_name_snapshot := OLD.author_name_snapshot;
      END IF;

      IF NEW.issued_author_role_snapshot IS NULL THEN
        NEW.issued_author_role_snapshot := OLD.author_role_snapshot;
      END IF;

      IF NEW.issued_display_author_name IS NULL THEN
        NEW.issued_display_author_name := OLD.display_author_name;
      END IF;

      IF NEW.issued_display_author_role IS NULL THEN
        NEW.issued_display_author_role := OLD.display_author_role;
      END IF;

      IF NEW.issued_display_author_organisation IS NULL THEN
        NEW.issued_display_author_organisation := OLD.display_author_organisation;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Replace the legacy Phase 1 / Phase 2 trigger
DROP TRIGGER IF EXISTS trg_set_document_author_snapshot     ON public.documents;
DROP TRIGGER IF EXISTS trg_enforce_document_author_identity ON public.documents;

CREATE TRIGGER trg_enforce_document_author_identity
BEFORE INSERT OR UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_document_author_identity();


-- ============================================================
-- 2. module_instances — overwrite data->'assessor'->'name'
--    Only fires when data contains an 'assessor' JSON object.
--    Role, company, and all other fields are untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_module_instance_assessor_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id    uuid;
  v_resolved_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip rows whose data has no 'assessor' object (most modules)
  IF jsonb_typeof(NEW.data -> 'assessor') IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_creator_id := auth.uid();
  ELSE
    -- Updates: use the document's original creator, not the updater
    SELECT d.created_by_user_id
      INTO v_creator_id
      FROM public.documents d
     WHERE d.id = NEW.document_id;

    v_creator_id := COALESCE(v_creator_id, auth.uid());
  END IF;

  v_resolved_name := public.resolve_display_name_for_user(v_creator_id);

  IF v_resolved_name IS NOT NULL THEN
    NEW.data := jsonb_set(NEW.data, '{assessor,name}', to_jsonb(v_resolved_name), true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_module_instance_assessor_name ON public.module_instances;

CREATE TRIGGER trg_enforce_module_instance_assessor_name
BEFORE INSERT OR UPDATE ON public.module_instances
FOR EACH ROW EXECUTE FUNCTION public.enforce_module_instance_assessor_name();


-- ============================================================
-- 3. Backfill: populate display_author_name where still NULL
--    (does not touch rows that already have a value)
-- ============================================================

UPDATE public.documents
   SET display_author_name = COALESCE(author_name_snapshot, assessor_name)
 WHERE display_author_name IS NULL
   AND (author_name_snapshot IS NOT NULL OR assessor_name IS NOT NULL);
