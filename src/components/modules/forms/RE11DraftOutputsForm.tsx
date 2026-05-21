import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { sanitizeModuleInstancePayload } from '../../../utils/modulePayloadSanitizer';
import { FileText, RefreshCw, AlertCircle, AlertTriangle, Lock } from 'lucide-react';
import { getModuleDisplayLabel } from '../../../lib/modules/moduleCatalog';
import OutcomePanel from '../OutcomePanel';
import ModuleActions from '../ModuleActions';
import FloatingSaveBar from './FloatingSaveBar';
import AutoExpandTextarea from '../../AutoExpandTextarea';
import { isReDocumentLocked } from '../../../lib/re/documentLock';

interface Document {
  id: string;
  title: string;
  issue_status?: 'draft' | 'issued' | 'superseded';
}

interface ModuleInstance {
  id: string;
  document_id: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
}

interface RE11DraftOutputsFormProps {
  moduleInstance: ModuleInstance;
  document: Document;
  onSaved: () => void;
}

interface SurveySection {
  heading: string;
  content: string;
  source_module?: string;
}

interface Recommendation {
  id: string;
  rec_number: string;
  title: string;
  observation_text: string;
  action_required_text: string;
  priority: string;
  target_date: string;
  owner: string;
  status: string;
  source_module_key: string;
  photos?: Array<{ path: string }>;
}

export default function RE11DraftOutputsForm({
  moduleInstance,
  document,
  onSaved,
}: RE11DraftOutputsFormProps) {
  const isLocked = isReDocumentLocked(document.issue_status);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'survey' | 'loss_prevention'>('survey');
  const [populateError, setPopulateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const d = moduleInstance.data || {};

  const defaultSurveySections: SurveySection[] = [
    { heading: 'Introduction', content: '' },
    { heading: 'Construction', content: '', source_module: 'RE_02_CONSTRUCTION' },
    { heading: 'Occupancy & Hazards', content: '', source_module: 'RE_03_OCCUPANCY' },
    { heading: 'Fire Protection Systems', content: '', source_module: 'RE_06_FIRE_PROTECTION' },
    { heading: 'Utilities & Services', content: '', source_module: 'RE_08_UTILITIES' },
    { heading: 'Loss Values', content: '', source_module: 'RE_12_LOSS_VALUES' },
    { heading: 'Conclusion', content: '' },
  ];

  const safeSurveySections = Array.isArray(d.draft_survey_report?.sections)
    ? d.draft_survey_report.sections
    : defaultSurveySections;

  const [surveySections, setSurveySections] = useState<SurveySection[]>(safeSurveySections);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [lossPrevIntro, setLossPrevIntro] = useState(
    d.draft_loss_prevention_report?.introduction || ''
  );

  const [outcome, setOutcome] = useState(moduleInstance.outcome || '');
  const [assessorNotes, setAssessorNotes] = useState(moduleInstance.assessor_notes || '');

  useEffect(() => {
    loadRecommendations();
    if (surveySections.every((s) => !s.content)) {
      autoPopulateSurveyReport();
    }
  }, []);

  const loadRecommendations = async () => {
    try {
      const { data, error } = await supabase
        .from('re_recommendations')
        .select('id, rec_number, title, observation_text, action_required_text, priority, target_date, owner, status, source_module_key, photos')
        .eq('document_id', moduleInstance.document_id)
        .eq('is_suppressed', false)
        .order('rec_number', { ascending: true });

      if (error) throw error;
      setRecommendations(data || []);
    } catch (err) {
      console.error('Error loading recommendations:', err);
    }
  };

  const autoPopulateSurveyReport = async () => {
    if (isLocked) return;
    setLoading(true);
    try {
      const { data: modules, error } = await supabase
        .from('module_instances')
        .select('module_key, data')
        .eq('document_id', moduleInstance.document_id);

      if (error) throw error;

      const updatedSections = surveySections.map((section) => {
        if (!section.source_module) return section;

        const sourceModule = modules.find((m) => m.module_key === section.source_module);
        if (!sourceModule) return section;

        let generatedContent = '';

        switch (section.source_module) {
          case 'RE_02_CONSTRUCTION':
            generatedContent = generateConstructionContent(sourceModule.data);
            break;
          case 'RE_03_OCCUPANCY':
            generatedContent = generateOccupancyContent(sourceModule.data);
            break;
          case 'RE_06_FIRE_PROTECTION':
            generatedContent = generateFireProtectionContent(sourceModule.data);
            break;
          case 'RE_08_UTILITIES':
            generatedContent = generateUtilitiesContent(sourceModule.data);
            break;
          case 'RE_12_LOSS_VALUES':
            generatedContent = generateLossValuesContent(sourceModule.data);
            break;
        }

        return { ...section, content: generatedContent };
      });

      setSurveySections(updatedSections);
    } catch (err) {
      console.error('Error auto-populating survey:', err);
      setPopulateError('Failed to refresh report content from modules. Check that assessment modules have been completed and try again.');
    } finally {
      setLoading(false);
    }
  };

  const generateConstructionContent = (data: any): string => {
    const construction = data?.construction;
    if (!construction) return '';

    const buildings = (construction.buildings || []) as any[];
    if (buildings.length === 0) return '';

    const FRAME_LABELS: Record<string, string> = {
      steel: 'steel framing',
      protected_steel: 'fire-protected steel framing',
      reinforced_concrete: 'reinforced concrete framing',
      timber: 'timber framing',
      masonry: 'masonry construction',
      mixed: 'mixed structural framing',
      unknown: 'structural framing (type not confirmed)',
    };

    const COMPARTMENTATION_LABELS: Record<number, string> = {
      0: 'no compartmentation (open plan)',
      60: 'basic compartmentation (≤60 minutes)',
      120: 'standard compartmentation (90–120 minutes)',
      180: 'enhanced compartmentation (180 minutes)',
      240: 'high-integrity compartmentation (≥4 hours)',
    };

    const numWord = (n: number): string => {
      const words = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
      return n >= 0 && n < words.length ? words[n] : String(n);
    };

    const buildingCount = buildings.length;
    const intro = buildingCount === 1
      ? 'The site comprises a single structure.'
      : `The site comprises ${numWord(buildingCount)} structures.`;

    const paragraphs: string[] = [intro];

    buildings.forEach((b: any, idx: number) => {
      const name = b.building_name || b.ref || `Building ${idx + 1}`;
      const floors = b.geometry?.floors ?? b.storeys ?? null;
      const basements = b.geometry?.basements ?? b.basements ?? null;
      const heightM = b.geometry?.height_m ?? null;
      const roofAreaM2 = b.roof_area_m2 ?? null;
      const mezzAreaM2 = b.mezzanine_area_m2 ?? null;
      const frameType: string = b.frame_type || 'unknown';
      const claddingPresent = b.combustible_cladding?.present === true;
      const claddingDetails: string = b.combustible_cladding?.details || '';
      const combustiblePct: number | null = b.calculated?.combustible_percent ?? null;
      const compartmentationMin: number | null = b.compartmentation_minutes ?? null;

      const parts: string[] = [];

      // Geometry sentence
      const geomParts: string[] = [];
      if (floors !== null && floors > 0) {
        geomParts.push(`${numWord(floors)}-storey`);
      } else if (floors === 1 || floors === null) {
        geomParts.push('single-storey');
      }
      if (heightM && heightM > 0) geomParts.push(`with an eaves height of ${heightM}m`);
      if (roofAreaM2 && roofAreaM2 > 0) geomParts.push(`and a total roof area of ${roofAreaM2.toLocaleString()}m²`);
      if (geomParts.length) parts.push(`${name} is a ${geomParts.join(' ')} structure.`);

      // Frame
      if (frameType !== 'unknown') {
        parts.push(`The primary structural frame is ${FRAME_LABELS[frameType] || frameType}.`);
      }

      // Mezzanine
      if (mezzAreaM2 && mezzAreaM2 > 0) {
        parts.push(`Mezzanine or upper-floor area totals ${mezzAreaM2.toLocaleString()}m².`);
      }

      // Basements
      if (basements && basements < 0) {
        parts.push(`The building includes ${Math.abs(basements)} basement level${Math.abs(basements) !== 1 ? 's' : ''}.`);
      }

      // Combustibility
      if (combustiblePct !== null && !isNaN(combustiblePct)) {
        if (combustiblePct >= 50) {
          parts.push(`Construction materials are predominantly combustible, with approximately ${combustiblePct}% of assessed surface area carrying combustible loading.`);
        } else if (combustiblePct >= 20) {
          parts.push(`Construction materials are of mixed combustibility, with approximately ${combustiblePct}% of assessed surface area carrying combustible loading.`);
        } else if (combustiblePct > 0) {
          parts.push(`The majority of construction materials are non-combustible; approximately ${combustiblePct}% of assessed surface area carries combustible loading.`);
        } else {
          parts.push('Construction materials are predominantly non-combustible.');
        }
      }

      // Cladding
      if (claddingPresent) {
        parts.push(`Combustible cladding has been identified${claddingDetails ? ` (${claddingDetails})` : ''}, which may present a significant fire spread risk.`);
      }

      // Compartmentation
      if (compartmentationMin !== null) {
        const compLabel = COMPARTMENTATION_LABELS[compartmentationMin] || `${compartmentationMin}-minute compartmentation`;
        parts.push(`The building is assessed as having ${compLabel}.`);
      }

      if (parts.length > 0) {
        paragraphs.push(parts.join(' '));
      }
    });

    // Site summary
    const siteCombustible = construction.site_combustible_percent ?? null;
    const siteScore = construction.completion?.site_score ?? null;
    if (siteCombustible !== null || siteScore !== null) {
      const summaryParts: string[] = [];
      if (siteScore !== null) summaryParts.push(`The overall site construction risk score is ${Number(siteScore).toFixed(1)}/5`);
      if (siteCombustible !== null) summaryParts.push(`with an average site combustibility of approximately ${siteCombustible}%`);
      if (summaryParts.length) paragraphs.push(summaryParts.join(', ') + '.');
    }

    if (construction.site_notes?.trim()) {
      paragraphs.push(construction.site_notes.trim());
    }

    return paragraphs.join('\n\n');
  };

  const generateOccupancyContent = (data: any): string => {
    const occ = data?.occupancy;
    const processOverview = occ?.process_overview || occ?.site_process_overview || '';
    const specialHazards = occ?.industry_special_hazards_notes || occ?.special_hazards_notes || '';

    const parts: string[] = [];

    if (processOverview?.trim()) {
      parts.push(processOverview.trim());
    }
    if (specialHazards?.trim()) {
      parts.push(specialHazards.trim());
    }

    const hazardList = Array.isArray(occ?.hazards) ? occ.hazards : [];
    const significantHazards = hazardList.filter((h: any) => h?.description?.trim());
    if (significantHazards.length > 0) {
      const hazardSummary = significantHazards
        .map((h: any) => h.type ? `${h.type}: ${h.description}` : h.description)
        .join('; ');
      parts.push(`The following occupancy-specific hazards were identified: ${hazardSummary}.`);
    }

    return parts.length > 0
      ? parts.join('\n\n')
      : '[Occupancy details to be completed by the assessor based on site observations.]';
  };

  const generateFireProtectionContent = (data: any): string => {
    const fp = data?.fire_protection;
    if (!fp) return '';

    const buildingEntries = Object.values(fp.buildings || {}) as any[];
    const supplementary = fp.supplementary_assessment || {};
    const overallScore: number | null = supplementary.overall_score ?? null;
    const paragraphs: string[] = [];

    if (buildingEntries.length > 0) {
      const totalBuildings = buildingEntries.length;
      const sprinkleredBuildings = buildingEntries.filter(
        (b: any) => b?.sprinklerData?.sprinklers_installed === 'Yes'
      ).length;
      const detectedBuildings = buildingEntries.filter(
        (b: any) => b?.sprinklerData?.detection_installed === 'Yes'
      ).length;

      const allDetectionTypes = new Set<string>();
      buildingEntries.forEach((b: any) => {
        (b?.sprinklerData?.detection_types || []).forEach((t: string) => {
          if (t) allDetectionTypes.add(t);
        });
      });

      const localisedRequired = buildingEntries.filter(
        (b: any) => b?.sprinklerData?.localised_required === 'Yes'
      ).length;
      const localisedPresent = buildingEntries.filter(
        (b: any) => b?.sprinklerData?.localised_present === 'Yes'
      ).length;

      // Suppression coverage
      if (sprinkleredBuildings === totalBuildings) {
        paragraphs.push(
          'Automatic sprinkler protection is installed throughout all assessed structures.'
        );
      } else if (sprinkleredBuildings > 0) {
        const unprotected = totalBuildings - sprinkleredBuildings;
        paragraphs.push(
          `Sprinkler protection is installed in ${sprinkleredBuildings} of ${totalBuildings} structures; ` +
          `the remaining ${unprotected} structure${unprotected !== 1 ? 's' : ''} rel${unprotected !== 1 ? 'y' : 'ies'} on portable suppression means only.`
        );
      } else {
        paragraphs.push(
          'No automatic sprinkler protection has been installed. ' +
          'Suppression capability relies on portable fire extinguishers and manual brigade response.'
        );
      }

      // Detection coverage
      const detTypes = Array.from(allDetectionTypes).filter(Boolean);
      if (detectedBuildings > 0) {
        const coverage =
          detectedBuildings === totalBuildings
            ? 'throughout all structures'
            : `in ${detectedBuildings} of ${totalBuildings} structures`;
        const typeStr =
          detTypes.length > 0
            ? ` Systems include ${detTypes.join(', ').toLowerCase()}.`
            : '';
        paragraphs.push(`Automatic fire detection is installed ${coverage}.${typeStr}`);
      } else {
        paragraphs.push(
          'Automatic fire detection coverage has not been confirmed for the assessed structures.'
        );
      }

      // Localised protection
      if (localisedRequired > 0) {
        if (localisedPresent >= localisedRequired) {
          paragraphs.push(
            'Localised fire protection provisions are in place for identified process or equipment hazards.'
          );
        } else {
          const gap = localisedRequired - localisedPresent;
          paragraphs.push(
            `Localised fire protection is required for identified process hazards but has not been fully installed; ` +
            `${gap} area${gap !== 1 ? 's' : ''} remain unprotected.`
          );
        }
      }
    }

    // Site water supply
    const waterScore: number | null = fp.site?.water_score_1_5 ?? null;
    if (waterScore !== null) {
      const waterDesc =
        waterScore >= 4
          ? 'adequate for the assessed risk'
          : waterScore >= 3
          ? 'generally adequate, with some limitations noted'
          : waterScore >= 2
          ? 'limited and may not fully meet demand requirements under a major loss scenario'
          : 'inadequate for the assessed risk profile';
      paragraphs.push(
        `The site water supply for fire-fighting purposes is assessed as ${waterDesc}.`
      );
    }

    // Overall fire protection assessment
    if (overallScore !== null) {
      const overallDesc =
        overallScore >= 4
          ? 'well-suited to the assessed risk profile'
          : overallScore >= 3
          ? 'broadly adequate for the assessed risk profile'
          : overallScore >= 2
          ? 'requiring enhancement in a number of areas'
          : 'presenting material weaknesses requiring prompt attention';
      paragraphs.push(
        `Overall, the site fire protection arrangements are assessed as ${overallDesc} ` +
        `(fire protection score: ${Number(overallScore).toFixed(1)}/5).`
      );
    }

    // Site-level assessor comments
    const siteComments = fp.site?.comments?.trim?.();
    if (siteComments) paragraphs.push(siteComments);

    return paragraphs.length > 0
      ? paragraphs.join('\n\n')
      : '[Fire protection details to be completed by the assessor based on site observations.]';
  };

  const generateUtilitiesContent = (data: any): string => {
    const powerResilience = data?.power_resilience;
    const criticalServices: any[] = Array.isArray(data?.critical_services)
      ? data.critical_services
      : [];
    const criticalEquipment: any[] = Array.isArray(data?.critical_equipment)
      ? data.critical_equipment
      : [];

    const paragraphs: string[] = [];

    // Power resilience
    if (powerResilience) {
      const backupPresent = powerResilience.backup_power_present;
      const backupStr =
        backupPresent === true
          ? 'Backup power generation is available at the site.'
          : backupPresent === false
          ? 'No backup power generation is installed; the site is reliant on mains supply continuity.'
          : '';
      const powerNotes = powerResilience.notes?.trim?.() || '';
      const generatorNotes = powerResilience.generator_capacity_notes?.trim?.() || '';
      const powerParts = [backupStr, generatorNotes, powerNotes].filter(Boolean);
      if (powerParts.length) paragraphs.push(powerParts.join(' '));
    }

    // Critical services
    const serviceLabel = (s: any) =>
      s.service_type === 'custom'
        ? s.custom_label || 'custom service'
        : s.service_type || 'service';

    const presentServices = criticalServices.filter(
      (s: any) => s?.present === true || s?.present === 'Yes'
    );
    const absentServices = criticalServices.filter(
      (s: any) => s?.present === false || s?.present === 'No'
    );

    if (presentServices.length > 0) {
      const highCriticality = presentServices.filter(
        (s: any) => s.criticality === 'High' || s.criticality === 'Critical'
      );
      let servicePara = `The following utility services are present at the site: ${presentServices.map(serviceLabel).join(', ')}.`;
      if (highCriticality.length > 0) {
        servicePara +=
          ` ${highCriticality.map(serviceLabel).join(', ')} ${highCriticality.length !== 1 ? 'are' : 'is'} assessed as high-criticality.`;
      }
      const withoutBackup = presentServices.filter(
        (s: any) => s.backup_available === false || s.backup_available === 'No'
      );
      if (withoutBackup.length > 0) {
        servicePara += ` No backup provision is available for ${withoutBackup.map(serviceLabel).join(', ')}.`;
      }
      paragraphs.push(servicePara);
    }
    if (absentServices.length > 0) {
      paragraphs.push(
        `The following utility services are not present at the site: ${absentServices.map(serviceLabel).join(', ')}.`
      );
    }

    // Critical equipment
    if (criticalEquipment.length > 0) {
      const equipLabel = (e: any) => {
        const base =
          e.equipment_type === 'custom'
            ? e.custom_label || 'equipment'
            : e.equipment_type || 'equipment';
        return e.tag_or_name ? `${base} (${e.tag_or_name})` : base;
      };
      const highCritEquip = criticalEquipment.filter(
        (e: any) => e?.criticality === 'High' || e?.criticality === 'Critical'
      );
      if (highCritEquip.length > 0) {
        paragraphs.push(
          `${highCritEquip.length} high-criticality equipment item${highCritEquip.length !== 1 ? 's' : ''} identified: ` +
          `${highCritEquip.map(equipLabel).join(', ')}.`
        );
      } else {
        paragraphs.push(
          `${criticalEquipment.length} critical equipment item${criticalEquipment.length !== 1 ? 's' : ''} assessed.`
        );
      }
      const noRedundancy = criticalEquipment.filter(
        (e: any) => e?.redundancy === 'None' || e?.redundancy === 'No'
      );
      if (noRedundancy.length > 0) {
        paragraphs.push(
          `${noRedundancy.length} item${noRedundancy.length !== 1 ? 's have' : ' has'} no redundancy provision: ` +
          `${noRedundancy.map(equipLabel).join(', ')}.`
        );
      }
    }

    return paragraphs.length > 0
      ? paragraphs.join('\n\n')
      : '[Utilities and services details to be completed by the assessor based on site observations.]';
  };

  const generateLossValuesContent = (data: any): string => {
    const lv = data?.loss_values;
    if (!lv) return 'No loss values data available.';

    const currency = lv.currency || 'GBP';
    const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$' };
    const symbol = symbols[currency] || '';

    let content = `Currency: ${currency}\n\n`;

    if (lv.property_sums_insured?.total) {
      content += `Property Sums Insured: ${symbol}${lv.property_sums_insured.total.toLocaleString()}\n`;
    }

    if (lv.business_interruption?.gross_profit) {
      content += `Business Interruption Gross Profit: ${symbol}${lv.business_interruption.gross_profit.toLocaleString()} (${lv.business_interruption.indemnity_period_months || 0} months)\n`;
    }

    content += `\nWorst-Case Loss Expectancy (WLE):\n`;
    content += `${lv.wle?.scenario_description || 'No scenario described'}\n`;
    if (lv.wle?.total_wle) {
      content += `Total WLE: ${symbol}${lv.wle.total_wle.toLocaleString()}\n`;
    }

    content += `\nNormal Loss Expectancy (NLE):\n`;
    content += `${lv.nle?.scenario_description || 'No scenario described'}\n`;
    if (lv.nle?.total_nle) {
      content += `Total NLE: ${symbol}${lv.nle.total_nle.toLocaleString()}\n`;
    }

    if (lv.wle?.total_wle && lv.nle?.total_nle) {
      const ratio = Math.round((lv.nle.total_nle / lv.wle.total_wle) * 100);
      content += `NLE as % of WLE: ${ratio}%`;
    }

    return content;
  };

  const updateSectionContent = (heading: string, content: string) => {
    setSurveySections(
      surveySections.map((s) => (s.heading === heading ? { ...s, content } : s))
    );
  };

  const groupRecommendationsByPriorityAndSection = () => {
    const grouped: Record<string, Record<string, Recommendation[]>> = {
      High: {},
      Medium: {},
      Low: {},
    };

    recommendations.forEach((rec) => {
      const priority = rec.priority || 'Medium';
      const section = rec.source_module_key
        ? (getModuleDisplayLabel(rec.source_module_key) || 'Other')
        : 'Other';

      if (!grouped[priority][section]) {
        grouped[priority][section] = [];
      }

      grouped[priority][section].push(rec);
    });

    return grouped;
  };

  const handleSave = async () => {
    if (isLocked) return;
    setIsSaving(true);
    try {
      const completedAt = outcome ? new Date().toISOString() : null;
      const sanitized = sanitizeModuleInstancePayload({
        data: {
          draft_survey_report: { sections: surveySections },
          draft_loss_prevention_report: {
            introduction: lossPrevIntro,
            grouped_recommendations: groupRecommendationsByPriorityAndSection(),
          },
        },
      });

      const { error } = await supabase
        .from('module_instances')
        .update({
          data: sanitized.data,
          outcome: outcome || null,
          assessor_notes: assessorNotes,
          completed_at: completedAt,
        })
        .eq('id', moduleInstance.id);

      if (error) throw error;
      setSaveError(null);
      onSaved();
    } catch (error) {
      console.error('Error saving module:', error);
      setSaveError('Failed to save. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const groupedRecs = groupRecommendationsByPriorityAndSection();

  return (
    <>
    <div className="p-6 max-w-5xl mx-auto pb-24">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">RE-11 – Draft Outputs</h2>
        <p className="text-slate-600">
          Draft reports auto-populated from assessment data with manual editing capability
        </p>
      </div>

      {/* Locked banner */}
      {isLocked && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
          <Lock className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-900">
            Issued document — draft outputs are read-only. No changes can be saved.
          </p>
        </div>
      )}

      <div className="mb-6">
        <div className="border-b border-slate-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('survey')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'survey'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4 inline mr-2" />
              Draft Survey Report
            </button>
            <button
              onClick={() => setActiveTab('loss_prevention')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'loss_prevention'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4 inline mr-2" />
              Draft Loss Prevention Report
            </button>
          </nav>
        </div>
      </div>

      {activeTab === 'survey' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-semibold mb-1">Draft Survey Report</p>
                  <p className="text-blue-800">
                    Structured sections auto-populated from assessment modules. Edit content as
                    needed before finalizing.
                  </p>
                </div>
              </div>
              <button
                onClick={autoPopulateSurveyReport}
                disabled={loading || isLocked}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Loading...' : 'Refresh from Modules'}
              </button>
            </div>
          </div>

          {populateError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-amber-900">
                <p className="font-semibold mb-1">Auto-population failed</p>
                <p>{populateError}</p>
              </div>
              <button
                onClick={() => setPopulateError(null)}
                className="text-amber-600 hover:text-amber-800 text-xs shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {surveySections.map((section) => (
            <div key={section.heading} className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                {section.heading}
              </h3>
              <AutoExpandTextarea
                value={section.content}
                onChange={(e) => updateSectionContent(section.heading, e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm min-h-[120px]"
                placeholder={`Enter content for ${section.heading}...`}
              />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'loss_prevention' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-semibold mb-1">Draft Loss Prevention Report</p>
                <p className="text-blue-800">
                  Recommendation-driven report grouped by priority and section. Based on
                  recommendations from RE-09.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Introduction</h3>
            <AutoExpandTextarea
              value={lossPrevIntro}
              onChange={(e) => setLossPrevIntro(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm min-h-[120px]"
              placeholder="Enter introduction for the loss prevention report..."
            />
          </div>

          {recommendations.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <p className="text-amber-900 font-medium">No recommendations available</p>
              <p className="text-amber-700 text-sm mt-1">
                Complete RE-09 Recommendations module first to populate this report.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {['High', 'Medium', 'Low'].map((priority) => {
                const sections = groupedRecs[priority];
                const sectionKeys = Object.keys(sections);
                if (sectionKeys.length === 0) return null;

                return (
                  <div key={priority} className="bg-white rounded-lg border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">
                      {priority} Priority Recommendations
                    </h3>
                    <div className="space-y-4">
                      {sectionKeys.map((section) => {
                        const recs = sections[section];
                        return (
                          <div key={section} className="border-l-4 border-slate-300 pl-4">
                            <h4 className="font-semibold text-slate-700 mb-2">{section}</h4>
                            <ul className="space-y-3">
                              {recs.map((rec) => (
                                <li key={rec.id} className="text-sm text-slate-600">
                                  <div className="font-medium text-slate-900">
                                    {rec.rec_number && (
                                      <span className="inline-block text-blue-700 font-semibold mr-2">
                                        {rec.rec_number}
                                      </span>
                                    )}
                                    {rec.title}
                                  </div>
                                  {rec.observation_text && (
                                    <div className="mt-1">{rec.observation_text}</div>
                                  )}
                                  {rec.action_required_text && (
                                    <div className="mt-1 text-slate-700">{rec.action_required_text}</div>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                    <span>
                                      Target:{' '}
                                      {rec.target_date
                                        ? new Date(rec.target_date).toLocaleDateString('en-GB', {
                                            day: 'numeric',
                                            month: 'long',
                                            year: 'numeric',
                                          })
                                        : 'Not set'}
                                    </span>
                                    <span>Owner: {rec.owner || 'Unassigned'}</span>
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium ${
                                        rec.status === 'Completed'
                                          ? 'bg-green-100 text-green-700'
                                          : rec.status === 'In Progress'
                                          ? 'bg-amber-100 text-amber-700'
                                          : 'bg-red-100 text-red-700'
                                      }`}
                                    >
                                      {rec.status}
                                    </span>
                                    {(rec.photos?.length ?? 0) > 0 && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                                        📷 {rec.photos!.length} photo{rec.photos!.length !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {saveError && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-red-900">
            <p className="font-semibold mb-1">Save failed</p>
            <p>{saveError}</p>
          </div>
          <button
            onClick={() => setSaveError(null)}
            className="text-red-600 hover:text-red-800 text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <OutcomePanel
        outcome={outcome}
        assessorNotes={assessorNotes}
        onOutcomeChange={setOutcome}
        onNotesChange={setAssessorNotes}
        onSave={handleSave}
        isSaving={isSaving}
      />

      {document?.id && moduleInstance?.id && moduleInstance.module_key !== 'RISK_ENGINEERING' && (
        <ModuleActions documentId={document.id} moduleInstanceId={moduleInstance.id} />
      )}
    </div>

      {!isLocked && <FloatingSaveBar onSave={handleSave} isSaving={isSaving} />}
    </>
  );
}
