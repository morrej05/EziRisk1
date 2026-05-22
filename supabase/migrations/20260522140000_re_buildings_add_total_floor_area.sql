/*
  # RE buildings: add total_floor_area_m2 (GIA) column

  The geometry model previously captured only roof_area_m2 and mezzanine_area_m2,
  which were incorrectly used as a proxy for total floor area / GIA in scoring and
  PDF output. Multi-storey, mixed-footprint, and mezzanine buildings make that
  calculation inaccurate.

  This migration:
  - Adds total_floor_area_m2 (nullable numeric) to re_buildings
  - Does NOT infer/backfill the value (existing records will have NULL until
    an assessor explicitly enters the GIA)
*/

ALTER TABLE public.re_buildings
  ADD COLUMN IF NOT EXISTS total_floor_area_m2 numeric;

COMMENT ON COLUMN public.re_buildings.total_floor_area_m2
  IS 'Total floor area / Gross Internal Area (GIA) in m². Entered directly by the assessor; do not infer from roof_area_m2 × storeys.';
