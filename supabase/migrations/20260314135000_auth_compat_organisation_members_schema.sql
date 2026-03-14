/*
  # Auth compatibility migration: organisation_members schema drift
  Purpose: bring legacy/live public.organisation_members into the shape expected
  by membership-first auth code without recreating the table.
*/

-- 1) Add missing columns safely (no table recreation)
ALTER TABLE public.organisation_members
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2) Backfill required values for existing rows
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

-- 3) Defaults and constraints needed by current auth code
ALTER TABLE public.organisation_members
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.organisation_members
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND conname = 'organisation_members_status_check'
  ) THEN
    ALTER TABLE public.organisation_members
      ADD CONSTRAINT organisation_members_status_check
      CHECK (status IN ('active', 'invited', 'suspended', 'removed'));
  END IF;
END
$$;

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
      FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- 4) Keep/restore unique behaviour for (organisation_id, user_id), but only if safe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND conname = 'organisation_members_organisation_id_user_id_key'
  ) THEN
    IF EXISTS (
      SELECT organisation_id, user_id
      FROM public.organisation_members
      GROUP BY organisation_id, user_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'Skipped adding UNIQUE (organisation_id, user_id): duplicates exist in live data.';
    ELSE
      ALTER TABLE public.organisation_members
        ADD CONSTRAINT organisation_members_organisation_id_user_id_key
        UNIQUE (organisation_id, user_id);
    END IF;
  END IF;
END
$$;

-- 5) Add primary key on id only when safe and compatible with live state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organisation_members'::regclass
      AND contype = 'p'
  ) THEN
    IF EXISTS (
      SELECT id
      FROM public.organisation_members
      GROUP BY id
      HAVING COUNT(*) > 1
    ) OR EXISTS (
      SELECT 1
      FROM public.organisation_members
      WHERE id IS NULL
    ) THEN
      RAISE WARNING 'Skipped adding PRIMARY KEY (id): null or duplicate id values exist.';
    ELSE
      ALTER TABLE public.organisation_members
        ADD CONSTRAINT organisation_members_pkey PRIMARY KEY (id);
    END IF;
  END IF;
END
$$;
