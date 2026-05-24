/*
  # Add optional consultancy-grade recommendation detail to actions

  Stores version-tolerant structured recommendation narrative without changing the
  existing action lifecycle, reference numbering, ownership, target date, or carry-forward model.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actions'
      AND column_name = 'recommendation_detail'
  ) THEN
    ALTER TABLE public.actions ADD COLUMN recommendation_detail JSONB NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.actions.recommendation_detail IS
  'Optional structured recommendation detail JSONB. Expected schema_version=1 with observation, consequence, recommendation, rationale, standards_reference, timeframe_guidance, existing_controls, evidence_notes, linked_module, assessor_commentary, management_response and status_notes. Existing recommended_action remains authoritative for legacy compatibility.';
