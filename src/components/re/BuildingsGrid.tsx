import { useEffect, useMemo, useState } from 'react';
import type { BuildingInput } from '../../lib/re/buildingsModel';
import { createEmptyBuilding } from '../../lib/re/buildingsModel';
import { Save, Trash2, Pencil, CheckCircle2, AlertTriangle, CircleDashed, Info, PlusCircle, Lock } from 'lucide-react';
import {
  listBuildings,
  upsertBuilding,
  deleteBuilding,
  getBuildingExtra,
  upsertBuildingExtra,
} from '../../lib/re/buildingsRepo';
import { computeConstruction } from '../../lib/re/buildingsCompute';
import { supabase } from '../../lib/supabase';
import CanonicalReRecommendationModal from './CanonicalReRecommendationModal';
import { bumpActionsVersion } from '../../lib/actions/actionsInvalidation';

type GridMode = 'all' | 'construction' | 'fire_protection';

type Props = {
  documentId: string;
  mode?: GridMode;
  onAfterSave?: () => Promise<void> | void;
  moduleInstanceId?: string;
  isLocked?: boolean;
};

type WallRow = { material: string; percent: number };

// Material options for dropdowns
const ROOF_MATERIAL_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'heavy_noncombustible_concrete', label: 'Heavy non-combustible / concrete' },
  { value: 'metal_deck_noncomb_insul', label: 'Metal deck + non-combustible insulation' },
  { value: 'metal_deck_comb_insul', label: 'Metal deck + combustible insulation' },
  { value: 'sandwich_phenolic', label: 'Composite sandwich panel — Phenolic' },
  { value: 'sandwich_pir', label: 'Composite sandwich panel — PIR' },
  { value: 'sandwich_pur', label: 'Composite sandwich panel — PUR' },
  { value: 'sandwich_eps', label: 'Composite sandwich panel — EPS / polystyrene' },
  { value: 'built_up_felt', label: 'Built-up bitumen/felt' },
  { value: 'single_ply', label: 'Single-ply membrane' },
  { value: 'fibre_cement', label: 'Fibre cement sheets' },
  { value: 'timber_deck', label: 'Timber deck / combustible' },
];

const MEZZ_MATERIAL_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'reinforced_concrete', label: 'Reinforced concrete' },
  { value: 'precast_concrete', label: 'Precast concrete' },
  { value: 'steel_concrete_deck', label: 'Steel + concrete deck' },
  { value: 'steel_mezzanine_steel_frame', label: 'Steel mezzanine on steel frame' },
  { value: 'steel_timber_deck', label: 'Steel + timber deck' },
  { value: 'timber_joists_deck', label: 'Timber joists / timber deck' },
  { value: 'grp_composite_deck', label: 'Composite / GRP deck' },
];

const WALL_MATERIAL_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'precast_concrete', label: 'Precast concrete' },
  { value: 'metal_cladding_noncomb', label: 'Metal cladding (non-combustible)' },
  { value: 'metal_cladding_comb_core', label: 'Metal cladding (combustible core)' },
  { value: 'composite_panels_comb', label: 'Composite panels (combustible)' },
  { value: 'sandwich_phenolic', label: 'Composite sandwich panel — Phenolic' },
  { value: 'sandwich_pir', label: 'Composite sandwich panel — PIR' },
  { value: 'sandwich_pur', label: 'Composite sandwich panel — PUR' },
  { value: 'sandwich_eps', label: 'Composite sandwich panel — EPS / polystyrene' },
  { value: 'timber_cladding', label: 'Timber cladding' },
  { value: 'curtain_wall_glazing', label: 'Curtain wall / glazing' },
];

function sum(nums: Array<number | null | undefined>) {
  return nums.reduce((acc, n) => acc + (typeof n === 'number' ? n : 0), 0);
}

function sumPercentObject(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, pct]) => typeof pct === 'number' && Number.isFinite(pct));
  if (entries.length === 0) return null;
  return Math.round(entries.reduce((acc, [, pct]) => acc + Number(pct), 0) * 10) / 10;
}

export default function BuildingsGrid({
  documentId,
  mode = 'all',
  onAfterSave,
  moduleInstanceId: moduleInstanceIdProp,
  isLocked = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BuildingInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resolvedModuleInstanceId, setResolvedModuleInstanceId] = useState<string | null>(moduleInstanceIdProp ?? null);
  const [showAddRecModal, setShowAddRecModal] = useState(false);

  // Walls modal state
  const [wallsOpenForId, setWallsOpenForId] = useState<string | null>(null);
  const [wallsDraft, setWallsDraft] = useState<WallRow[]>([
    { material: 'unknown', percent: 100 },
  ]);
  const [wallsError, setWallsError] = useState<string | null>(null);
  const [roofOpenForId, setRoofOpenForId] = useState<string | null>(null);
  const [roofDraft, setRoofDraft] = useState<WallRow[]>([{ material: 'unknown', percent: 100 }]);
  const [roofError, setRoofError] = useState<string | null>(null);

  const [mezzOpenForId, setMezzOpenForId] = useState<string | null>(null);
  const [mezzDraft, setMezzDraft] = useState<WallRow[]>([{ material: 'unknown', percent: 100 }]);
  const [mezzError, setMezzError] = useState<string | null>(null);

  // Completion indicators - store extra data per building
  const [buildingExtras, setBuildingExtras] = useState<Record<string, any>>({});

  // Site notes state
  const [constructionNotes, setConstructionNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [openExplanationForBuildingId, setOpenExplanationForBuildingId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listBuildings(documentId);
      setRows(data);
      // Load extras for completion indicators
      await loadAllExtras(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load buildings');
    } finally {
      setLoading(false);
    }
  }

  async function loadAllExtras(buildings: BuildingInput[]) {
    const extras: Record<string, any> = {};
    for (const b of buildings) {
      if (b.id) {
        try {
          const extra = await getBuildingExtra(b.id);
          if (extra) {
            extras[b.id] = extra;
          }
        } catch (e) {
          console.error(`Failed to load extra for building ${b.id}:`, e);
        }
      }
    }
    setBuildingExtras(extras);
  }

  function getCompletionStatus(buildingId: string, key: 'roof_construction_percent' | 'wall_construction_percent' | 'mezzanine_construction_percent'): 'missing' | 'complete' | 'incomplete' {
    const extra = buildingExtras[buildingId];
    if (!extra || !extra[key]) return 'missing';

    const data = extra[key];
    if (typeof data !== 'object') return 'missing';

    const entries = Object.entries(data);
    if (entries.length === 0) return 'missing';

    const total = entries.reduce((sum, [, percent]) => sum + Number(percent), 0);
    return total === 100 ? 'complete' : 'incomplete';
  }

  async function loadSiteNotes() {
    try {
      const { data, error } = await supabase
        .from('re_site_notes')
        .select('construction_notes')
        .eq('document_id', documentId)
        .maybeSingle();

      if (error) throw error;
      setConstructionNotes(data?.construction_notes || '');
    } catch (e: any) {
      console.error('Failed to load site notes:', e);
    }
  }

  async function saveSiteNotes() {
    if (isLocked) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('re_site_notes')
        .upsert({
          document_id: documentId,
          construction_notes: constructionNotes,
        }, {
          onConflict: 'document_id'
        });

      if (error) throw error;
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save site notes');
    } finally {
      setSavingNotes(false);
    }
  }

  useEffect(() => {
    refresh();
    loadSiteNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Resolve RE_02_CONSTRUCTION module instance ID if not supplied by caller
  useEffect(() => {
    if (moduleInstanceIdProp) {
      setResolvedModuleInstanceId(moduleInstanceIdProp);
      return;
    }
    if (mode === 'fire_protection') return;
    supabase
      .from('module_instances')
      .select('id')
      .eq('document_id', documentId)
      .eq('module_key', 'RE_02_CONSTRUCTION')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.id) setResolvedModuleInstanceId(data.id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, moduleInstanceIdProp, mode]);

  function updateRow(idx: number, patch: Partial<BuildingInput>) {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function addBuilding() {
    if (isLocked) return;
    // Create locally then save to get an id
    const ref = `B${rows.length + 1}`;
    const draft = createEmptyBuilding(documentId, ref);
    setRows(prev => [...prev, draft]);
  }

  async function saveRow(idx: number) {
    if (isLocked) return;
    const b = rows[idx];
    setError(null);

    if (!b.ref?.trim()) {
      setError('Building ref is required (e.g. B1)');
      return;
    }

    setSavingId(b.id ?? `new-${idx}`);
    try {
      const saved = await upsertBuilding(b);
      // replace row with saved (ensures id present)
      setRows(prev => {
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      if (onAfterSave) await onAfterSave();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save building');
    } finally {
      setSavingId(null);
    }
  }

  async function removeRow(idx: number) {
    if (isLocked) return;
    const b = rows[idx];
    setError(null);

    // If not saved yet, just remove from UI
    if (!b.id) {
      setRows(prev => prev.filter((_, i) => i !== idx));
      return;
    }

    if (!confirm(`Delete ${b.ref}?`)) return;

    setSavingId(b.id);
    try {
      await deleteBuilding(b.id);
      setRows(prev => prev.filter((_, i) => i !== idx));
      if (onAfterSave) await onAfterSave();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete building');
    } finally {
      setSavingId(null);
    }
  }

  // ---- Walls % modal helpers (stored in re_building_extra.data) ----
  async function openWalls(buildingId: string) {
    setWallsError(null);
    setWallsOpenForId(buildingId);

    try {
      const extra = await getBuildingExtra(buildingId);
      const existing: WallRow[] =
        extra?.wall_construction_percent && typeof extra.wall_construction_percent === 'object'
          ? Object.entries(extra.wall_construction_percent).map(([material, percent]) => ({
              material,
              percent: Number(percent),
            }))
          : [{ material: 'unknown', percent: 100 }];

      setWallsDraft(existing);
    } catch (e: any) {
      setWallsError(e?.message ?? 'Failed to load wall %');
      setWallsDraft([{ material: 'unknown', percent: 100 }]);
    }
  }

  function wallsTotal() {
    return wallsDraft.reduce((acc, r) => acc + (Number.isFinite(r.percent) ? r.percent : 0), 0);
  }

  async function saveWalls() {
    if (isLocked || !wallsOpenForId) return;

    setWallsError(null);

    const total = wallsTotal();
    if (total !== 100) {
      setWallsError(`Wall % must total 100. Current total: ${total}`);
      return;
    }

    // Must already have building saved (has id)
    const buildingId = wallsOpenForId;

    try {
      const extra = await getBuildingExtra(buildingId);
      const nextExtra = {
        ...(extra ?? {}),
        wall_construction_percent: wallsDraft.reduce<Record<string, number>>((acc, r) => {
          const key = (r.material || '').trim();
          if (key) acc[key] = Number(r.percent);
          return acc;
        }, {}),
      };

      await upsertBuildingExtra(buildingId, nextExtra);
      // Update extras for completion indicator
      setBuildingExtras(prev => ({ ...prev, [buildingId]: nextExtra }));
      setWallsOpenForId(null);
    } catch (e: any) {
      setWallsError(e?.message ?? 'Failed to save wall %');
    }
  }

  function rowsTotal(r: WallRow[]) {
  return r.reduce((acc, x) => acc + (Number.isFinite(x.percent) ? x.percent : 0), 0);
}

async function openRoof(buildingId: string) {
  setRoofError(null);
  setRoofOpenForId(buildingId);
  const extra = await getBuildingExtra(buildingId);
  const existing: WallRow[] =
    extra?.roof_construction_percent && typeof extra.roof_construction_percent === 'object'
      ? Object.entries(extra.roof_construction_percent).map(([material, percent]) => ({
          material,
          percent: Number(percent),
        }))
      : [{ material: 'unknown', percent: 100 }];
  setRoofDraft(existing);
}

async function saveRoof() {
  if (isLocked || !roofOpenForId) return;
  const total = rowsTotal(roofDraft);
  if (total !== 100) {
    setRoofError(`Roof % must total 100. Current total: ${total}`);
    return;
  }
  const buildingId = roofOpenForId;
  const extra = await getBuildingExtra(buildingId);
  const nextExtra = {
    ...(extra ?? {}),
    roof_construction_percent: roofDraft.reduce<Record<string, number>>((acc, r) => {
      const key = (r.material || '').trim();
      if (key) acc[key] = Number(r.percent);
      return acc;
    }, {}),
  };
  await upsertBuildingExtra(buildingId, nextExtra);
  // Update extras for completion indicator
  setBuildingExtras(prev => ({ ...prev, [buildingId]: nextExtra }));
  setRoofOpenForId(null);
}

async function openMezz(buildingId: string) {
  setMezzError(null);
  setMezzOpenForId(buildingId);
  const extra = await getBuildingExtra(buildingId);
  const existing: WallRow[] =
    extra?.mezzanine_construction_percent && typeof extra.mezzanine_construction_percent === 'object'
      ? Object.entries(extra.mezzanine_construction_percent).map(([material, percent]) => ({
          material,
          percent: Number(percent),
        }))
      : [{ material: 'unknown', percent: 100 }];
  setMezzDraft(existing);
}

async function saveMezz() {
  if (isLocked || !mezzOpenForId) return;
  const total = rowsTotal(mezzDraft);
  if (total !== 100) {
    setMezzError(`Mezzanine/floors % must total 100. Current total: ${total}`);
    return;
  }
  const buildingId = mezzOpenForId;
  const extra = await getBuildingExtra(buildingId);
  const nextExtra = {
    ...(extra ?? {}),
    mezzanine_construction_percent: mezzDraft.reduce<Record<string, number>>((acc, r) => {
      const key = (r.material || '').trim();
      if (key) acc[key] = Number(r.percent);
      return acc;
    }, {}),
  };
  await upsertBuildingExtra(buildingId, nextExtra);
  // Update extras for completion indicator
  setBuildingExtras(prev => ({ ...prev, [buildingId]: nextExtra }));
  setMezzOpenForId(null);
}

  const totals = useMemo(() => {
    return {
      roof: sum(rows.map(r => r.roof_area_m2)),
      gia: sum(rows.map(r => r.total_floor_area_m2)),
      mezz: sum(rows.map(r => r.mezzanine_area_m2)),
    };
  }, [rows]);

  // Compute site-wide combustible percentage and RE-02 score
  const siteMetrics = useMemo(() => {
    const buildingsWithData = rows.filter(b => b.id && buildingExtras[b.id!]).map(b => {
      const extra = buildingExtras[b.id!];
      const computed = computeConstruction(b, extra);
      // Prefer explicit GIA; fall back to roof + mezz for legacy records; minimum weight 1
      let area = b.total_floor_area_m2 ?? ((b.roof_area_m2 ?? 0) + (b.mezzanine_area_m2 ?? 0));
      if (area <= 0) area = 1;
      return {
        combustiblePercent: computed.combustiblePercent,
        score: computed.score,
        area
      };
    });

    if (buildingsWithData.length === 0) {
      return { combustiblePercent: NaN, score: NaN };
    }

    const totalWeight = buildingsWithData.reduce((sum, { area }) => sum + area, 0);

    // Combustible percent (only for buildings with known data)
    const buildingsWithCombData = buildingsWithData.filter(({ combustiblePercent }) => !isNaN(combustiblePercent));
    let combustiblePercent = NaN;
    if (buildingsWithCombData.length > 0) {
      const combWeight = buildingsWithCombData.reduce((sum, { area }) => sum + area, 0);
      const combWeightedSum = buildingsWithCombData.reduce((sum, { combustiblePercent, area }) => sum + combustiblePercent * area, 0);
      combustiblePercent = Math.round(combWeightedSum / combWeight);
    }

    // RE-02 score (weighted by area)
    const scoreWeightedSum = buildingsWithData.reduce((sum, { score, area }) => sum + score * area, 0);
    const siteScore = scoreWeightedSum / totalWeight;

    return {
      combustiblePercent,
      score: Math.round(siteScore * 10) / 10 // 1 decimal place
    };
  }, [rows, buildingExtras]);

  const siteWeightTotal = useMemo(() => {
    const weightedBuildings = rows
      .filter((b) => b.id && buildingExtras[b.id])
      .map((b) => {
        // Prefer GIA; fall back to roof + mezz for legacy records; minimum weight 1
        let area = b.total_floor_area_m2 ?? ((b.roof_area_m2 ?? 0) + (b.mezzanine_area_m2 ?? 0));
        if (area <= 0) area = 1;
        return area;
      });
    return weightedBuildings.reduce((sum, area) => sum + area, 0);
  }, [rows, buildingExtras]);

  useEffect(() => {
    if (mode === 'fire_protection') return;

    const timeoutId = setTimeout(async () => {
      try {
        const { data: moduleInstance, error: moduleError } = await supabase
          .from('module_instances')
          .select('id, data')
          .eq('document_id', documentId)
          .eq('module_key', 'RE_02_CONSTRUCTION')
          .maybeSingle();

        if (moduleError) throw moduleError;
        if (!moduleInstance) return;

        const normalizedBuildings = rows.map((row) => {
          const extra = row.id ? buildingExtras[row.id] : null;
          const constructionComputed = computeConstruction(row, extra);
          const roofTotalPercent = sumPercentObject(extra?.roof_construction_percent);
          const wallsTotalPercent = sumPercentObject(extra?.wall_construction_percent);
          const mezzTotalPercent = sumPercentObject(extra?.mezzanine_construction_percent);
          return {
            id: row.id,
            ref: row.ref,
            building_name: row.ref,
            include_in_scoring: true,
            frame_type: row.frame_type,
            roof_area_m2: row.roof_area_m2,
            /** Explicit GIA — do not infer from roof × storeys */
            total_floor_area_m2: row.total_floor_area_m2 ?? null,
            mezzanine_area_m2: row.mezzanine_area_m2 ?? 0,
            storeys: row.storeys,
            basements: row.basements,
            geometry: {
              // Keep 'floors' for backward-compat with PDF lookups that use geometry.floors
              floors: row.storeys,
              storeys: row.storeys,
              storeys_above_ground: row.storeys,
              basements: row.basements,
              height_m: row.height_m,
            },
            cladding_present: row.cladding_present,
            cladding_combustible: row.cladding_combustible,
            cladding_system: row.cladding_system,
            combustible_cladding: {
              present: Boolean(row.cladding_present && row.cladding_combustible === true),
              details: row.cladding_system || '',
            },
            compartmentation_minutes: row.compartmentation_minutes,
            has_extra_construction_split: Boolean(row.id && buildingExtras[row.id]),
            roof: {
              total_percent: roofTotalPercent,
            },
            walls: {
              total_percent: wallsTotalPercent,
            },
            upper_floors_mezzanine: {
              total_percent: mezzTotalPercent,
              area_sqm: row.mezzanine_area_m2 ?? 0,
            },
            calculated: {
              construction_score: constructionComputed.score,
              construction_rating: constructionComputed.score,
              combustible_percent: Number.isFinite(constructionComputed.combustiblePercent) ? constructionComputed.combustiblePercent : null,
              combustibility_percent: Number.isFinite(constructionComputed.combustiblePercent) ? constructionComputed.combustiblePercent : null,
              roof_combustible_percent: Number.isFinite(constructionComputed.roofCombustiblePercent) ? constructionComputed.roofCombustiblePercent : null,
              wall_combustible_percent: Number.isFinite(constructionComputed.wallCombustiblePercent) ? constructionComputed.wallCombustiblePercent : null,
              mezz_combustible_percent: Number.isFinite(constructionComputed.mezzCombustiblePercent) ? constructionComputed.mezzCombustiblePercent : null,
            },
          };
        });

        const updatedData = {
          ...(moduleInstance.data || {}),
          construction: {
            ...((moduleInstance.data || {}).construction || {}),
            buildings: normalizedBuildings,
            site_notes: constructionNotes,
            completion: {
              building_count: normalizedBuildings.length,
              included_building_count: normalizedBuildings.filter((building) => building.include_in_scoring !== false).length,
              site_score: Number.isFinite(siteMetrics.score) ? siteMetrics.score : null,
              site_score_computable: Number.isFinite(siteMetrics.score),
            },
            site_combustible_percent: Number.isFinite(siteMetrics.combustiblePercent) ? siteMetrics.combustiblePercent : null,
          },
        };

        const { error: updateError } = await supabase
          .from('module_instances')
          .update({ data: updatedData })
          .eq('id', moduleInstance.id);
        if (updateError) throw updateError;
      } catch (e) {
        console.error('[RE02 completion snapshot] Failed to persist RE_02 module data:', e);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [documentId, mode, rows, buildingExtras, constructionNotes, siteMetrics.score]);

  // Persist site score to RISK_ENGINEERING module (debounced)
  useEffect(() => {
    if (mode === 'fire_protection' || isNaN(siteMetrics.score)) {
      return; // Only persist in construction/all modes and when score is valid
    }

    const timeoutId = setTimeout(async () => {
      try {
        // Find RISK_ENGINEERING module instance
        const { data: moduleInstance, error } = await supabase
          .from('module_instances')
          .select('id, data')
          .eq('document_id', documentId)
          .eq('module_key', 'RISK_ENGINEERING')
          .maybeSingle();

        if (error) throw error;
        if (!moduleInstance) return; // Module not yet created

        const currentData = moduleInstance.data || {};
        const sectionGrades = currentData.sectionGrades || {};
        const sectionMeta = currentData.sectionMeta || {};

        const constructionRating = Math.max(1, Math.min(5, Math.round(siteMetrics.score)));
        const newConstructionMeta = {
          site_score: Math.round(siteMetrics.score * 10) / 10,
          site_combustible_percent: isNaN(siteMetrics.combustiblePercent) ? null : siteMetrics.combustiblePercent,
        };

        console.log('[RE02->persist] ratingInt', constructionRating, 'siteScore', siteMetrics.score);
        console.log('[RE02->persist] newConstructionMeta', newConstructionMeta);

        // Only update if changed
        const ratingChanged = sectionGrades.construction !== constructionRating;
        const metaChanged = JSON.stringify(sectionMeta.construction) !== JSON.stringify(newConstructionMeta);

        if (ratingChanged || metaChanged) {
          const updatedData = {
            ...currentData,
            sectionGrades: {
              ...sectionGrades,
              construction: constructionRating,
            },
            sectionMeta: {
              ...sectionMeta,
              construction: newConstructionMeta,
            },
          };

          const { error: updateError } = await supabase
            .from('module_instances')
            .update({ data: updatedData })
            .eq('id', moduleInstance.id);

          if (updateError) throw updateError;

          console.log('[RE02->persist] ✓ Updated RISK_ENGINEERING module with rating:', constructionRating);

          // Also update documents.section_grades.construction (for OverallGradeWidget)
          if (ratingChanged) {
            const { data: doc, error: docFetchError } = await supabase
              .from('documents')
              .select('section_grades')
              .eq('id', documentId)
              .maybeSingle();

            if (!docFetchError && doc) {
              const updatedSectionGrades = {
                ...(doc.section_grades || {}),
                construction: constructionRating,
              };

              const { error: docUpdateError } = await supabase
                .from('documents')
                .update({ section_grades: updatedSectionGrades })
                .eq('id', documentId);

              if (docUpdateError) {
                console.error('Failed to update documents.section_grades:', docUpdateError);
              } else {
                console.log('[RE02->persist] ✓ Updated documents.section_grades.construction:', constructionRating);
              }
            }
          }
        }
      } catch (e: any) {
        console.error('Failed to update RISK_ENGINEERING module with site score:', e);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [documentId, mode, siteMetrics.score, siteMetrics.combustiblePercent]);

  // Helper component for completion status with icons
  const CompletionBadge = ({ status }: { status: 'missing' | 'complete' | 'incomplete' }) => {
    if (status === 'missing') {
      return (
        <CircleDashed className="w-4 h-4 text-slate-400" title="Missing" />
      );
    }
    if (status === 'complete') {
      return (
        <CheckCircle2 className="w-4 h-4 text-green-600" title="Complete" />
      );
    }
    return (
      <AlertTriangle className="w-4 h-4 text-amber-600" title="Incomplete" />
    );
  };

  if (loading) return <div className="p-6 text-slate-500 text-sm">Loading buildings…</div>;

  return (
    <div className="p-4 space-y-4">
      {/* Locked banner */}
      {isLocked && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Lock className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-900">
            Issued document — construction data is read-only. No changes can be saved.
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 border border-red-200 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-slate-900">Buildings ({rows.length})</h3>
        <div className="flex items-center gap-2">
          {!isLocked && mode !== 'fire_protection' && resolvedModuleInstanceId && (
            <button
              className="flex items-center gap-2 px-4 py-2 border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-lg text-sm font-medium transition-colors"
              onClick={() => setShowAddRecModal(true)}
            >
              <PlusCircle className="w-4 h-4" />
              Add construction recommendation
            </button>
          )}
          {!isLocked && mode !== 'fire_protection' && (
            <button
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-sm font-medium transition-colors"
              onClick={addBuilding}
            >
              + Add Building
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="text-center py-10 text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          No buildings added yet. Click &ldquo;Add Building&rdquo; to start.
        </div>
      )}

      {/* Building cards */}
      <div className="space-y-4">
      {rows.map((b, idx) => {
          const extra = b.id ? buildingExtras[b.id] : null;
          const computed = b.id ? computeConstruction(b, extra) : null;
          const isSaving = savingId === (b.id ?? `new-${idx}`);
          const roofTotalPct = b.id ? sumPercentObject(buildingExtras[b.id]?.roof_construction_percent) : null;
          const wallTotalPct = b.id ? sumPercentObject(buildingExtras[b.id]?.wall_construction_percent) : null;
          const mezzTotalPct = b.id ? sumPercentObject(buildingExtras[b.id]?.mezzanine_construction_percent) : null;

          return (
            <div key={b.id ?? `card-${idx}`} className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">

              {/* Card header — identity + actions */}
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                <div className="flex-1">
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold placeholder:font-normal focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    value={b.ref ?? ''}
                    onChange={e => updateRow(idx, { ref: e.target.value })}
                    placeholder="Building name / ref (e.g. Warehouse A, B1)"
                  />
                </div>
                {mode !== 'fire_protection' && !isLocked && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[40px]"
                      onClick={() => saveRow(idx)}
                      disabled={isSaving}
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white text-slate-700 rounded-lg text-sm hover:bg-red-50 hover:border-red-300 hover:text-red-700 disabled:opacity-50 transition-colors min-h-[40px]"
                      onClick={() => removeRow(idx)}
                      disabled={isSaving}
                      title="Delete building"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Card body */}
              <div className="p-4 space-y-6">

                {/* Geometry */}
                {mode !== 'fire_protection' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Geometry</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Roof area (m²)</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.roof_area_m2 ?? ''}
                          placeholder="m²"
                          onChange={e => updateRow(idx, { roof_area_m2: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Total floor area / GIA (m²)
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.total_floor_area_m2 ?? ''}
                          placeholder="m²"
                          title="Gross Internal Area — enter directly; do not infer from roof area × storeys"
                          onChange={e => updateRow(idx, { total_floor_area_m2: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Mezzanine / upper floor area (m²)</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.mezzanine_area_m2 ?? ''}
                          placeholder="m²"
                          title="Mezzanine or upper floor area — used for combustible material scoring"
                          onChange={e => updateRow(idx, { mezzanine_area_m2: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Storeys above ground</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.storeys ?? ''}
                          placeholder="e.g. 1"
                          onChange={e => updateRow(idx, { storeys: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Basement levels</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.basements ?? ''}
                          placeholder="0"
                          onChange={e => updateRow(idx, { basements: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Height (m)</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.height_m ?? ''}
                          placeholder="m"
                          onChange={e => updateRow(idx, { height_m: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Material breakdowns */}
                {mode !== 'fire_protection' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Material Breakdowns</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Roof */}
                      <div className="border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">Roof</span>
                          <CompletionBadge status={b.id ? getCompletionStatus(b.id, 'roof_construction_percent') : 'missing'} />
                        </div>
                        {roofTotalPct !== null && (
                          <p className="text-xs text-slate-500">
                            Total recorded:{' '}
                            <span className={roofTotalPct === 100 ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
                              {roofTotalPct}%
                            </span>
                          </p>
                        )}
                        {!isLocked && (
                          <>
                            <button
                              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-sm transition-colors disabled:opacity-40 min-h-[44px] font-medium"
                              onClick={() => b.id && openRoof(b.id)}
                              disabled={!b.id}
                              title={!b.id ? 'Save building first' : 'Edit roof material breakdown'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit roof materials
                            </button>
                            {!b.id && <p className="text-xs text-slate-400 text-center">Save building first</p>}
                          </>
                        )}
                      </div>

                      {/* Walls */}
                      <div className="border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">Walls</span>
                          <CompletionBadge status={b.id ? getCompletionStatus(b.id, 'wall_construction_percent') : 'missing'} />
                        </div>
                        {wallTotalPct !== null && (
                          <p className="text-xs text-slate-500">
                            Total recorded:{' '}
                            <span className={wallTotalPct === 100 ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
                              {wallTotalPct}%
                            </span>
                          </p>
                        )}
                        {!isLocked && (
                          <>
                            <button
                              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-sm transition-colors disabled:opacity-40 min-h-[44px] font-medium"
                              onClick={() => b.id && openWalls(b.id)}
                              disabled={!b.id}
                              title={!b.id ? 'Save building first' : 'Edit wall material breakdown'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit wall materials
                            </button>
                            {!b.id && <p className="text-xs text-slate-400 text-center">Save building first</p>}
                          </>
                        )}
                      </div>

                      {/* Mezzanine / Upper floors */}
                      <div className="border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">Mezzanine / Upper floors</span>
                          <CompletionBadge status={b.id ? getCompletionStatus(b.id, 'mezzanine_construction_percent') : 'missing'} />
                        </div>
                        {mezzTotalPct !== null && (
                          <p className="text-xs text-slate-500">
                            Total recorded:{' '}
                            <span className={mezzTotalPct === 100 ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
                              {mezzTotalPct}%
                            </span>
                          </p>
                        )}
                        {!isLocked && (
                          <>
                            <button
                              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-sm transition-colors disabled:opacity-40 min-h-[44px] font-medium"
                              onClick={() => b.id && openMezz(b.id)}
                              disabled={!b.id}
                              title={!b.id ? 'Save building first' : 'Edit mezzanine/floor material breakdown'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit mezzanine/floor materials
                            </button>
                            {!b.id && <p className="text-xs text-slate-400 text-center">Save building first</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Structure */}
                {mode !== 'fire_protection' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Structure</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Frame type</label>
                        <select
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          value={b.frame_type}
                          onChange={e => updateRow(idx, { frame_type: e.target.value })}
                        >
                          <option value="unknown">Unknown</option>
                          <option value="steel">Steel</option>
                          <option value="protected_steel">Protected steel</option>
                          <option value="reinforced_concrete">Reinforced concrete</option>
                          <option value="timber">Timber</option>
                          <option value="masonry">Masonry</option>
                          <option value="mixed">Mixed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Compartmentation</label>
                        <select
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          value={b.compartmentation_minutes ?? ''}
                          onChange={e => updateRow(idx, { compartmentation_minutes: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          <option value="">Unknown</option>
                          <option value="0">None / open plan</option>
                          <option value="60">Basic (≤60 min)</option>
                          <option value="120">Standard (90–120 min)</option>
                          <option value="180">Enhanced (180 min)</option>
                          <option value="240">High (240 min / 4 hours)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cladding */}
                {mode !== 'fire_protection' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Cladding</h4>
                    <label className="flex items-center gap-3 cursor-pointer py-1">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-slate-300 accent-blue-600 cursor-pointer"
                        checked={b.cladding_present === true && b.cladding_combustible === true}
                        onChange={e => updateRow(idx, {
                          cladding_present: e.target.checked,
                          cladding_combustible: e.target.checked ? true : null,
                        })}
                      />
                      <span className="text-sm text-slate-700 font-medium">Combustible cladding present</span>
                    </label>
                    {b.cladding_present && b.cladding_combustible && (
                      <div className="mt-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Cladding system details</label>
                        <input
                          type="text"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                          value={b.cladding_system ?? ''}
                          placeholder="e.g. ACM panels, PIR sandwich panels…"
                          onChange={e => updateRow(idx, { cladding_system: e.target.value || null })}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Fire protection */}
                {mode !== 'construction' && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Fire Protection</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Sprinklers</label>
                        <select
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          value={b.sprinklers_present ? 'yes' : 'no'}
                          onChange={e => updateRow(idx, { sprinklers_present: e.target.value === 'yes' })}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Detection</label>
                        <select
                          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          value={b.detection_present ? 'yes' : 'no'}
                          onChange={e => updateRow(idx, { detection_present: e.target.value === 'yes' })}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Calculated metrics */}
                {mode !== 'fire_protection' && computed && (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-6">
                        <div>
                          <div className="text-xs font-medium text-blue-700">RE-02 Score</div>
                          <div className="text-2xl font-bold text-blue-900">{computed.score}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-blue-700">Combustible</div>
                          <div className="text-2xl font-bold text-blue-900">
                            {isNaN(computed.combustiblePercent) ? '—' : `${computed.combustiblePercent}%`}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                        onClick={() => setOpenExplanationForBuildingId(curr => curr === b.id ? null : b.id ?? null)}
                      >
                        <Info className="w-4 h-4" />
                        {openExplanationForBuildingId === b.id ? 'Hide' : 'Explain'}
                      </button>
                    </div>
                    {openExplanationForBuildingId === b.id && (
                      <div className="mt-3 pt-3 border-t border-blue-200 text-sm text-blue-900 space-y-2">
                        <p>{computed.explanation}</p>
                        <div className="text-xs text-blue-700 space-y-0.5">
                          <div>Roof: {isNaN(computed.roofCombustiblePercent) ? '—' : `${computed.roofCombustiblePercent}%`} combustible</div>
                          <div>Walls: {isNaN(computed.wallCombustiblePercent) ? '—' : `${computed.wallCombustiblePercent}%`} combustible</div>
                          <div>Mezz: {isNaN(computed.mezzCombustiblePercent) ? '—' : `${computed.mezzCombustiblePercent}%`} combustible</div>
                          {siteWeightTotal > 0 && (
                            <div className="mt-1">
                              {`Area weight: ${(
                                (Math.max(b.total_floor_area_m2 ?? ((b.roof_area_m2 ?? 0) + (b.mezzanine_area_m2 ?? 0)), 1) /
                                  siteWeightTotal) * 100
                              ).toFixed(1)}% of site${b.total_floor_area_m2 ? ' (GIA)' : ' (roof+mezz fallback)'}`}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          );
        })}
      </div>

      {/* Site-level summary strip */}
      {mode !== 'fire_protection' && rows.some(b => b.id) && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-slate-500">Total roof area:</span>{' '}
              <span className="font-semibold text-slate-900">{totals.roof.toLocaleString()} m²</span>
            </div>
            {totals.gia > 0 && (
              <div>
                <span className="text-slate-500">Total GIA:</span>{' '}
                <span className="font-semibold text-slate-900">{totals.gia.toLocaleString()} m²</span>
              </div>
            )}
            {totals.mezz > 0 && (
              <div>
                <span className="text-slate-500">Total mezzanine / upper floor area:</span>{' '}
                <span className="font-semibold text-slate-900">{totals.mezz.toLocaleString()} m²</span>
              </div>
            )}
            {!isNaN(siteMetrics.score) && (
              <div>
                <span className="text-slate-500">Site RE-02 score:</span>{' '}
                <span className="font-bold text-blue-700">{siteMetrics.score.toFixed(1)}</span>
              </div>
            )}
            {!isNaN(siteMetrics.combustiblePercent) && (
              <div>
                <span className="text-slate-500">Site combustible:</span>{' '}
                <span className="font-semibold text-slate-900">{siteMetrics.combustiblePercent}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Site-level construction notes */}
      {mode !== 'fire_protection' && (
        <div className="border border-slate-200 rounded-xl bg-white p-4">
          <label className="block text-sm font-semibold text-slate-700 mb-2">Site-level construction notes</label>
          <textarea
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
            value={constructionNotes}
            onChange={e => setConstructionNotes(e.target.value)}
            placeholder="Enter general construction observations that apply across the site…"
          />
          <div className="flex justify-end mt-2">
            <button
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-sm font-medium transition-colors disabled:opacity-50"
              onClick={saveSiteNotes}
              disabled={savingNotes || isLocked}
            >
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>
      )}

      {/* Add construction recommendation modal */}
      {resolvedModuleInstanceId && (
        <CanonicalReRecommendationModal
          isOpen={showAddRecModal}
          onClose={() => setShowAddRecModal(false)}
          onSaved={async () => {
            bumpActionsVersion();
            if (onAfterSave) await onAfterSave();
          }}
          documentId={documentId}
          moduleInstanceId={resolvedModuleInstanceId}
          sourceModuleKey="RE_02_CONSTRUCTION"
          sectionLabel="RE-02 – Construction"
        />
      )}

      {/* Walls modal */}
      {wallsOpenForId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border rounded-lg w-full max-w-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Walls construction (%)</div>
              <button className="px-2 py-1 border rounded" onClick={() => setWallsOpenForId(null)}>
                Close
              </button>
            </div>

            {wallsError && <div className="mb-3 p-2 border rounded bg-red-50 text-red-800 text-sm">{wallsError}</div>}

            <div className="grid grid-cols-12 gap-2 text-xs font-medium mb-2">
              <div className="col-span-8">Material</div>
              <div className="col-span-3">Percent</div>
              <div className="col-span-1"></div>
            </div>

            <div className="flex flex-col gap-2">
              {wallsDraft.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    className="col-span-8 border rounded p-2"
                    value={r.material}
                    onChange={e => {
                      const v = e.target.value;
                      setWallsDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, material: v } : x)));
                    }}
                  >
                    {WALL_MATERIAL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="col-span-3 border rounded p-2"
                    value={r.percent}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setWallsDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, percent: v } : x)));
                    }}
                  />
                  <button
                    className="col-span-1 border rounded"
                    onClick={() => setWallsDraft(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button
                className="px-3 py-2 border rounded"
                onClick={() => setWallsDraft(prev => [...prev, { material: 'unknown', percent: 0 }])}
              >
                + Add row
              </button>
              <div className="text-sm">
                Total: <span className={wallsTotal() === 100 ? '' : 'text-red-700'}>{wallsTotal()}%</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-2 border rounded" onClick={() => setWallsOpenForId(null)}>
                Cancel
              </button>
              <button className="px-3 py-2 border rounded" onClick={saveWalls}>
                Save walls %
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roof modal */}
      {roofOpenForId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border rounded-lg w-full max-w-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Roof construction (%)</div>
              <button className="px-2 py-1 border rounded" onClick={() => setRoofOpenForId(null)}>
                Close
              </button>
            </div>

            {roofError && <div className="mb-3 p-2 border rounded bg-red-50 text-red-800 text-sm">{roofError}</div>}

            <div className="grid grid-cols-12 gap-2 text-xs font-medium mb-2">
              <div className="col-span-8">Material</div>
              <div className="col-span-3">Percent</div>
              <div className="col-span-1"></div>
            </div>

            <div className="flex flex-col gap-2">
              {roofDraft.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    className="col-span-8 border rounded p-2"
                    value={r.material}
                    onChange={e => {
                      const v = e.target.value;
                      setRoofDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, material: v } : x)));
                    }}
                  >
                    {ROOF_MATERIAL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="col-span-3 border rounded p-2"
                    value={r.percent}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setRoofDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, percent: v } : x)));
                    }}
                  />
                  <button
                    className="col-span-1 border rounded"
                    onClick={() => setRoofDraft(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button
                className="px-3 py-2 border rounded"
                onClick={() => setRoofDraft(prev => [...prev, { material: 'unknown', percent: 0 }])}
              >
                + Add row
              </button>
              <div className="text-sm">
                Total: <span className={rowsTotal(roofDraft) === 100 ? '' : 'text-red-700'}>{rowsTotal(roofDraft)}%</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-2 border rounded" onClick={() => setRoofOpenForId(null)}>
                Cancel
              </button>
              <button className="px-3 py-2 border rounded" onClick={saveRoof}>
                Save roof %
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mezzanine modal */}
      {mezzOpenForId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border rounded-lg w-full max-w-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Upper floors / Mezzanine construction (%)</div>
              <button className="px-2 py-1 border rounded" onClick={() => setMezzOpenForId(null)}>
                Close
              </button>
            </div>

            {mezzError && <div className="mb-3 p-2 border rounded bg-red-50 text-red-800 text-sm">{mezzError}</div>}

            <div className="grid grid-cols-12 gap-2 text-xs font-medium mb-2">
              <div className="col-span-8">Material</div>
              <div className="col-span-3">Percent</div>
              <div className="col-span-1"></div>
            </div>

            <div className="flex flex-col gap-2">
              {mezzDraft.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    className="col-span-8 border rounded p-2"
                    value={r.material}
                    onChange={e => {
                      const v = e.target.value;
                      setMezzDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, material: v } : x)));
                    }}
                  >
                    {MEZZ_MATERIAL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="col-span-3 border rounded p-2"
                    value={r.percent}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setMezzDraft(prev => prev.map((x, idx) => (idx === i ? { ...x, percent: v } : x)));
                    }}
                  />
                  <button
                    className="col-span-1 border rounded"
                    onClick={() => setMezzDraft(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3">
              <button
                className="px-3 py-2 border rounded"
                onClick={() => setMezzDraft(prev => [...prev, { material: 'unknown', percent: 0 }])}
              >
                + Add row
              </button>
              <div className="text-sm">
                Total: <span className={rowsTotal(mezzDraft) === 100 ? '' : 'text-red-700'}>{rowsTotal(mezzDraft)}%</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-2 border rounded" onClick={() => setMezzOpenForId(null)}>
                Cancel
              </button>
              <button className="px-3 py-2 border rounded" onClick={saveMezz}>
                Save mezzanine %
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
