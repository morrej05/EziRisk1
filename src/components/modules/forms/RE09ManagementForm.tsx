import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import ModuleActions from '../ModuleActions';
import FloatingSaveBar from './FloatingSaveBar';
import { getHrgConfig } from '../../../lib/re/reference/hrgMasterMap';
import { setRating } from '../../../lib/re/scoring/riskEngineeringHelpers';
import { syncAutoRecToRegister } from '../../../lib/re/recommendations/recommendationPipeline';
import { bumpActionsVersion } from '../../../lib/actions/actionsInvalidation';
import type { AutoRecommendationLifecycleState } from '../../../lib/re/recommendations/recommendationPipeline';
import RatingButtons from '../../re/RatingButtons';

interface Document {
  id: string;
  title: string;
}

interface ModuleInstance {
  id: string;
  document_id: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface RE09ManagementFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

const CANONICAL_KEY = 'process_safety_management';

const CATEGORY_LABELS: Record<string, string> = {
  housekeeping: 'Housekeeping',
  hot_work: 'Hot Work Controls',
  impairment_management: 'Impairment Management',
  contractor_control: 'Contractor Control',
  maintenance: 'Maintenance Programs',
  emergency_planning: 'Emergency Planning',
  change_management: 'Change Management',
};

const RATING_LABELS: Record<number, string> = {
  1: 'Poor / Inadequate',
  2: 'Below Average',
  3: 'Average / Acceptable',
  4: 'Good',
  5: 'Excellent',
};

const CATEGORY_FACTOR_KEYS: Record<string, string> = {
  housekeeping: 'management_housekeeping',
  hot_work: 'management_hot_work',
  impairment_management: 'management_impairment_management',
  contractor_control: 'management_contractor_control',
  maintenance: 'management_maintenance',
  emergency_planning: 'management_emergency_planning',
  change_management: 'management_change_management',
};

// Invert rating for UI display: stored 1=excellent, UI 1=poor
const invertRatingForUI = (stored: number | null): number | null => {
  if (stored === null) return null;
  return 6 - stored;
};

// Invert rating for storage: UI 1=poor, stored 1=excellent
const invertRatingForStorage = (ui: number | null): number | null => {
  if (ui === null) return null;
  return 6 - ui;
};

// Helper to build initial form data from module data
const buildInitialFormData = (data: Record<string, any>) => {
  const categories = (data.categories || [
    { key: 'housekeeping', rating_1_5: null, notes: '' },
    { key: 'hot_work', rating_1_5: null, notes: '' },
    { key: 'impairment_management', rating_1_5: null, notes: '' },
    { key: 'contractor_control', rating_1_5: null, notes: '' },
    { key: 'maintenance', rating_1_5: null, notes: '' },
    { key: 'emergency_planning', rating_1_5: null, notes: '' },
    { key: 'change_management', rating_1_5: null, notes: '' },
  ]).map((cat: any) => {
    const uiRating = invertRatingForUI(cat.rating_1_5);
    return {
      ...cat,
      rating_1_5: uiRating !== null ? Number(uiRating) : null,
    };
  });

  return {
    categories,
    recommendations: data.recommendations || [],
  };
};

export default function RE09ManagementForm({
  moduleInstance,
  document,
  onSaved,
}: RE09ManagementFormProps) {
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState(() => buildInitialFormData(moduleInstance.data || {}));

  const [riskEngData, setRiskEngData] = useState<any>({});
  const [riskEngInstanceId, setRiskEngInstanceId] = useState<string | null>(null);
  const [industryKey, setIndustryKey] = useState<string | null>(null);
  const [autoRecStates, setAutoRecStates] = useState<Record<string, AutoRecommendationLifecycleState>>({});

  // Refs to track hydration state
  const lastIdRef = useRef<string | null>(null);
  const seenPopulatedForCurrentIdRef = useRef(false);

  // Hydrate/reset form state when:
  // 1. moduleInstance.id changes (always reset)
  // 2. Data transitions from empty → populated for the same ID (initial load case)
  useEffect(() => {
    const d = moduleInstance.data || {};

    // Check if data is populated (has actual category ratings or recommendations)
    const hasPopulatedData = !!(
      (d.categories && d.categories.length > 0 && d.categories.some((c: any) => c.rating_1_5 !== null)) ||
      (d.recommendations && d.recommendations.length > 0) ||
      Object.keys(d).length > 0
    );

    const idChanged = lastIdRef.current !== moduleInstance.id;
    const transitionedToPopulated = hasPopulatedData && !seenPopulatedForCurrentIdRef.current;

    // Reset if ID changed OR if this is first time seeing populated data for this ID
    if (idChanged || transitionedToPopulated) {
      if (import.meta.env.DEV) {
        console.debug('[RE09ManagementForm] hydrating form state', {
          moduleInstanceId: moduleInstance.id,
          reason: idChanged ? 'id-changed' : 'empty-to-populated',
          hasPopulatedData,
        });
      }

      setFormData(buildInitialFormData(d));

      // Update tracking refs
      lastIdRef.current = moduleInstance.id;
      seenPopulatedForCurrentIdRef.current = hasPopulatedData;
    }
  }, [moduleInstance.id, moduleInstance.data]);

  useEffect(() => {
    async function loadRiskEngModule() {
      try {
        const { data: instance, error } = await supabase
          .from('module_instances')
          .select('id, data')
          .eq('document_id', moduleInstance.document_id)
          .eq('module_key', 'RISK_ENGINEERING')
          .single();

        if (error) throw error;

        if (instance) {
          setRiskEngInstanceId(instance.id);
          setRiskEngData(instance.data || {});
          setIndustryKey(instance.data?.industry_key || null);
        }
      } catch (err) {
        console.error('Error loading RISK_ENGINEERING module:', err);
      }
    }

    loadRiskEngModule();
  }, [moduleInstance.document_id]);

  useEffect(() => {
    async function loadAutoRecommendationStates() {
      const factorKeys = Object.values(CATEGORY_FACTOR_KEYS);
      const { data, error } = await supabase
        .from('re_recommendations')
        .select('source_factor_key, is_suppressed, created_at')
        .eq('document_id', moduleInstance.document_id)
        .eq('module_instance_id', moduleInstance.id)
        .eq('source_module_key', 'RE_09_MANAGEMENT')
        .eq('source_type', 'auto')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[RE09Management] Failed to load auto recommendation states:', error);
        return;
      }

      const nextStates: Record<string, AutoRecommendationLifecycleState> = {};
      factorKeys.forEach((factorKey) => {
        nextStates[factorKey] = 'none';
      });

      for (const row of data || []) {
        const factorKey = row.source_factor_key;
        if (!factorKey || !factorKeys.includes(factorKey)) continue;
        if (nextStates[factorKey] !== 'none') continue;
        nextStates[factorKey] = row.is_suppressed ? 'suppressed' : 'created';
      }

      setAutoRecStates(nextStates);
    }

    void loadAutoRecommendationStates();
  }, [moduleInstance.document_id, moduleInstance.id]);

  const hrgConfig = getHrgConfig(industryKey, CANONICAL_KEY);

  // Calculate overall rating from categories (weighted average)
  const calculateOverallRating = (categories: any[]): number | null => {
    const rated = categories.filter((c) => c.rating_1_5 !== null && c.rating_1_5 !== undefined);
    if (rated.length === 0) return null;

    // All categories have equal weight (1)
    const sum = rated.reduce((acc, c) => acc + Number(c.rating_1_5), 0);
    const avg = sum / rated.length;

    // Round and clamp to 1-5, then invert back to storage format (1=excellent)
    const uiRating = Math.max(1, Math.min(5, Math.round(avg)));
    return Number(invertRatingForStorage(uiRating));
  };

  // Update overall rating in RISK_ENGINEERING module
  const updateOverallRating = async (categories: any[]) => {
    if (!riskEngInstanceId) return;

    const overallRating = calculateOverallRating(categories);
    if (overallRating === null) return;

    try {
      const updatedRiskEngData = setRating(riskEngData, CANONICAL_KEY, overallRating);

      const { error } = await supabase
        .from('module_instances')
        .update({ data: updatedRiskEngData })
        .eq('id', riskEngInstanceId);

      if (error) throw error;

      setRiskEngData(updatedRiskEngData);

      // DO NOT call setFormData here - this would overwrite the user's rating selection
      // Auto-recommendations are applied separately using functional setState
    } catch (err) {
      console.error('Error updating overall rating:', err);
    }
  };

  const updateCategory = (key: string, field: string, value: any) => {
    // Ensure numeric values are stored as numbers
    const normalizedValue = field === 'rating_1_5' && value !== null ? Number(value) : value;

    // Update ONLY local state (no async side effects during editing)
    setFormData((prev) => {
      const nextCategories = (prev.categories ?? []).map((c: any) =>
        c.key === key ? { ...c, [field]: normalizedValue } : c
      );

      return { ...prev, categories: nextCategories };
    });
  };

  const getAutoStateLabel = (rating: number | null, autoRecommendationState: AutoRecommendationLifecycleState) => {
    const lowScore = rating !== null && rating <= 2;

    if (lowScore) {
      if (autoRecommendationState === 'created' || autoRecommendationState === 'updated' || autoRecommendationState === 'restored') {
        return 'Auto recommendation active';
      }
      if (autoRecommendationState === 'suppressed') {
        return 'Recommendation will be reactivated on save';
      }
      return 'Recommendation will be created on save';
    }

    if (autoRecommendationState === 'created' || autoRecommendationState === 'updated' || autoRecommendationState === 'restored') {
      return 'Recommendation will be suppressed on save';
    }

    return 'No active recommendation';
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Invert ratings back to storage format before saving
      const managementPayload = {
        ...formData,
        categories: formData.categories.map((cat: any) => {
          const uiRating = cat.rating_1_5 !== null ? Number(cat.rating_1_5) : null;
          const storedRating = invertRatingForStorage(uiRating);
          return {
            ...cat,
            rating_1_5: storedRating !== null ? Number(storedRating) : null,
          };
        }),
      };

      // Preserve other moduleInstance.data keys
      const dataToSave = { ...moduleInstance.data, ...managementPayload };
      const sanitized = sanitizeModuleInstancePayload({ data: dataToSave });

      const { error } = await supabase
        .from('module_instances')
        .update({
          data: sanitized.data,
        })
        .eq('id', moduleInstance.id);

      if (error) throw error;

      onSaved();

      // Non-blocking: update RISK_ENGINEERING overall rating + per-factor auto-recommendations
      const overallRating = calculateOverallRating(managementPayload.categories);
      const syncCategoryAutos = async () => {
        let hasLifecycleChange = false;
        const lifecycleUpdates: Record<string, AutoRecommendationLifecycleState> = {};

        for (const category of formData.categories) {
          const canonicalKey = CATEGORY_FACTOR_KEYS[category.key];
          if (!canonicalKey) continue;
          const rating = category.rating_1_5 !== null ? Number(category.rating_1_5) : null;
          if (rating === null) continue;

          const lifecycleState = await syncAutoRecToRegister({
            documentId: moduleInstance.document_id,
            moduleKey: 'RE_09_MANAGEMENT',
            canonicalKey,
            moduleInstanceId: moduleInstance.id,
            rating_1_5: rating,
            industryKey,
          });

          lifecycleUpdates[canonicalKey] = lifecycleState;
          if (lifecycleState !== 'none') {
            hasLifecycleChange = true;
          }
        }

        if (Object.keys(lifecycleUpdates).length > 0) {
          setAutoRecStates((prev) => ({
            ...prev,
            ...lifecycleUpdates,
          }));
        }

        if (hasLifecycleChange) {
          bumpActionsVersion();
        }
      };

      Promise.allSettled([
        overallRating !== null ? updateOverallRating(managementPayload.categories) : Promise.resolve(),
        syncCategoryAutos(),
      ]).catch((e) => {
        console.error('[RE09Management] post-save tasks failed:', e);
      });
    } catch (error) {
      console.error('Error saving module:', error);
      alert('Failed to save module. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate display values for overall rating
  const overallRatingStored = calculateOverallRating(formData.categories);
  const overallRatingUI = overallRatingStored !== null ? Number(invertRatingForUI(overallRatingStored)) : null;
  const overallRatingLabel = overallRatingUI !== null ? RATING_LABELS[overallRatingUI] : 'Not rated';

  return (
    <>
    <div className="p-6 max-w-5xl mx-auto pb-24">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">RE-7 - Management Systems</h2>
        <p className="text-slate-600">Assessment of operational management and control systems</p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6 mb-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-3">Overall Management Systems Rating</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-slate-600 mb-2">
              Auto-calculated from category ratings below (weighted average)
            </p>
            {hrgConfig.helpText && (
              <p className="text-sm text-slate-500 italic">{hrgConfig.helpText}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-blue-600">{overallRatingUI || '—'}</div>
            <div className="text-sm text-slate-600">{overallRatingLabel}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6 mb-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Industry-Specific Risk Factors - Rating Panels</h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-900">
              <strong>Rating Scale:</strong> 1 = Poor/Inadequate, 2 = Below Average, 3 = Average/Acceptable, 4 = Good, 5 = Excellent.
              Poor ratings should typically trigger recommendations for improvement.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {formData.categories.map((category: any) => (
              <div key={category.key} className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-semibold text-slate-900 mb-3">{CATEGORY_LABELS[category.key]}</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Engineer Rating (1 = Poor, 5 = Excellent)
                    </label>
                    <RatingButtons
                      value={category.rating_1_5 !== null ? Number(category.rating_1_5) : null}
                      onChange={(num) => updateCategory(category.key, 'rating_1_5', Number(num))}
                      labels={RATING_LABELS}
                      size="sm"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      {getAutoStateLabel(
                        category.rating_1_5 !== null ? Number(category.rating_1_5) : null,
                        autoRecStates[CATEGORY_FACTOR_KEYS[category.key]] || 'none'
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                    <textarea
                      value={category.notes ?? ''}
                      onChange={(e) => updateCategory(category.key, 'notes', e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                      placeholder="Describe current practices, gaps, and observations"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {document?.id && moduleInstance?.id && (
        <ModuleActions
          documentId={document.id}
          moduleInstanceId={moduleInstance.id}
          buttonLabel="Add Recommendation"
          useInPlaceReRecommendationModal
        />
      )}
    </div>

      <FloatingSaveBar onSave={handleSave} isSaving={isSaving} />
    </>
  );
}
