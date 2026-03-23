import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, RefreshCw, ExternalLink, CheckSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { buildFraPdf } from '../../lib/pdf/buildFraPdf';
import { buildFsdPdf } from '../../lib/pdf/buildFsdPdf';
import { buildDsearPdf } from '../../lib/pdf/buildDsearPdf';
import { buildCombinedPdf } from '../../lib/pdf/buildCombinedPdf';
import { buildFraDsearCombinedPdf } from '../../lib/pdf/buildFraDsearCombinedPdf';
import { buildReSurveyPdf } from '../../lib/pdf/buildReSurveyPdf';
import { buildReLpPdf } from '../../lib/pdf/buildReLpPdf';
import { uploadDraftPdfAndSign, saveReModuleSelection, loadReModuleSelection, safeSlug } from '../../utils/draftPdf';
import { saveAs } from 'file-saver';
import { SurveyBadgeRow } from '../../components/SurveyBadgeRow';
import { getReModulesForDocument } from '../../lib/modules/moduleCatalog';
import { getModuleDisplayName } from '../../lib/modules/moduleDisplay';
import { migrateLegacyFraActions } from '../../lib/modules/fra/migrateLegacyFraActions';
import type { FraContext } from '../../lib/modules/fra/severityEngine';
import { assignActionReferenceNumbers } from '../../utils/actionReferenceNumbers';
import { normalizeJurisdiction } from '../../lib/jurisdictions';

type OutputMode = 'FRA' | 'FSD' | 'DSEAR' | 'COMBINED' | 'FIRE_EXPLOSION_COMBINED';
type ReReportTab = 're_survey' | 're_lp';

export default function DocumentPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organisation } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [document, setDocument] = useState<any>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('document.pdf');
  const [outputMode, setOutputMode] = useState<OutputMode>('FRA');
  const [availableModes, setAvailableModes] = useState<OutputMode[]>(['FRA']);
  const [isGenerating, setIsGenerating] = useState(false);

  // RE-specific state
  const [reActiveTab, setReActiveTab] = useState<ReReportTab>('re_survey');
  const [reAvailableModules, setReAvailableModules] = useState<Array<{ code: string; title: string }>>([]);
  const [reSelectedModules, setReSelectedModules] = useState<string[]>([]);

  // Data for PDF generation
  const [moduleInstances, setModuleInstances] = useState<any[]>([]);
  const [enrichedActions, setEnrichedActions] = useState<any[]>([]);
  const [actionRatings, setActionRatings] = useState<any[]>([]);

  const isReDocument = document?.document_type === 'RE';

  const getAvailableOutputModes = (doc: any): OutputMode[] => {
    if (doc.document_type === 'RE') {
      return []; // RE uses tabs instead of output modes
    }

    const enabledModules = doc.enabled_modules || [doc.document_type];
    const modes: OutputMode[] = [];

    if (enabledModules.includes('FRA')) modes.push('FRA');
    if (enabledModules.includes('FSD')) modes.push('FSD');
    if (enabledModules.includes('DSEAR')) modes.push('DSEAR');

    if (enabledModules.length > 1 && enabledModules.includes('FRA') && enabledModules.includes('FSD')) {
      modes.push('COMBINED');
    }

    if (enabledModules.length > 1 && enabledModules.includes('FRA') && enabledModules.includes('DSEAR')) {
      modes.push('FIRE_EXPLOSION_COMBINED');
    }

    return modes.length > 0 ? modes : [doc.document_type as OutputMode];
  };

  const getDefaultOutputMode = (doc: any): OutputMode => {
    const enabledModules = doc.enabled_modules || [doc.document_type];

    if (enabledModules.length > 1 && enabledModules.includes('FRA') && enabledModules.includes('FSD')) {
      return 'COMBINED';
    }

    return enabledModules[0] as OutputMode;
  };

  const formatFilename = (doc: any, mode: OutputMode | ReReportTab) => {
    const siteName = (doc.title || 'document')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
    const dateStr = doc.assessment_date ? new Date(doc.assessment_date).toISOString().split('T')[0] : 'date';
    const docType = mode === 'COMBINED' ? 'COMBINED' : (mode === 're_survey' ? 'RE_SURVEY' : mode === 're_lp' ? 'RE_LP' : doc.document_type || 'DOC');
    const v = doc.version_number || doc.version || 1;
    return `${docType}_${siteName}_${dateStr}_v${v}.pdf`;
  };

  // Load document and data
  useEffect(() => {
    if (!id || !organisation?.id) return;

    const run = async () => {
      setIsLoading(true);
      setErrorMsg(null);

      try {
        const { data: doc, error: docErr } = await supabase
          .from('documents')
          .select('*')
          .eq('id', id)
          .eq('organisation_id', organisation.id)
          .maybeSingle();

        if (docErr) throw docErr;
        if (!doc) {
          setErrorMsg('Document not found or you do not have access.');
          setIsLoading(false);
          return;
        }

        setDocument(doc);

        // Setup modes/tabs based on document type
        if (doc.document_type === 'RE') {
          // We'll load canonical modules after we have module instances
          // For now, just note that we need to handle RE
        } else {
          const modes = getAvailableOutputModes(doc);
          setAvailableModes(modes);
          const defaultMode = getDefaultOutputMode(doc);
          setOutputMode(defaultMode);
        }

        const fname = formatFilename(doc, doc.document_type === 'RE' ? 're_survey' : getDefaultOutputMode(doc));
        setFilename(fname);

        // Load module and action data for PDF generation
        let modules: any[] = [];
        let actions: any[] = [];
        let ratings: any[] = [];

        if (doc.issue_status !== 'draft') {
          // For issued documents, load from live tables
          const { data: modulesData } = await supabase
            .from('module_instances')
            .select('*')
            .eq('document_id', id)
            .eq('organisation_id', organisation.id);

          modules = modulesData || [];

          console.log('[PDF Preview] generating for document id:', id);
          const { data: actionsData } = await supabase
            .from('actions')
            .select(`*`)
            .eq('document_id', id)
            .eq('organisation_id', organisation.id)
            .is('deleted_at', null);

          console.log('[PDF Preview] actions loaded:', actionsData?.length ?? 0);
          actions = actionsData || [];
        } else {
          // Draft document: load live data
          const { data: modulesData, error: moduleError } = await supabase
            .from('module_instances')
            .select('*')
            .eq('document_id', id)
            .eq('organisation_id', organisation.id);

          if (moduleError) throw moduleError;
          modules = modulesData || [];

          console.log('[PDF Preview] generating for document id:', id);
          const { data: actionsData, error: actionsError } = await supabase
            .from('actions')
            .select(`
              id,
              reference_number,
              source,
              recommended_action,
              priority_band,
              status,
              owner_user_id,
              target_date,
              module_instance_id,
              created_at
            `)
            .eq('document_id', id)
            .eq('organisation_id', organisation.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

          if (actionsError) throw actionsError;
          console.log('[PDF Preview] actions loaded:', actionsData?.length ?? 0);

          const actionIds = (actionsData || []).map((a: any) => a.id);
          if (actionIds.length > 0) {
            const { data: ratingsData } = await supabase
              .from('action_ratings')
              .select('action_id, likelihood, impact, score, rated_at')
              .in('action_id', actionIds)
              .order('rated_at', { ascending: false });

            ratings = ratingsData || [];
          }

          const ownerUserIds = (actionsData || []).map((a: any) => a.owner_user_id).filter(Boolean);
          const uniqueOwnerIds = [...new Set(ownerUserIds)];
          const userNameMap = new Map<string, string>();

          if (uniqueOwnerIds.length > 0) {
            const { data: profiles } = await supabase
              .from('user_profiles')
              .select('user_id, name')
              .in('user_id', uniqueOwnerIds);

            (profiles || []).forEach((p: any) => {
              if (p?.name) userNameMap.set(p.user_id, p.name);
            });
          }

          actions = (actionsData || []).map((a: any) => ({
            ...a,
            owner_display_name: a.owner_user_id ? userNameMap.get(a.owner_user_id) : null,
          }));
        }

        // Apply legacy FRA action migration if needed
        if (doc.document_type === 'FRA' || doc.document_type === 'FSD' || doc.document_type === 'DSEAR') {
          const buildingProfile = modules.find((m: any) => m.module_key === 'A2_BUILDING_PROFILE');
          const fraContext: FraContext = {
            occupancyRisk: (buildingProfile?.data?.occupancy_risk || 'NonSleeping') as 'NonSleeping' | 'Sleeping' | 'Vulnerable',
            storeys: buildingProfile?.data?.number_of_storeys || null,
          };
          actions = migrateLegacyFraActions(actions, fraContext);
        }

        setModuleInstances(modules);
        setEnrichedActions(actions);
        setActionRatings(ratings);

        // Setup RE module selection if RE document
        if (doc.document_type === 'RE') {
          const canonicalModules = getReModulesForDocument(modules, { documentId: id });
          setReAvailableModules(
            canonicalModules.map((m) => ({ code: m.module_key, title: getModuleDisplayName(m.module_key) }))
          );

          // Load saved module selection or default to all
          const saved = await loadReModuleSelection(id);
          setReSelectedModules(saved || canonicalModules.map(m => m.module_key));
        }

        setIsLoading(false);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message || 'Failed to load preview.');
        setIsLoading(false);
      }
    };

    run();
  }, [id, organisation?.id]);

  const handleGeneratePdf = async () => {
    if (!document || !organisation?.id) return;

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      // Fetch fresh organisation data from DB to ensure branding_logo_path is current
      const { data: freshOrg, error: orgError } = await supabase
        .from('organisations')
        .select('id, name, branding_logo_path')
        .eq('id', organisation.id)
        .maybeSingle();

      if (orgError) {
        console.error('[PDF Preview] Failed to fetch organisation:', orgError);
        throw new Error('Failed to fetch organisation data');
      }

      if (!freshOrg) {
        console.error('[PDF Preview] Organisation not found');
        throw new Error('Organisation not found');
      }

      console.log('[PDF Preview] Fresh organisation data:', {
        id: freshOrg.id,
        name: freshOrg.name,
        branding_logo_path: freshOrg.branding_logo_path
      });

      // Ensure action reference numbers are assigned before generating PDFs (Policy B)
      if (!isReDocument) {
        try {
          await assignActionReferenceNumbers(document.id, document.base_document_id ?? document.id);
          console.log('[PDF Preview] Action reference numbers assigned');
        } catch (refError) {
          console.error('[PDF Preview] Failed to assign reference numbers:', refError);
          // Continue anyway - references may already exist
        }
      }

      // Refetch actions to include assigned reference numbers
      let actions = enrichedActions;
      if (!isReDocument) {
        try {
          const { data: actionsData } = await supabase
            .from('actions')
            .select(`
              id,
              source,
              recommended_action,
              priority_band,
              status,
              owner_user_id,
              target_date,
              module_instance_id,
              reference_number,
              created_at
            `)
            .eq('document_id', document.id)
            .eq('organisation_id', organisation.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

          if (actionsData) {
            // Re-enrich with owner names
            const ownerUserIds = actionsData.map((a: any) => a.owner_user_id).filter(Boolean);
            const uniqueOwnerIds = [...new Set(ownerUserIds)];
            const userNameMap = new Map<string, string>();

            if (uniqueOwnerIds.length > 0) {
              const { data: profiles } = await supabase
                .from('user_profiles')
                .select('user_id, name')
                .in('user_id', uniqueOwnerIds);

              (profiles || []).forEach((p: any) => {
                if (p?.name) userNameMap.set(p.user_id, p.name);
              });
            }

            actions = actionsData.map((a: any) => ({
              ...a,
              owner_display_name: a.owner_user_id ? userNameMap.get(a.owner_user_id) : null,
            }));

            console.log('[PDF Preview] Refetched actions with references:', {
              count: actions.length,
              withRefs: actions.filter((a: any) => a.reference_number).length,
            });
          }
        } catch (refetchError) {
          console.error('[PDF Preview] Failed to refetch actions:', refetchError);
          // Use original enrichedActions if refetch fails
        }
      }

      console.log('[PDF Preview] actions sources summary:',
        (actions || []).reduce((acc:any,a:any)=>{ const k=a.source||'null'; acc[k]=(acc[k]||0)+1; return acc; }, {})
      );

      const pdfOptions = {
        document,
        moduleInstances,
        actions,
        actionRatings,
        organisation: {
          id: freshOrg.id,
          name: freshOrg.name,
          branding_logo_path: freshOrg.branding_logo_path,
        },
        renderMode: (document.issue_status === 'issued' || document.issue_status === 'superseded') ? 'issued' as const : 'preview' as const,
      };

      let pdfBytes: Uint8Array;
      let reportKind: 'fra' | 'fsd' | 'ex' | 're_survey' | 're_lp';

      if (isReDocument) {
        // RE documents
        if (reActiveTab === 're_survey') {
          let reSurveyModuleInstances = moduleInstances;
          let reSurveyRecommendations = actions;

          const { data: reRecommendations, error: reRecommendationsError } = await supabase
            .from('re_recommendations')
            .select(`
              id,
              document_id,
              title,
              action_required_text,
              priority,
              status,
              owner,
              target_date,
              module_instance_id,
              rec_number,
              created_at
            `)
            .eq('document_id', document.id)
            .eq('is_suppressed', false)
            .order('created_at', { ascending: true });

          if (reRecommendationsError) {
            throw reRecommendationsError;
          }

          const priorityToBand: Record<string, string> = {
            critical: 'P1',
            high: 'P1',
            medium: 'P2',
            low: 'P3',
          };

          reSurveyRecommendations = (reRecommendations || []).map((rec: any, index: number) => ({
            id: rec.id,
            document_id: rec.document_id,
            recommended_action: rec.action_required_text || rec.title || `Recommendation ${index + 1}`,
            priority_band: priorityToBand[String(rec.priority || '').toLowerCase()] || 'P3',
            status: rec.status || 'Open',
            owner_user_id: null,
            owner_display_name: rec.owner || null,
            target_date: rec.target_date || null,
            module_instance_id: rec.module_instance_id,
            created_at: rec.created_at,
            reference_number: rec.rec_number || null,
            completed_at: rec.completed_at || null,
            is_complete: rec.is_complete ?? null,
          }));

          try {
            const re02Module = moduleInstances.find((instance: any) => instance.module_key === 'RE_02_CONSTRUCTION');
            if (re02Module) {
              const [{ data: reBuildings }, { data: reBuildingExtras }, { data: reSiteNotes }] = await Promise.all([
                supabase
                  .from('re_buildings')
                  .select('*')
                  .eq('document_id', document.id)
                  .order('created_at', { ascending: true }),
                supabase
                  .from('re_building_extra')
                  .select('building_id, data'),
                supabase
                  .from('re_site_notes')
                  .select('construction_notes')
                  .eq('document_id', document.id)
                  .maybeSingle(),
              ]);

              const extrasByBuildingId = new Map<string, any>(
                (reBuildingExtras || []).map((extra: any) => [extra.building_id, extra.data || {}])
              );

              const enrichedBuildings = (reBuildings || []).map((building: any) => {
                const extra = extrasByBuildingId.get(building.id) || {};
                return {
                  ...building,
                  roof_construction_percent: extra?.roof_construction_percent ?? building?.roof_construction_percent ?? null,
                  wall_construction_percent: extra?.wall_construction_percent ?? building?.wall_construction_percent ?? null,
                  mezzanine_construction_percent: extra?.mezzanine_construction_percent ?? building?.mezzanine_construction_percent ?? null,
                  roof: {
                    ...(building?.roof || {}),
                    construction_percent: extra?.roof_construction_percent ?? building?.roof?.construction_percent ?? null,
                  },
                  walls: {
                    ...(building?.walls || {}),
                    construction_percent: extra?.wall_construction_percent ?? building?.walls?.construction_percent ?? null,
                  },
                  upper_floors_mezzanine: {
                    ...(building?.upper_floors_mezzanine || {}),
                    construction_percent: extra?.mezzanine_construction_percent ?? building?.upper_floors_mezzanine?.construction_percent ?? null,
                  },
                };
              });

              reSurveyModuleInstances = moduleInstances.map((instance: any) => {
                if (instance.module_key !== 'RE_02_CONSTRUCTION') return instance;
                const root = (instance.data || {}) as any;
                const construction = root.construction || root;
                const nextConstruction = {
                  ...construction,
                  buildings: enrichedBuildings,
                  site_notes: construction?.site_notes || reSiteNotes?.construction_notes || '',
                };
                return {
                  ...instance,
                  data: {
                    ...root,
                    construction: nextConstruction,
                  },
                };
              });
            }
          } catch (reEnrichmentError) {
            console.warn('[PDF Preview] RE construction enrichment failed; continuing with module snapshot only:', reEnrichmentError);
          }

          pdfBytes = await buildReSurveyPdf({
            ...pdfOptions,
            actions: reSurveyRecommendations,
            moduleInstances: reSurveyModuleInstances,
            selectedModules: reSelectedModules,
          });
          reportKind = 're_survey';
        } else {
          const { data: reRecommendations, error: reRecommendationsError } = await supabase
            .from('re_recommendations')
            .select(`
              id,
              title,
              action_required_text,
              priority,
              status,
              target_date,
              module_instance_id,
              source_module_key,
              rec_number,
              created_at
            `)
            .eq('document_id', document.id)
            .eq('is_suppressed', false)
            .order('created_at', { ascending: true });

          if (reRecommendationsError) {
            throw reRecommendationsError;
          }

          const priorityToBand: Record<string, string> = {
            critical: 'P1',
            high: 'P1',
            medium: 'P2',
            low: 'P3',
          };

          const statusMap: Record<string, string> = {
            Open: 'open',
            'In Progress': 'in_progress',
            Completed: 'closed',
          };

          const lpActions = (reRecommendations || []).map((rec: any, index: number) => ({
            id: rec.id,
            recommended_action: rec.action_required_text || rec.title || `Recommendation ${index + 1}`,
            priority_band: priorityToBand[String(rec.priority || '').toLowerCase()] || 'P3',
            status: statusMap[rec.status] || 'open',
            owner_user_id: null,
            owner_display_name: null,
            target_date: rec.target_date || null,
            module_instance_id: rec.module_instance_id,
            created_at: rec.created_at,
            reference_number: rec.rec_number || null,
            source_module_key: rec.source_module_key || null,
          }));

          console.log('[PDF Preview] RE LP recommendations loaded:', {
            count: lpActions.length,
            byPriorityBand: lpActions.reduce((acc: Record<string, number>, item: any) => {
              const key = item.priority_band || 'P3';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {}),
          });

          pdfBytes = await buildReLpPdf({
            ...pdfOptions,
            actions: lpActions,
          });
          reportKind = 're_lp';
        }

        // Upload to storage and get signed URL
        const result = await uploadDraftPdfAndSign({
          organisationId: organisation.id,
          documentId: document.id,
          reportKind,
          filenameBase: safeSlug(document.title || 'document'),
          pdfBytes,
        });

        setSignedUrl(result.signedUrl);
        setDraftPath(result.path);
        setFilename(formatFilename(document, reActiveTab));
      } else {
        // Standard documents
        if (outputMode === 'FIRE_EXPLOSION_COMBINED') {
          pdfBytes = await buildFraDsearCombinedPdf(pdfOptions);
          reportKind = 'fra'; // Use fra as base
        } else if (outputMode === 'COMBINED') {
          pdfBytes = await buildCombinedPdf(pdfOptions);
          reportKind = 'fra'; // Use fra as base
        } else if (outputMode === 'FSD') {
          pdfBytes = await buildFsdPdf(pdfOptions);
          reportKind = 'fsd';
        } else if (outputMode === 'DSEAR') {
          pdfBytes = await buildDsearPdf(pdfOptions);
          reportKind = 'ex';
        } else {
          pdfBytes = await buildFraPdf(pdfOptions);
          reportKind = 'fra';
        }

        // Upload to storage and get signed URL
        const result = await uploadDraftPdfAndSign({
          organisationId: organisation.id,
          documentId: document.id,
          reportKind,
          filenameBase: safeSlug(document.title || 'document'),
          pdfBytes,
        });

        setSignedUrl(result.signedUrl);
        setDraftPath(result.path);
        setFilename(formatFilename(document, outputMode));
      }
    } catch (e: any) {
      console.error('[PDF Generation Error]', e);
      setErrorMsg(e?.message || 'Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!signedUrl) return;
    try {
      const res = await fetch(signedUrl);
      const blob = await res.blob();
      saveAs(blob, filename);
    } catch (e) {
      alert('Failed to download PDF.');
    }
  };

  const handleModuleToggle = (moduleKey: string) => {
    const newSelection = reSelectedModules.includes(moduleKey)
      ? reSelectedModules.filter((k) => k !== moduleKey)
      : [...reSelectedModules, moduleKey];

    setReSelectedModules(newSelection);

    // Persist to database
    if (document?.id) {
      saveReModuleSelection(document.id, newSelection);
    }
  };
    const handleOutputModeChange = (mode: OutputMode) => {
    setOutputMode(mode);
    setSignedUrl(null);
    setDraftPath(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-neutral-300 border-t-neutral-900"></div>
      </div>
    );
  }

  if (errorMsg && !document) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 font-medium mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="bg-white border border-neutral-200 rounded-lg p-6">
            <h1 className="text-lg font-bold text-neutral-900 mb-2">Preview unavailable</h1>
            <p className="text-neutral-700">{errorMsg}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGeneratePdf}
              disabled={isGenerating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'Generating...' : signedUrl ? 'Refresh' : 'Generate PDF'}
            </button>

            {signedUrl && (
              <>
                <button
                  onClick={() => window.open(signedUrl, '_blank')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in New Tab
                </button>

                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-slate-600 text-white rounded-lg font-medium hover:bg-slate-700 transition-colors flex items-center gap-2"
                >
                  <FileDown className="w-4 h-4" />
                  Download
                </button>
              </>
            )}
          </div>
        </div>

        {document && (
          <div className="mb-4">
            <SurveyBadgeRow
              status={document.issue_status as 'draft' | 'in_review' | 'approved' | 'issued'}
              jurisdiction={normalizeJurisdiction(document.jurisdiction)}
              product={document.document_type}
              enabledModules={document.enabled_modules}
            />
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}

        {/* RE Document: Tabs */}
        {isReDocument && (
          <div className="mb-4 bg-white border border-neutral-200 rounded-lg">
            <div className="border-b border-neutral-200">
              <div className="flex">
                <button
                  onClick={() => setReActiveTab('re_survey')}
                  className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                    reActiveTab === 're_survey'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Survey Report
                </button>
                <button
                  onClick={() => setReActiveTab('re_lp')}
                  className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                    reActiveTab === 're_lp'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Loss Prevention Report
                </button>
              </div>
            </div>

            {/* Survey Report: Module Selection */}
            {reActiveTab === 're_survey' && (
              <div className="p-4">
                <h3 className="text-sm font-semibold text-neutral-900 mb-3">Included Modules</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {reAvailableModules.map((module) => {
                    const isSelected = reSelectedModules.includes(module.code);
                    return (
                      <label
                        key={module.code}
                        className="flex items-center gap-2 p-2 rounded hover:bg-neutral-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleModuleToggle(module.code)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-neutral-700">{module.title}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-neutral-600">
                  Selected modules will be included in the Survey Report. Selection is saved automatically.
                </p>
              </div>
            )}

            {/* Loss Prevention Report: No options needed */}
            {reActiveTab === 're_lp' && (
              <div className="p-4">
                <p className="text-sm text-neutral-600">
                  The Loss Prevention Report includes comprehensive analysis and recommendations.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Non-RE Document: Output Mode Selector */}
        {!isReDocument && availableModes.length > 1 && (
          <div className="mb-4 bg-white border border-neutral-200 rounded-lg p-4">
            <label htmlFor="outputMode" className="block text-sm font-semibold text-neutral-900 mb-2">
              Output Mode
            </label>
            <select
              id="outputMode"
              value={outputMode}
                onChange={(e) => handleOutputModeChange(e.target.value as OutputMode)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {availableModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === 'FIRE_EXPLOSION_COMBINED'
                    ? 'Combined Fire + Explosion Report'
                    : mode === 'COMBINED'
                    ? 'Combined FRA + FSD Report'
                    : `${mode} Report Only`}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-neutral-600">
              {outputMode === 'FIRE_EXPLOSION_COMBINED'
                ? 'Viewing combined report with both Fire Risk Assessment and Explosion Risk Assessment sections.'
                : outputMode === 'COMBINED'
                ? 'Viewing combined report with both FRA and FSD sections.'
                : `Viewing ${outputMode} report only.`}
            </p>
          </div>
        )}

        {/* PDF Viewer */}
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden" style={{ height: '80vh' }}>
          {signedUrl ? (
            <iframe
              key={signedUrl}
              title="Document Preview"
              src={signedUrl}
              className="w-full h-full"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-500">
              <div className="text-center">
                <p className="text-lg font-medium mb-2">No PDF generated yet</p>
                <p className="text-sm">Click "Generate PDF" to create a preview</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
