/*
  # Preserve document identity snapshots across version chains

  Purpose:
  - Document version rows use `documents.base_document_id` as the version chain.
  - Client/site identity is denormalised into `documents.meta` for dashboard/PDF snapshots,
    with legacy fallbacks in `responsible_person`, `scope_description`, module payloads, and
    `site_id`/`building_id` linkage columns.
  - Some cloned versions were created without carrying `meta`, `site_id`, and `building_id`,
    so issued rows could display "Client not set" even when the document title/site still existed.

  This migration backfills missing snapshots where possible from:
  1. the closest earlier version in the same base document chain;
  2. A1/RE-01 module instance data on the same document;
  3. legacy document-level fallback fields.
*/

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Carry missing document-level identity/linkage from the closest earlier version in the chain.
WITH previous_versions AS (
  SELECT DISTINCT ON (d.id)
    d.id AS document_id,
    p.meta AS previous_meta,
    p.site_id AS previous_site_id,
    p.building_id AS previous_building_id,
    p.responsible_person AS previous_responsible_person,
    p.scope_description AS previous_scope_description
  FROM documents d
  JOIN documents p
    ON p.base_document_id = d.base_document_id
   AND p.version_number < d.version_number
  WHERE d.base_document_id IS NOT NULL
    AND (
      d.meta IS NULL
      OR d.meta = '{}'::jsonb
      OR NULLIF(d.meta #>> '{client,name}', '') IS NULL
      OR NULLIF(d.meta #>> '{site,name}', '') IS NULL
      OR d.site_id IS NULL
      OR d.building_id IS NULL
      OR d.responsible_person IS NULL
      OR d.scope_description IS NULL
    )
  ORDER BY d.id, p.version_number DESC
)
UPDATE documents d
SET
  meta = COALESCE(d.meta, '{}'::jsonb)
    || CASE
      WHEN NULLIF(COALESCE(d.meta #>> '{client,name}', ''), '') IS NULL
       AND NULLIF(COALESCE(previous_versions.previous_meta #>> '{client,name}', ''), '') IS NOT NULL
      THEN jsonb_build_object('client', previous_versions.previous_meta->'client')
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN NULLIF(COALESCE(d.meta #>> '{site,name}', ''), '') IS NULL
       AND NULLIF(COALESCE(previous_versions.previous_meta #>> '{site,name}', ''), '') IS NOT NULL
      THEN jsonb_build_object('site', previous_versions.previous_meta->'site')
      ELSE '{}'::jsonb
    END,
  site_id = COALESCE(d.site_id, previous_versions.previous_site_id),
  building_id = COALESCE(d.building_id, previous_versions.previous_building_id),
  responsible_person = COALESCE(d.responsible_person, previous_versions.previous_responsible_person),
  scope_description = COALESCE(d.scope_description, previous_versions.previous_scope_description)
FROM previous_versions
WHERE d.id = previous_versions.document_id;

-- Backfill missing meta client/site names from A1/RE-01 module payloads where available.
WITH module_identity AS (
  SELECT DISTINCT ON (mi.document_id)
    mi.document_id,
    NULLIF(COALESCE(
      mi.data #>> '{client,name}',
      mi.data #>> '{client_site,client}',
      mi.data ->> 'clientName',
      mi.data ->> 'client_name'
    ), '') AS client_name,
    NULLIF(COALESCE(
      mi.data #>> '{site,name}',
      mi.data #>> '{client_site,site}',
      mi.data ->> 'siteName',
      mi.data ->> 'site_name'
    ), '') AS site_name,
    COALESCE(
      mi.data #> '{site,address}',
      CASE
        WHEN NULLIF(mi.data #>> '{client_site,address}', '') IS NOT NULL
        THEN jsonb_build_object('line1', mi.data #>> '{client_site,address}')
        ELSE NULL
      END
    ) AS site_address,
    mi.site_id,
    mi.building_id
  FROM module_instances mi
  WHERE mi.module_key IN ('A1_DOC_CONTROL', 'RE_01_DOC_CONTROL', 'RISK_ENGINEERING')
  ORDER BY
    mi.document_id,
    CASE mi.module_key
      WHEN 'A1_DOC_CONTROL' THEN 1
      WHEN 'RE_01_DOC_CONTROL' THEN 2
      WHEN 'RISK_ENGINEERING' THEN 3
      ELSE 4
    END
)
UPDATE documents d
SET
  meta = COALESCE(d.meta, '{}'::jsonb)
    || CASE
      WHEN NULLIF(COALESCE(d.meta #>> '{client,name}', ''), '') IS NULL
       AND module_identity.client_name IS NOT NULL
      THEN jsonb_build_object('client', jsonb_build_object('name', module_identity.client_name))
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN NULLIF(COALESCE(d.meta #>> '{site,name}', ''), '') IS NULL
       AND module_identity.site_name IS NOT NULL
      THEN jsonb_build_object(
        'site',
        jsonb_strip_nulls(jsonb_build_object('name', module_identity.site_name, 'address', module_identity.site_address))
      )
      ELSE '{}'::jsonb
    END,
  site_id = COALESCE(d.site_id, module_identity.site_id),
  building_id = COALESCE(d.building_id, module_identity.building_id),
  responsible_person = COALESCE(d.responsible_person, module_identity.client_name),
  scope_description = COALESCE(d.scope_description, module_identity.site_name)
FROM module_identity
WHERE d.id = module_identity.document_id
  AND (
    NULLIF(COALESCE(d.meta #>> '{client,name}', ''), '') IS NULL
    OR NULLIF(COALESCE(d.meta #>> '{site,name}', ''), '') IS NULL
    OR d.site_id IS NULL
    OR d.building_id IS NULL
    OR d.responsible_person IS NULL
    OR d.scope_description IS NULL
  );

-- Last-resort normalisation from legacy flat meta/document fields into nested snapshot keys.
UPDATE documents
SET meta = COALESCE(meta, '{}'::jsonb)
  || CASE
    WHEN NULLIF(COALESCE(meta #>> '{client,name}', ''), '') IS NULL
     AND NULLIF(COALESCE(meta ->> 'clientName', meta ->> 'client_name', responsible_person), '') IS NOT NULL
    THEN jsonb_build_object('client', jsonb_build_object('name', NULLIF(COALESCE(meta ->> 'clientName', meta ->> 'client_name', responsible_person), '')))
    ELSE '{}'::jsonb
  END
  || CASE
    WHEN NULLIF(COALESCE(meta #>> '{site,name}', ''), '') IS NULL
     AND NULLIF(COALESCE(meta ->> 'siteName', meta ->> 'site_name', scope_description, title), '') IS NOT NULL
    THEN jsonb_build_object('site', jsonb_build_object('name', NULLIF(COALESCE(meta ->> 'siteName', meta ->> 'site_name', scope_description, title), '')))
    ELSE '{}'::jsonb
  END
WHERE NULLIF(COALESCE(meta #>> '{client,name}', ''), '') IS NULL
   OR NULLIF(COALESCE(meta #>> '{site,name}', ''), '') IS NULL;

-- Repair chains where more than one row was left as issued: keep the highest issued version issued.
WITH latest_issued AS (
  SELECT DISTINCT ON (base_document_id)
    id,
    base_document_id
  FROM documents
  WHERE issue_status = 'issued'
  ORDER BY base_document_id, version_number DESC, updated_at DESC
)
UPDATE documents d
SET
  issue_status = 'superseded',
  status = 'superseded',
  superseded_by_document_id = latest_issued.id,
  superseded_date = COALESCE(d.superseded_date, now()),
  updated_at = now()
FROM latest_issued
WHERE d.base_document_id = latest_issued.base_document_id
  AND d.issue_status = 'issued'
  AND d.id <> latest_issued.id;
