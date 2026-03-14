/*
  Compatibility migration: bring pre-existing public.organisation_members table
  to the shape required by auth hardening migrations/code without table recreation.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organisation_members
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Backfill newly introduced fields safely for existing rows.
UPDATE public.organisation_members
SET id = gen_random_uuid()
WHERE id IS NULL;

UPDATE public.organisation_members
SET status = 'active'
WHERE status IS NULL;

UPDATE public.organisation_members
SET joined_at = created_at
WHERE joined_at IS NULL;

UPDATE public.organisation_members
SET updated_at = now()
WHERE updated_at IS NULL;

-- Defaults for forward writes.
ALTER TABLE public.organisation_members
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN updated_at SET DEFAULT now();

-- Constraints for forward safety.
ALTER TABLE public.organisation_members
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.organisation_members
  DROP CONSTRAINT IF EXISTS organisation_members_status_check;

ALTER TABLE public.organisation_members
  ADD CONSTRAINT organisation_members_status_check
  CHECK (status IN ('active', 'invited', 'suspended', 'removed'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND conname = 'organisation_members_invited_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.organisation_members
      ADD CONSTRAINT organisation_members_invited_by_user_id_fkey
      FOREIGN KEY (invited_by_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Add PK only when data is compatible (no null/duplicate ids).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND contype = 'p'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.organisation_members WHERE id IS NULL) THEN
    RAISE WARNING 'Skipping PK on public.organisation_members(id): null ids still present.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT id
    FROM public.organisation_members
    GROUP BY id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'Skipping PK on public.organisation_members(id): duplicate ids present.';
    RETURN;
  END IF;

  ALTER TABLE public.organisation_members
    ADD CONSTRAINT organisation_members_pkey PRIMARY KEY (id);
END
$$;

-- Preserve unique behavior on (organisation_id, user_id) when compatible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND conname = 'organisation_members_organisation_id_user_id_key'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organisation_members
    WHERE organisation_id IS NULL OR user_id IS NULL
  ) THEN
    RAISE WARNING 'Skipping unique constraint on (organisation_id, user_id): null keys present.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT organisation_id, user_id
    FROM public.organisation_members
    GROUP BY organisation_id, user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'Skipping unique constraint on (organisation_id, user_id): duplicate memberships present.';
    RETURN;
  END IF;

  ALTER TABLE public.organisation_members
    ADD CONSTRAINT organisation_members_organisation_id_user_id_key
    UNIQUE (organisation_id, user_id);
END
$$;
