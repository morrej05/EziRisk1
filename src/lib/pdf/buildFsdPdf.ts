import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import { getModuleName } from '../modules/moduleCatalog';
import { detectInfoGaps } from '../../utils/infoGapQuickActions';
import { fetchAttachmentBytes, listAttachments, type Attachment } from '../supabase/attachments';
import {
  fsdPurposeAndScopeText,
  fsdLimitationsText,
} from '../reportText';
import { normalizeFsdJurisdiction } from '../reportText/fsd/jurisdiction';
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  PAGE_TOP_Y,
  sanitizePdfText,
  wrapText,
  formatDate,
  getOutcomeLabel,
  getPriorityColor,
  addNewPage,
  drawFooter,
  addExecutiveSummaryPages,
  addSupersededWatermark,
  ensurePageSpace,
  getReportFooterTitle,
} from './pdfUtils';
import { addIssuedReportPages } from './issuedPdfPages';
import { computeFsdSummary } from '../fsd/fsdAssuranceEngine';
import { drawSectionHeaderBar, drawOutcomeBadge, drawPageTitle } from './pdfPrimitives';
import { PDF_THEME } from './pdfStyles';
import { compareActionsByDisplayReference } from './actionContracts';
import { deriveFsdProfessionalActionText } from '../fsd/fsdActionWording';

interface Document {
  id: string;
  document_type: string;
  title: string;
  status: string;
  version: number;
  assessment_date: string;
  review_date: string | null;
  assessor_name: string | null;
  assessor_role: string | null;
  responsible_person: string | null;
  scope_description: string | null;
  limitations_assumptions: string | null;
  standards_selected: string[];
  created_at: string;
  updated_at: string;
  executive_summary_ai: string | null;
  executive_summary_author: string | null;
  executive_summary_mode: string | null;
  issue_status: string;
  jurisdiction?: string | null;
}

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, any>;
  completed_at: string | null;
  updated_at: string;
}

interface Action {
  id: string;
  recommended_action: string;
  priority_band: string;
  status: string;
  trigger_id?: string | null;
  trigger_text?: string | null;
  owner_user_id: string | null;
  owner_display_name?: string;
  target_date: string | null;
  module_instance_id: string;
  created_at: string;
  reference_number?: string | null;
  category?: string | null;
}

interface ActionRating {
  action_id: string;
  likelihood: number;
  impact: number;
  score: number;
  rated_at: string;
}

interface Organisation {
  id: string;
  name: string;
  branding_logo_path?: string | null;
}

interface BuildFsdPdfOptions {
  document: Document;
  moduleInstances: ModuleInstance[];
  actions: Action[];
  actionRatings: ActionRating[];
  organisation: Organisation;
  renderMode?: 'preview' | 'issued';
}

const MODULE_ORDER = [
  'A1_DOC_CONTROL',
  'FSD_1_REG_BASIS',
  'FSD_2_EVAC_STRATEGY',
  'A2_BUILDING_PROFILE',
  'A3_PERSONS_AT_RISK',
  'FSD_3_ESCAPE_DESIGN',
  'FSD_4_PASSIVE_PROTECTION',
  'FSD_5_ACTIVE_SYSTEMS',
  'FSD_6_FRS_ACCESS',
  'FSD_7_DRAWINGS',
  'FSD_8_SMOKE_CONTROL',
  'FSD_9_CONSTRUCTION_PHASE',
];

const FSD_ALLOWED_MODULE_KEYS = new Set([
  'A2_BUILDING_PROFILE',
  'A3_PERSONS_AT_RISK',
  ...MODULE_ORDER.filter((key) => key.startsWith('FSD_')),
]);

const MODULE_VALUE_LABELS: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  included: 'Yes',
  other: 'Other / project-specific basis',
  stay_put: 'Stay-put evacuation strategy',
  alarm_only: 'Fire alarm notification only',
  multiple_stairs: 'Multiple stair cores',
  fire_engineered: 'Fire engineered design approach',
  gas: 'Gas suppression',
  bsen12845: 'BS EN 12845',
  bs_en_12845: 'BS EN 12845',
  'bs en 12845': 'BS EN 12845',
};

const MODULE_OUTCOME_SPACING = 30;

const MODULE_DETAIL_LABEL_OVERRIDES: Record<string, string> = {
  'Property protection scope: Yes': 'Property protection considered: Yes',
  'Evacuation lifts: Yes': 'Evacuation lifts provided: Yes',
  'Evacuation lifts: No': 'Evacuation lifts provided: No',
  'Sprinkler provision: Yes': 'Sprinkler protection provided: Yes',
  'Sprinkler provision: No': 'Sprinkler protection provided: No',
  'Other suppression: Gas suppression': 'Other suppression system: Gas suppression',
  'Wet riser: Yes': 'Wet riser provided: Yes',
  'Wet riser: No': 'Wet riser provided: No',
};

function mapModuleValueToLabel(value: string): string {
  const normalizedValue = value.trim();
  const canonicalKey = normalizedValue.toLowerCase();
  return MODULE_VALUE_LABELS[canonicalKey] ?? normalizedValue;
}

function applyModuleDetailLabelOverride(label: string, value: string): string {
  return MODULE_DETAIL_LABEL_OVERRIDES[`${label}: ${value}`] ?? `${label}: ${value}`;
}

function stripModuleCodePrefix(moduleName: string): string {
  return moduleName.replace(/^[A-Z]+-\d+\s*[–-]\s*/u, '').trim();
}

function isEmbeddableImageAttachment(attachment: Attachment): boolean {
  const fileType = attachment.file_type.toLowerCase();
  return fileType === 'image/png' || fileType === 'image/jpg' || fileType === 'image/jpeg';
}
function drawTableOfContents(
  pdfDoc: PDFDocument,
  totalPages: PDFPage[],
  tocPage: PDFPage,
  tocEntries: Array<{ title: string; pageNo: number }>,
  font: any,
  fontBold: any
): void {
  const tocStartY = PAGE_TOP_Y - 40;
  const tocTitleLineHeight = 24;
  const tocTitleSpacingBelow = 20;
  const tocContentGap = 12;
  const contentStartY = tocStartY - tocTitleLineHeight - tocTitleSpacingBelow - tocContentGap;
  const minY = MARGIN + 50;
  const rowHeight = 16;

  const drawTocHeader = (page: PDFPage): number => {
    drawPageTitle(page, MARGIN, tocStartY, 'Contents', { regular: font, bold: fontBold });
    return contentStartY;
  };
  const countNeededTocPages = (): number => {
    let pageCount = 1;
    let yPosition = contentStartY;

    for (let i = 0; i < tocEntries.length; i += 1) {
      if (yPosition < minY) {
        pageCount += 1;
        yPosition = contentStartY;
      }
      yPosition -= rowHeight;
    }

    return pageCount;
  };

  const tocPageCount = countNeededTocPages();
  const extraTocPages = Math.max(0, tocPageCount - 1);

  if (extraTocPages > 0) {
    const tocPageIndex = totalPages.indexOf(tocPage);
    for (let i = 0; i < extraTocPages; i += 1) {
      const inserted = pdfDoc.insertPage(tocPageIndex + 1 + i, [PAGE_WIDTH, PAGE_HEIGHT]);
      totalPages.splice(tocPageIndex + 1 + i, 0, inserted);
    }
  }

  const tocPageIndex = totalPages.indexOf(tocPage);
  const allTocPages = totalPages.slice(tocPageIndex, tocPageIndex + tocPageCount);
  let currentTocPageIndex = 0;
  let activeTocPage = allTocPages[currentTocPageIndex];
  let yPosition = drawTocHeader(activeTocPage);

  for (const entry of tocEntries) {
    if (yPosition < minY) {
      currentTocPageIndex += 1;
      activeTocPage = allTocPages[currentTocPageIndex];
      yPosition = drawTocHeader(activeTocPage);
    }

    const sanitizedTitle = sanitizePdfText(entry.title);
    activeTocPage.drawText(sanitizedTitle, {
      x: MARGIN + 20,
      y: yPosition,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });

    const pageNumText = (entry.pageNo + extraTocPages).toString();
    const pageNumWidth = font.widthOfTextAtSize(pageNumText, 11);
    activeTocPage.drawText(pageNumText, {
      x: PAGE_WIDTH - MARGIN - pageNumWidth,
      y: yPosition,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });

    yPosition -= rowHeight;
  }
}

export async function buildFsdPdf(options: BuildFsdPdfOptions): Promise<Uint8Array> {
  const { document, moduleInstances, actions, organisation, renderMode } = options;
  const jurisdiction = normalizeFsdJurisdiction(document.jurisdiction || (document as any).meta?.jurisdiction || null);

  let attachments: Attachment[] = [];
  try {
    attachments = await listAttachments(document.id);
  } catch (error) {
    console.warn('[FSD PDF] Failed to fetch attachments:', error);
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isIssuedMode = renderMode === 'issued';
  const isDraft = !isIssuedMode;
  const totalPages: PDFPage[] = [];

  const { coverPage, docControlPage } = await addIssuedReportPages({
    pdfDoc,
    document: {
      id: document.id,
      title: document.title,
      document_type: 'FSD',
      version_number: (document as any).version_number || document.version || 1,
      issue_date: (document as any).issue_date || new Date().toISOString(),
      issue_status: isIssuedMode ? 'issued' : 'draft',
      assessor_name: document.assessor_name,
      base_document_id: (document as any).base_document_id,
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      branding_logo_path: organisation.branding_logo_path,
    },
    client: {
      name: (document as any).meta?.client?.name || document.responsible_person || '',
      site: (document as any).meta?.site?.name || document.scope_description || '',
    },
    fonts: { bold: fontBold, regular: font },
  });
  totalPages.push(coverPage, docControlPage);

  const filteredModules = moduleInstances.filter((m) => FSD_ALLOWED_MODULE_KEYS.has(m.module_key));
  const sortedModules = sortModules(filteredModules);
  const computedSummary = computeFsdSummary({ modules: filteredModules });

  const { page: tocPage } = addNewPage(pdfDoc, isDraft, totalPages);
  const tocEntries: Array<{ title: string; pageNo: number }> = [];
  const recordToc = (title: string, pageNo = totalPages.length) => tocEntries.push({ title, pageNo });

  const executiveSummaryMode = (document.executive_summary_mode as 'ai' | 'author' | 'both' | 'none') || 'none';
  const hasExecutiveSummary =
    (executiveSummaryMode === 'ai' || executiveSummaryMode === 'both') && !!document.executive_summary_ai ||
    (executiveSummaryMode === 'author' || executiveSummaryMode === 'both') && !!document.executive_summary_author;

  if (hasExecutiveSummary) {
    const executiveSummaryStartPage = totalPages.length + 1;
    addExecutiveSummaryPages(
      pdfDoc,
      isDraft,
      totalPages,
      executiveSummaryMode,
      document.executive_summary_ai,
      document.executive_summary_author,
      { bold: fontBold, regular: font }
    );
    recordToc('Executive Summary', executiveSummaryStartPage);
  }

  let page: PDFPage;
  let yPosition: number;

  ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
  recordToc('Computed Assurance Summary');
  page = drawComputedAssuranceSummary(page, computedSummary, pdfDoc, isDraft, totalPages, font, fontBold);

  if (computedSummary.deviations.length > 0) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Deviation Register');
    page = drawDeviationRegister(page, computedSummary.deviations, pdfDoc, isDraft, totalPages, font, fontBold);
  }

  if (computedSummary.assuranceFlags.length > 0) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Assurance Checks');
    page = drawAssuranceChecks(page, computedSummary.assuranceFlags, pdfDoc, isDraft, totalPages, font, fontBold);
  }
  ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
  recordToc('Design Assurance Commentary');
  page = drawDesignAssuranceCommentary(page, computedSummary, actions, pdfDoc, isDraft, totalPages, font, fontBold);


  ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
  recordToc('Purpose and Scope');
  page = drawPurposeAndScope(page, jurisdiction, pdfDoc, isDraft, totalPages, font, fontBold);

  if (document.scope_description) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Document Scope');
    page = drawDocumentScope(page, document.scope_description, pdfDoc, isDraft, totalPages, font, fontBold);
  }

  ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
  recordToc('Limitations and Assumptions');
  page = drawFsdLimitations(page, jurisdiction, pdfDoc, isDraft, totalPages, font, fontBold);

  if (document.limitations_assumptions) {
    page = drawDocumentLimitations(page, document.limitations_assumptions, pdfDoc, isDraft, totalPages, font, fontBold);
  }

  if (sortedModules.length > 0) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Module Summaries');
    for (const moduleInstance of sortedModules) {
      ({ page, yPosition } = drawModuleSummary(page, yPosition, moduleInstance, document, pdfDoc, isDraft, totalPages, font, fontBold));
    }
  }

  if (actions.length > 0) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Action Register');
    ({ page, yPosition } = drawActionRegister(page, yPosition, actions, moduleInstances, pdfDoc, isDraft, totalPages, font, fontBold));
  }

  if (attachments.length > 0) {
    ({ page, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
    recordToc('Attachments Index');
    ({ page, yPosition } = drawAttachmentsIndex(page, yPosition, attachments, filteredModules, actions, pdfDoc, isDraft, totalPages, font, fontBold));

    ({ page, yPosition } = await drawAttachmentPages(page, yPosition, attachments, filteredModules, actions, pdfDoc, isDraft, totalPages, font, fontBold));
  }

  drawTableOfContents(pdfDoc, totalPages, tocPage, tocEntries, font, fontBold);

  const footerReportTitle = getReportFooterTitle('FSD', document.title);
  for (let i = 0; i < totalPages.length; i++) {
    drawFooter(totalPages[i], footerReportTitle, i + 1, totalPages.length, font);
  }

  if (document.issue_status === 'superseded') {
    await addSupersededWatermark(pdfDoc);
  }

  return await pdfDoc.save();
}

function sortModules(moduleInstances: ModuleInstance[]): ModuleInstance[] {
  return [...moduleInstances].sort((a, b) => {
    const aIndex = MODULE_ORDER.indexOf(a.module_key);
    const bIndex = MODULE_ORDER.indexOf(b.module_key);

    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;

    return aIndex - bIndex;
  });
}

function drawModuleSummary(
  page: PDFPage,
  startY: number,
  moduleInstance: ModuleInstance,
  document: Document,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): { page: PDFPage; yPosition: number } {
  let currentPage = page;
  let yPosition = startY;

  ({ page: currentPage, yPosition } = ensurePageSpace(90, currentPage, yPosition, pdfDoc, isDraft, totalPages));

  const moduleName = stripModuleCodePrefix(getModuleName(moduleInstance.module_key));
  yPosition = drawSectionHeaderBar({
    page: currentPage,
    x: MARGIN,
    y: yPosition,
    w: CONTENT_WIDTH,
    title: sanitizePdfText(moduleName),
    product: 'fsd',
    fonts: { regular: font, bold: fontBold },
  });

  const outcome = moduleInstance.outcome || 'pending';
  drawOutcomeBadge({
    page: currentPage,
    x: MARGIN,
    y: yPosition,
    outcome: getOutcomeLabel(outcome),
    fonts: { regular: font, bold: fontBold },
  });
  yPosition -= MODULE_OUTCOME_SPACING;

  if (moduleInstance.assessor_notes && moduleInstance.assessor_notes.trim()) {
    ({ page: currentPage, yPosition } = ensurePageSpace(30, currentPage, yPosition, pdfDoc, isDraft, totalPages));
    currentPage.drawText('Assessor Notes:', {
      x: MARGIN,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    yPosition -= 16;

    const notesLines = wrapText(moduleInstance.assessor_notes, CONTENT_WIDTH, 9, font);
    for (const line of notesLines) {
      ({ page: currentPage, yPosition } = ensurePageSpace(14, currentPage, yPosition, pdfDoc, isDraft, totalPages));
      currentPage.drawText(line, {
        x: MARGIN,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      yPosition -= 12;
    }
    yPosition -= 10;
  }

  ({ page: currentPage, yPosition } = drawModuleKeyDetails(currentPage, moduleInstance, yPosition, pdfDoc, isDraft, totalPages, font, fontBold));
  ({ page: currentPage, yPosition } = drawInfoGapQuickActions(currentPage, moduleInstance, document, font, fontBold, yPosition, pdfDoc, isDraft, totalPages));

  yPosition -= 16;
  return { page: currentPage, yPosition };
}

function drawModuleKeyDetails(
  page: PDFPage,
  moduleInstance: ModuleInstance,
  startY: number,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): { page: PDFPage; yPosition: number } {
  let currentPage = page;
  let yPosition = startY;
  const data = moduleInstance.data;

  if (!data || Object.keys(data).length === 0) {
    return { page: currentPage, yPosition };
  }

  ({ page: currentPage, yPosition } = ensurePageSpace(24, currentPage, yPosition, pdfDoc, isDraft, totalPages));
  currentPage.drawText('Key Details:', {
    x: MARGIN,
    y: yPosition,
    size: 10,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  yPosition -= 16;

  type FieldConfig = { label: string; keys: string[] };

  const dataCandidates: Record<string, any>[] = [data];
  for (const key of ['responses', 'answers', 'scoringData', 'fields']) {
    const nested = data?.[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      dataCandidates.push(nested);
    }
  }

  const details: string[] = [];
  const seen = new Set<string>();

  const isValueEmpty = (value: any): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0 || value === 'unknown' || value === 'na';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  };

  const formatValue = (value: any): string | null => {
    if (isValueEmpty(value)) return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
      const items = value
        .map((item) => {
          if (item === null || item === undefined) return null;
           if (typeof item === 'string') return mapModuleValueToLabel(item.trim());
          if (typeof item === 'number') return String(item);
          if (typeof item === 'boolean') return item ? 'Yes' : 'No';
          if (typeof item === 'object') {
            const pairs = Object.entries(item)
              .filter(([, v]) => !isValueEmpty(v))
             .map(([k, v]) => `${k}: ${formatValue(v) ?? String(v)}`);
            return pairs.length > 0 ? pairs.join(', ') : null;
          }
          return null;
        })
        .filter((item): item is string => !!item && item.trim().length > 0);
      return items.length > 0 ? items.join(', ') : null;
    }
    if (typeof value === 'object') {
      const pairs = Object.entries(value)
        .filter(([, v]) => !isValueEmpty(v))
        .map(([k, v]) => `${k}: ${formatValue(v) ?? String(v)}`);
      return pairs.length > 0 ? pairs.join(', ') : null;
    }
    if (typeof value === 'string') return mapModuleValueToLabel(value.trim());
    return String(value);
  };

  const addField = (label: string, keys: string[]) => {
    for (const source of dataCandidates) {
      for (const key of keys) {
        const value = source?.[key];
        const formatted = formatValue(value);
        if (formatted && !seen.has(`${label}:${formatted}`)) {
          details.push(applyModuleDetailLabelOverride(label, formatted));
          seen.add(`${label}:${formatted}`);
          return;
        }
      }
    }
  };

  const addFields = (fields: FieldConfig[]) => {
    for (const field of fields) {
      addField(field.label, field.keys);
    }
  };

  switch (moduleInstance.module_key) {
    case 'A2_BUILDING_PROFILE':
      addFields([
        { label: 'Building name', keys: ['building_name'] },
        { label: 'Height (m)', keys: ['height_m', 'building_height_m'] },
        { label: 'Storeys', keys: ['number_of_storeys'] },
        { label: 'Floor area (sqm)', keys: ['floor_area_sqm', 'total_floor_area_sqm'] },
        { label: 'Primary use', keys: ['building_use_primary', 'primary_use'] },
        { label: 'Secondary uses', keys: ['secondary_uses'] },
        { label: 'Construction frame', keys: ['construction_frame', 'frame_type'] },
      ]);
      break;

    case 'A3_PERSONS_AT_RISK':
      addFields([
        { label: 'Max occupancy', keys: ['max_occupancy'] },
        { label: 'Normal occupancy', keys: ['normal_occupancy'] },
        { label: 'Occupancy profile', keys: ['occupancy_profile'] },
        { label: 'Vulnerable groups', keys: ['vulnerable_groups', 'vulnerable_groups_present'] },
        { label: 'Lone working', keys: ['lone_working'] },
        { label: 'Out-of-hours occupation', keys: ['out_of_hours_occupation'] },
        { label: 'Evacuation assistance required', keys: ['evacuation_assistance_required'] },
      ]);
      break;

    case 'FSD_1_REG_BASIS':
      addFields([
        { label: 'Regulatory framework', keys: ['regulatory_framework', 'regulatory_framework_selected'] },
        { label: 'Design objectives', keys: ['design_objectives'] },
        { label: 'Life safety scope', keys: ['life_safety_scope'] },
        { label: 'Property protection scope', keys: ['property_protection_scope'] },
        { label: 'Control body', keys: ['building_reg_control_body'] },
        { label: 'Standards referenced', keys: ['standards_referenced', 'standards_list'] },
      ]);
      break;

    case 'FSD_2_EVAC_STRATEGY':
      addFields([
        { label: 'Evacuation strategy', keys: ['evacuation_strategy', 'evacuation_strategy_type'] },
        { label: 'Alarm philosophy', keys: ['alarm_philosophy'] },
        { label: 'Management dependencies', keys: ['management_dependencies'] },
        { label: 'Evacuation lifts', keys: ['evacuation_lifts'] },
        { label: 'Refuges provided', keys: ['refuges_provided'] },
        { label: 'Communication method', keys: ['communication_method'] },
      ]);
      break;

    case 'FSD_3_ESCAPE_DESIGN':
      addFields([
        { label: 'Travel distance basis', keys: ['travel_distance_basis'] },
        { label: 'Travel distance limits', keys: ['travel_distance_limits_summary'] },
        { label: 'Exit capacity calculation', keys: ['exit_capacity_calculation_done'] },
        { label: 'Exit widths summary', keys: ['exit_widths_summary'] },
        { label: 'Stairs strategy', keys: ['stairs_strategy'] },
        { label: 'Final exit security strategy', keys: ['final_exit_security_strategy'] },
      ]);
      break;

    case 'FSD_4_PASSIVE_PROTECTION':
      addFields([
        { label: 'Structural fire resistance (mins)', keys: ['structural_fire_resistance_minutes'] },
        { label: 'Compartmentation strategy', keys: ['compartmentation_strategy'] },
        { label: 'Compartmentation standard', keys: ['compartmentation_standard'] },
        { label: 'Fire door ratings', keys: ['fire_door_ratings'] },
        { label: 'Cavity barriers strategy', keys: ['cavity_barriers_strategy'] },
        { label: 'Penetrations fire stopping', keys: ['penetrations_fire_stopping_strategy'] },
      ]);
      break;

    case 'FSD_5_ACTIVE_SYSTEMS':
      addFields([
        { label: 'Detection/alarm category', keys: ['detection_alarm_design_category'] },
        { label: 'Alarm cause/effect summary', keys: ['alarm_cause_and_effect_summary'] },
        { label: 'Emergency lighting principles', keys: ['emergency_lighting_design_principles'] },
        { label: 'Sprinkler provision', keys: ['sprinkler_provision'] },
        { label: 'Sprinkler standard', keys: ['sprinkler_standard'] },
        { label: 'Other suppression', keys: ['suppression_other'] },
        { label: 'Firefighting equipment strategy', keys: ['fire_fighting_equipment_strategy'] },
      ]);
      break;

    case 'FSD_6_FRS_ACCESS':
      addFields([
        { label: 'Appliance access routes', keys: ['appliance_access_routes_summary'] },
        { label: 'Water supplies/hydrants', keys: ['water_supplies_hydrants'] },
        { label: 'Dry riser', keys: ['dry_riser'] },
        { label: 'Wet riser', keys: ['wet_riser'] },
        { label: 'Firefighting shaft', keys: ['firefighting_shaft'] },
        { label: 'Fire service lift', keys: ['fire_service_lift'] },
        { label: 'Fire control point location', keys: ['fire_control_point_location'] },
      ]);
      break;

    case 'FSD_7_DRAWINGS':
      if (data.drawings_checklist || dataCandidates.some((s) => s.drawings_checklist)) {
        const checklist = data.drawings_checklist || dataCandidates.find((s) => s.drawings_checklist)?.drawings_checklist;
        const checked = Object.values(checklist).filter(Boolean).length;
        const total = Object.keys(checklist).length;
        details.push(`Drawings: ${checked}/${total} types provided`);
      }
      addFields([
        { label: 'Drawings uploaded', keys: ['drawings_uploaded'] },
      ]);
      break;

    case 'FSD_8_SMOKE_CONTROL':
      addFields([
        { label: 'Smoke control present', keys: ['smoke_control_present'] },
        { label: 'System type', keys: ['system_type'] },
        { label: 'Coverage areas', keys: ['coverage_areas'] },
        { label: 'Design standard/basis', keys: ['design_standard_or_basis'] },
        { label: 'Activation and controls', keys: ['activation_and_controls'] },
      ]);
      break;

    case 'FSD_9_CONSTRUCTION_PHASE':
      addFields([
        { label: 'Construction phase applicable', keys: ['construction_phase_applicable'] },
        { label: 'Fire plan exists', keys: ['fire_plan_exists'] },
        { label: 'Hot work controls', keys: ['hot_work_controls'] },
        { label: 'Temporary detection/alarm', keys: ['temporary_detection_alarm'] },
        { label: 'Temporary means of escape', keys: ['temporary_means_of_escape'] },
        { label: 'Combustible storage controls', keys: ['combustible_storage_controls'] },
        { label: 'Emergency access maintained', keys: ['emergency_access_maintained'] },
      ]);
      break;
  }

  const detailSources = dataCandidates;
  const structuredNotes = detailSources
    .flatMap((source) => ['notes', 'note', 'comments', 'comment'].map((k) => source?.[k]))
    .map((value) => formatValue(value))
    .filter((value): value is string => !!value);
  if (structuredNotes.length > 0) {
    details.push(`Notes: ${structuredNotes.join(' | ')}`);
  }

  const infoGaps = detailSources
    .flatMap((source) => ['info_gaps', 'information_gaps', 'gaps'].map((k) => source?.[k]))
    .map((value) => formatValue(value))
    .filter((value): value is string => !!value);
  if (infoGaps.length > 0) {
    details.push(`Information gaps: ${infoGaps.join(' | ')}`);
  }

  const warnings = detailSources
    .flatMap((source) => ['warnings', 'warning_flags', 'flags'].map((k) => source?.[k]))
    .map((value) => formatValue(value))
    .filter((value): value is string => !!value);
  if (warnings.length > 0) {
    details.push(`Warnings: ${warnings.join(' | ')}`);
  }

  const deviations = detailSources
    .map((source) => source?.deviations)
    .filter((value) => Array.isArray(value))
    .flatMap((value: any) => value)
    .map((dev: any) => {
      const topic = formatValue(dev?.topic);
      const deviationText = formatValue(dev?.deviation);
      if (!topic && !deviationText) return null;
      return topic && deviationText ? `${topic} - ${deviationText}` : topic || deviationText;
    })
    .filter((value): value is string => !!value);
  if (deviations.length > 0) {
    details.push(`Deviations: ${deviations.join(' | ')}`);
  }

  for (const detail of details) {
    const lines = wrapText(detail, CONTENT_WIDTH - 10, 9, font);
    ({ page: currentPage, yPosition } = ensurePageSpace((lines.length * 12) + 6, currentPage, yPosition, pdfDoc, isDraft, totalPages));
    for (const line of lines) {
      currentPage.drawText(`• ${line}`, {
        x: MARGIN + 10,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      yPosition -= 12;
    }
  }

  return { page: currentPage, yPosition };
}

function drawInfoGapQuickActions(
  page: PDFPage,
  module: ModuleInstance,
  document: Document,
  font: any,
  fontBold: any,
  yPosition: number,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[]
): { page: PDFPage; yPosition: number } {
  let currentPage = page;
  const detection = detectInfoGaps(
    module.module_key,
    module.data,
    module.outcome,
    {
      responsible_person: document.responsible_person || undefined,
      standards_selected: document.standards_selected || []
    }
  );

  if (!detection.hasInfoGap) {
    return { page: currentPage, yPosition };
  }

  ({ page: currentPage, yPosition } = ensurePageSpace(220, currentPage, yPosition, pdfDoc, isDraft, totalPages));

  yPosition -= 20;

  currentPage.drawRectangle({
    x: MARGIN,
    y: yPosition - (detection.reasons.length * 18) - 45,
    width: CONTENT_WIDTH,
    height: (detection.reasons.length * 18) + 55,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 1,
    color: rgb(0.98, 0.98, 0.98),
  });

  yPosition -= 5;

  currentPage.drawText(sanitizePdfText('i'), {
    x: MARGIN + 8,
    y: yPosition,
    size: 11,
    font: fontBold,
    color: rgb(0.5, 0.5, 0.5),
  });

  currentPage.drawText(sanitizePdfText('Assessment notes (incomplete information)'), {
    x: MARGIN + 25,
    y: yPosition,
    size: 11,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  yPosition -= 25;

  if (detection.reasons.length > 0) {
    for (const reason of detection.reasons) {
      if (yPosition < MARGIN + 50) {
        const result = addNewPage(pdfDoc, isDraft, totalPages);
        currentPage = result.page;
        yPosition = PAGE_TOP_Y;
      }

      currentPage.drawText(sanitizePdfText('•'), {
        x: MARGIN + 8,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });

      const reasonLines = wrapText(reason, CONTENT_WIDTH - 30, 9, font);
      for (const line of reasonLines) {
        if (yPosition < MARGIN + 50) {
          const result = addNewPage(pdfDoc, isDraft, totalPages);
          currentPage = result.page;
          yPosition = PAGE_TOP_Y;
        }
        currentPage.drawText(line, {
          x: MARGIN + 18,
          y: yPosition,
          size: 9,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
        yPosition -= 13;
      }
    }
    yPosition -= 10;
  }

  if (detection.quickActions.length > 0) {
    if (yPosition < MARGIN + 100) {
      const result = addNewPage(pdfDoc, isDraft, totalPages);
      currentPage = result.page;
      yPosition = PAGE_TOP_Y;
    }

    currentPage.drawText('Recommended actions:', {
      x: MARGIN + 8,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0.4, 0.4, 0.4),
    });

    yPosition -= 20;

    for (const quickAction of detection.quickActions) {
      if (yPosition < MARGIN + 100) {
        const result = addNewPage(pdfDoc, isDraft, totalPages);
        currentPage = result.page;
        yPosition = PAGE_TOP_Y;
      }

      const priorityColor = quickAction.priority === 'P2' ? PDF_THEME.colours.risk.medium.fg : PDF_THEME.colours.risk.medium.fg;
      currentPage.drawRectangle({
        x: MARGIN + 10,
        y: yPosition - 3,
        width: 25,
        height: 14,
        color: priorityColor,
      });
      currentPage.drawText(quickAction.priority, {
        x: MARGIN + 13,
        y: yPosition,
        size: 8,
        font: fontBold,
        color: rgb(1, 1, 1),
      });

      yPosition -= 18;

      const actionLines = wrapText(quickAction.action, CONTENT_WIDTH - 30, 10, font);
      for (const line of actionLines) {
        if (yPosition < MARGIN + 50) {
          const result = addNewPage(pdfDoc, isDraft, totalPages);
          currentPage = result.page;
          yPosition = PAGE_TOP_Y;
        }
        currentPage.drawText(line, {
          x: MARGIN + 15,
          y: yPosition,
          size: 10,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
        yPosition -= 14;
      }

      const reasonText = `Why: ${quickAction.reason}`;
      const reasonLines = wrapText(reasonText, CONTENT_WIDTH - 30, 9, font);
      for (const line of reasonLines) {
        if (yPosition < MARGIN + 50) {
          const result = addNewPage(pdfDoc, isDraft, totalPages);
          currentPage = result.page;
          yPosition = PAGE_TOP_Y;
        }
        currentPage.drawText(line, {
          x: MARGIN + 15,
          y: yPosition,
          size: 9,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
        yPosition -= 13;
      }

      yPosition -= 10;
    }

    yPosition -= 5;
    const tipText = 'Tip: Address these information gaps to improve assessment completeness and reduce risk uncertainty.';
    const tipLines = wrapText(tipText, CONTENT_WIDTH - 20, 8, font);
    for (const line of tipLines) {
      if (yPosition < MARGIN + 50) {
        const result = addNewPage(pdfDoc, isDraft, totalPages);
        currentPage = result.page;
        yPosition = PAGE_TOP_Y;
      }
      currentPage.drawText(line, {
        x: MARGIN + 10,
        y: yPosition,
        size: 8,
        font,
        color: PDF_THEME.colours.risk.medium.fg,
      });
      yPosition -= 12;
    }
  }

  yPosition -= 15;
  return { page: currentPage, yPosition };
}

function drawActionRegister(
  page: PDFPage,
  startY: number,
  actions: Action[],
  moduleInstances: ModuleInstance[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): { page: PDFPage; yPosition: number } {
  let currentPage = page;
  let yPosition = startY;

  ({ page: currentPage, yPosition } = ensurePageSpace(90, currentPage, yPosition, pdfDoc, isDraft, totalPages));

  currentPage.drawText('Action Register', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  yPosition -= 30;

  const tableX = MARGIN;
  const tableWidth = CONTENT_WIDTH;
  const columnGap = 8;
  const numberColumnWidth = 16;
  const priorityColumnWidth = 56;
  const statusColumnWidth = 62;
  const targetColumnWidth = 58;
  const actionColumnWidth = tableWidth - numberColumnWidth - priorityColumnWidth - statusColumnWidth - targetColumnWidth - (columnGap * 4);
  const rowLineHeight = 9;
  const actionRowTopPadding = 1;
  const minimumRowHeight = 20;
  const headerHeight = 18;
  const tableHeaderY = yPosition;

  const actionColumnX = tableX + numberColumnWidth + columnGap;
  const priorityColumnX = actionColumnX + actionColumnWidth + columnGap;
  const statusColumnX = priorityColumnX + priorityColumnWidth + columnGap;
  const targetColumnX = statusColumnX + statusColumnWidth + columnGap;
  const tableEndX = tableX + tableWidth;

  const drawHeader = (): void => {
    currentPage.drawText('#', { x: tableX, y: tableHeaderY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    currentPage.drawText('Action', { x: actionColumnX, y: tableHeaderY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    currentPage.drawText('Priority', { x: priorityColumnX, y: tableHeaderY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    currentPage.drawText('Status', { x: statusColumnX, y: tableHeaderY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    currentPage.drawText('Target', { x: targetColumnX, y: tableHeaderY, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });

    const headerBottomY = tableHeaderY - headerHeight;
    currentPage.drawLine({
      start: { x: tableX, y: headerBottomY },
      end: { x: tableEndX, y: headerBottomY },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });

    yPosition = headerBottomY - 6;
  };

  drawHeader();

  const sortedActions = [...actions].sort(compareActionsByDisplayReference);
  const moduleById = new Map(moduleInstances.map((module) => [module.id, module]));

  sortedActions.forEach((action, index) => {
    const linkedModule = moduleById.get(action.module_instance_id);
    const actionText = deriveFsdProfessionalActionText({
      recommendedAction: action.recommended_action,
      moduleKey: linkedModule?.module_key,
      moduleTitle: linkedModule ? getModuleName(linkedModule.module_key) : undefined,
      triggerText: action.trigger_text,
      triggerId: action.trigger_id,
      category: action.category,
    });
    const actionLines = wrapText(actionText, actionColumnWidth - 2, 7, font);
    const actionTextHeight = actionLines.length * rowLineHeight;
    const rowHeight = Math.max(minimumRowHeight, actionTextHeight + 4);

    ({ page: currentPage, yPosition } = ensurePageSpace(rowHeight + headerHeight + 8, currentPage, yPosition, pdfDoc, isDraft, totalPages));
    if (yPosition + 2 - rowHeight < MARGIN + 40) {
      ({ page: currentPage, yPosition } = addNewPage(pdfDoc, isDraft, totalPages));
      yPosition = PAGE_TOP_Y;
      drawHeader();
    }

    const rowTopY = yPosition;
    const rowBottomY = yPosition - rowHeight;

    currentPage.drawText(`${index + 1}`, {
      x: tableX,
      y: rowTopY - ((rowHeight - 7) / 2),
      size: 7,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    let actionY = rowTopY - actionRowTopPadding;
    actionLines.forEach((line) => {
      currentPage.drawText(line, {
        x: actionColumnX,
        y: actionY,
        size: 7,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      actionY -= rowLineHeight;
    });

    const priorityBand = action.priority_band?.trim() || '-';
    const priorityColor = getPriorityColor(priorityBand);
    const priorityLabel = sanitizePdfText(priorityBand);
    const priorityBadgePaddingX = 3;
    const priorityBadgeHeight = 8;
    const priorityLabelWidth = fontBold.widthOfTextAtSize(priorityLabel, 7);
    const priorityBadgeWidth = Math.min(priorityColumnWidth - 14, Math.max(18, priorityLabelWidth + (priorityBadgePaddingX * 2)));
    const priorityBadgeY = rowBottomY + ((rowHeight - priorityBadgeHeight) / 2);
    currentPage.drawRectangle({
      x: priorityColumnX,
      y: priorityBadgeY,
      width: priorityBadgeWidth,
      height: priorityBadgeHeight,
      color: priorityColor,
    });
    currentPage.drawText(priorityLabel, {
      x: priorityColumnX + priorityBadgePaddingX,
      y: priorityBadgeY + ((priorityBadgeHeight - 7) / 2) + 0.5,
      size: 7,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    currentPage.drawText(sanitizePdfText(action.status?.trim() || '-'), {
      x: statusColumnX,
      y: rowTopY - ((rowHeight - 7) / 2),
      size: 7,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    const targetDate = action.target_date ? formatDate(action.target_date) : '-';
    currentPage.drawText(targetDate, {
      x: targetColumnX,
      y: rowTopY - ((rowHeight - 7) / 2),
      size: 7,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    for (const separatorX of [actionColumnX - (columnGap / 2), priorityColumnX - (columnGap / 2), statusColumnX - (columnGap / 2), targetColumnX - (columnGap / 2)]) {
      currentPage.drawLine({
        start: { x: separatorX, y: rowTopY + 2 },
        end: { x: separatorX, y: rowBottomY },
        thickness: 0.25,
        color: rgb(0.88, 0.88, 0.88),
      });
    }

    currentPage.drawLine({
      start: { x: tableX, y: rowBottomY },
      end: { x: tableEndX, y: rowBottomY },
      thickness: 0.35,
      color: rgb(0.9, 0.9, 0.9),
    });

    yPosition = rowBottomY - 4;
  });

  return { page: currentPage, yPosition };
}

function drawAttachmentsIndex(
  page: PDFPage,
  startY: number,
  attachments: Attachment[],
  moduleInstances: ModuleInstance[],
  actions: Action[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): { page: PDFPage; yPosition: number } {
  let yPosition = startY;

  page.drawText('ATTACHMENTS & EVIDENCE INDEX', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  if (attachments.length === 0) {
    page.drawText('No attachments recorded.', {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    return { page, yPosition };
  }

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];

    ({ page, yPosition } = ensurePageSpace(110, page, yPosition, pdfDoc, isDraft, totalPages));

    const refNum = `E-${String(i + 1).padStart(3, '0')}`;

    page.drawText(`${refNum} ${sanitizePdfText(attachment.file_name)}`, {
      x: MARGIN,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    yPosition -= 14;

    if (attachment.caption) {
      const captionLines = wrapText(attachment.caption, CONTENT_WIDTH - 20, 9, font);
      for (const line of captionLines) {
        if (yPosition < MARGIN + 50) {
          ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
          yPosition = PAGE_TOP_Y;
        }
        page.drawText(line, {
          x: MARGIN + 10,
          y: yPosition,
          size: 9,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
        yPosition -= 12;
      }
    }

    if (attachment.linked_module_instance_id) {
      const linkedModule = moduleInstances.find((m) => m.id === attachment.linked_module_instance_id);
      if (linkedModule) {
        const moduleName = getModuleName(linkedModule.module_key);
        page.drawText(`Linked to: ${sanitizePdfText(moduleName)}`, {
          x: MARGIN + 10,
          y: yPosition,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        yPosition -= 12;
      }
    }

    if (attachment.linked_action_id) {
      const linkedAction = actions.find((a) => a.id === attachment.linked_action_id);
      if (linkedAction) {
        const actionRef = linkedAction.reference_number || 'Action';
        page.drawText(`Linked to: ${sanitizePdfText(actionRef)}`, {
          x: MARGIN + 10,
          y: yPosition,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        yPosition -= 12;
      }
    }

    yPosition -= 8;

    page.drawLine({
      start: { x: MARGIN, y: yPosition },
      end: { x: PAGE_WIDTH - MARGIN, y: yPosition },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });

    yPosition -= 15;
  }

  return { page, yPosition };
}

async function drawAttachmentPages(
  page: PDFPage,
  startY: number,
  attachments: Attachment[],
  moduleInstances: ModuleInstance[],
  actions: Action[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): Promise<{ page: PDFPage; yPosition: number }> {
  let currentPage = page;
  let yPosition = startY;

  const imageAttachments = attachments.filter(isEmbeddableImageAttachment);

  if (imageAttachments.length === 0) {
    return { page: currentPage, yPosition };
  }

  for (let i = 0; i < imageAttachments.length; i += 1) {
    const attachment = imageAttachments[i];
    ({ page: currentPage } = addNewPage(pdfDoc, isDraft, totalPages));
    yPosition = PAGE_TOP_Y;

    const refNum = `E-${String(i + 1).padStart(3, '0')}`;

    currentPage.drawText('ATTACHMENT EVIDENCE', {
      x: MARGIN,
      y: yPosition,
      size: 14,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    yPosition -= 20;

    currentPage.drawText(`${refNum} ${sanitizePdfText(attachment.file_name)}`, {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    yPosition -= 18;

    if (attachment.caption) {
      const captionLines = wrapText(attachment.caption, CONTENT_WIDTH, 9, font);
      for (const line of captionLines) {
        currentPage.drawText(line, {
          x: MARGIN,
          y: yPosition,
          size: 9,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
        yPosition -= 11;
      }
    }

    if (attachment.linked_module_instance_id) {
      const linkedModule = moduleInstances.find((m) => m.id === attachment.linked_module_instance_id);
      if (linkedModule) {
        const moduleName = stripModuleCodePrefix(getModuleName(linkedModule.module_key));
        currentPage.drawText(`Module: ${sanitizePdfText(moduleName)}`, {
          x: MARGIN,
          y: yPosition,
          size: 8,
          font,
          color: rgb(0.45, 0.45, 0.45),
        });
        yPosition -= 11;
      }
    }

    if (attachment.linked_action_id) {
      const linkedAction = actions.find((a) => a.id === attachment.linked_action_id);
      if (linkedAction?.reference_number) {
        currentPage.drawText(`Action: ${sanitizePdfText(linkedAction.reference_number)}`, {
          x: MARGIN,
          y: yPosition,
          size: 8,
          font,
          color: rgb(0.45, 0.45, 0.45),
        });
        yPosition -= 11;
      }
    }

    yPosition -= 8;

    const bytes = await fetchAttachmentBytes(attachment);
    if (!bytes) {
      currentPage.drawText('Unable to load image.', {
        x: MARGIN,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.65, 0.2, 0.2),
      });
      continue;
    }

    let embeddedImage;
    const fileType = attachment.file_type.toLowerCase();
    if (fileType === 'image/png') {
      embeddedImage = await pdfDoc.embedPng(bytes);
    } else {
      embeddedImage = await pdfDoc.embedJpg(bytes);
    }

    const rawImage = embeddedImage.scale(1);
    const maxWidth = CONTENT_WIDTH;
    const maxHeight = yPosition - MARGIN;
    const scale = Math.min(maxWidth / rawImage.width, maxHeight / rawImage.height, 1);
    const imageWidth = rawImage.width * scale;
    const imageHeight = rawImage.height * scale;

    currentPage.drawImage(embeddedImage, {
      x: MARGIN,
      y: yPosition - imageHeight,
      width: imageWidth,
      height: imageHeight,
    });
  }

  return { page: currentPage, yPosition };
}

function drawPurposeAndScope(
  page: PDFPage,
  jurisdiction: string,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  ({ page, yPosition } = ensurePageSpace(70, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('PURPOSE AND SCOPE', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  const purposeAndScopeText = normalizeNarrativeReportText(fsdPurposeAndScopeText(jurisdiction));
  const paragraphs = purposeAndScopeText.split('\n\n');
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const lines = wrapText(paragraph, CONTENT_WIDTH, 11, font);
    for (const line of lines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN,
        y: yPosition,
        size: 11,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      yPosition -= 16;
    }

    yPosition -= 8;
  }

  return page;
}

function drawFsdLimitations(
  page: PDFPage,
  jurisdiction: string,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  ({ page, yPosition } = ensurePageSpace(70, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('LIMITATIONS AND ASSUMPTIONS', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  const limitationsText = normalizeNarrativeReportText(fsdLimitationsText(jurisdiction));
  const paragraphs = limitationsText.split('\n\n');
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const lines = wrapText(paragraph, CONTENT_WIDTH, 11, font);
    for (const line of lines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN,
        y: yPosition,
        size: 11,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      yPosition -= 16;
    }

    yPosition -= 8;
  }

  return page;
}
function normalizeNarrativeReportText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'function') {
    return normalizeNarrativeReportText(value());
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeNarrativeReportText(entry))
      .filter((entry) => entry.trim().length > 0)
      .join('\n\n');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (typeof record.text === 'string') {
      return record.text;
    }

    if (typeof record.content === 'string') {
      return record.content;
    }

    if (Array.isArray(record.paragraphs)) {
      return normalizeNarrativeReportText(record.paragraphs);
    }

    if (Array.isArray(record.content)) {
      return normalizeNarrativeReportText(record.content);
    }
  }

  return '';
}

function drawDocumentScope(
  page: PDFPage,
  scopeText: string,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  ({ page, yPosition } = ensurePageSpace(70, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('SCOPE', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  const sanitized = sanitizePdfText(scopeText);
  const lines = wrapText(sanitized, CONTENT_WIDTH, 11, font);

  for (const line of lines) {
    if (yPosition < MARGIN + 50) {
      ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
      yPosition = PAGE_TOP_Y;
    }
    page.drawText(line, {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    yPosition -= 16;
  }

  return page;
}

function drawDocumentLimitations(
  page: PDFPage,
  limitationsText: string,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  if (totalPages[totalPages.length - 1] === page) {
    yPosition = PAGE_HEIGHT - MARGIN - 60;
  }

  ({ page, yPosition } = ensurePageSpace(60, page, yPosition, pdfDoc, isDraft, totalPages));
  page.drawText('PROJECT-SPECIFIC LIMITATIONS', {
    x: MARGIN,
    y: yPosition,
    size: 14,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 25;

  const sanitized = sanitizePdfText(limitationsText);
  const lines = wrapText(sanitized, CONTENT_WIDTH, 11, font);

  for (const line of lines) {
    if (yPosition < MARGIN + 50) {
      ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
      yPosition = PAGE_TOP_Y;
    }
    page.drawText(line, {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    yPosition -= 16;
  }

  return page;
}

function drawComputedAssuranceSummary(
  page: PDFPage,
  summary: any,
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;
  const safeString = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : fallback;
    }
    return fallback;
  };

  const mappedLevel = summary?.computedOutcome === 'compliant' ? 'high' :
                      summary?.computedOutcome === 'minor_def' || summary?.computedOutcome === 'info_gap' ? 'medium' :
                      summary?.computedOutcome === 'material_def' ? 'low' :
                      undefined;

  const overallLevel = safeString(summary?.overallLevel, mappedLevel || 'Unknown').toLowerCase();
  const overallLevelLabel = safeString(overallLevel, 'unknown').toUpperCase();
  const levelReason = safeString(summary?.levelReason);
  const deviations = Array.isArray(summary?.deviations) ? summary.deviations : [];
  const infoGaps = Array.isArray(summary?.infoGaps) ? summary.infoGaps : [];

  page.drawText('COMPUTED ASSURANCE SUMMARY', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  page.drawText('Overall Assurance Level:', {
    x: MARGIN,
    y: yPosition,
    size: 12,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 20;

  const levelColor = overallLevel === 'high' ? rgb(0, 0.6, 0) :
                     overallLevel === 'medium' ? rgb(0.8, 0.6, 0) :
    rgb(0.8, 0, 0);

  page.drawText(overallLevelLabel, {
    x: MARGIN + 10,
    y: yPosition,
    size: 14,
    font: fontBold,
    color: levelColor,
  });

  yPosition -= 30;

  if (levelReason) {
    page.drawText('Reason:', {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    yPosition -= 18;

    const reasonLines = wrapText(levelReason, CONTENT_WIDTH - 10, 10, font);
    for (const line of reasonLines) {
      if (yPosition < MARGIN + 50) {
        ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
        yPosition = PAGE_TOP_Y;
      }
      page.drawText(line, {
        x: MARGIN + 10,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      yPosition -= 14;
    }
  }

  yPosition -= 20;

  if (deviations.length > 0) {
    page.drawText('Deviations from Standards:', {
      x: MARGIN,
      y: yPosition,
      size: 12,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yPosition -= 22;

    const displayDeviations = deviations.slice(0, 3);
    for (let i = 0; i < displayDeviations.length; i++) {
      const deviation = displayDeviations[i];

      if (yPosition < MARGIN + 80) {
        ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
        yPosition = PAGE_TOP_Y;
      }

      const deviationText = safeString(deviation?.deviation, 'Not Assessed');
      const truncatedDeviation = deviationText.length > 80
        ? deviationText.substring(0, 77) + '...'
        : deviationText;

      const qualityIndicator = deviation?.score < 4 ? ' [Incomplete justification]' : '';
      page.drawText(`${i + 1}. ${safeString(deviation?.topic, 'Unspecified')}: ${sanitizePdfText(truncatedDeviation)}${qualityIndicator}`, {
        x: MARGIN + 10,
        y: yPosition,
        size: 10,
        font,
        color: deviation?.score < 4 ? PDF_THEME.colours.risk.high.fg : PDF_THEME.colours.text.primary,
      });

      yPosition -= 20;
    }

    if (deviations.length > 3) {
      page.drawText(`... and ${deviations.length - 3} more. See Deviation Register for full details.`, {
        x: MARGIN + 10,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 18;
    }
  }

  yPosition -= 10;

  if (infoGaps.length > 0) {
    ({ page, yPosition } = ensurePageSpace(110, page, yPosition, pdfDoc, isDraft, totalPages));

    page.drawText('Information Gaps:', {
      x: MARGIN,
      y: yPosition,
      size: 12,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yPosition -= 22;

    const displayGaps = infoGaps.slice(0, 5);
    for (const gap of displayGaps) {
      if (yPosition < MARGIN + 60) {
        ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
        yPosition = PAGE_TOP_Y;
      }

      const gapTitle = safeString(gap?.title, 'Unknown');
      const gapText = safeString(gap?.note)
        ? `${gapTitle}: ${sanitizePdfText(safeString(gap.note))}`
        : gapTitle;

      const truncatedGap = gapText.length > 90
        ? gapText.substring(0, 87) + '...'
        : gapText;

      page.drawText(`• ${truncatedGap}`, {
        x: MARGIN + 10,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });

      yPosition -= 18;
    }

    if (infoGaps.length > 5) {
      page.drawText(`... and ${infoGaps.length - 5} more information gaps.`, {
        x: MARGIN + 10,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 18;
    }
  }

  return page;
}

function drawDeviationRegister(
  page: PDFPage,
  deviations: any[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  page.drawText('DEVIATION REGISTER', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  page.drawText('The following deviations from regulatory standards have been identified:', {
    x: MARGIN,
    y: yPosition,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  yPosition -= 25;

  for (let i = 0; i < deviations.length; i++) {
    const deviation = deviations[i];

    if (yPosition < MARGIN + 200) {
      ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
      yPosition = PAGE_TOP_Y;
    }

    yPosition -= 15;

    page.drawText(`Deviation ${i + 1}`, {
      x: MARGIN,
      y: yPosition,
      size: 11,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yPosition -= 20;

    page.drawText('Topic:', {
      x: MARGIN + 10,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPosition -= 15;
    const topicText = sanitizePdfText(deviation.topic || 'Not specified');
    const topicLines = wrapText(topicText, CONTENT_WIDTH - 20, 10, font);
    for (const line of topicLines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN + 20,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      yPosition -= 14;
    }

    yPosition -= 5;
    page.drawText('Deviation:', {
      x: MARGIN + 10,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPosition -= 15;
    const deviationText = sanitizePdfText(deviation.deviation || 'Not specified');
    const deviationLines = wrapText(deviationText, CONTENT_WIDTH - 20, 10, font);
    for (const line of deviationLines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN + 20,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      yPosition -= 14;
    }

    yPosition -= 5;
    page.drawText('Justification:', {
      x: MARGIN + 10,
      y: yPosition,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    yPosition -= 15;
    if (deviation.justification && deviation.justification.trim().length > 0) {
      const justificationText = sanitizePdfText(deviation.justification);
      const justificationLines = wrapText(justificationText, CONTENT_WIDTH - 20, 10, font);
      for (const line of justificationLines) {
        if (yPosition < MARGIN + 50) {
          ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
          yPosition = PAGE_TOP_Y;
        }
        page.drawText(line, {
          x: MARGIN + 20,
          y: yPosition,
          size: 10,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        yPosition -= 14;
      }
    } else {
      page.drawText('No justification provided', {
        x: MARGIN + 20,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.6, 0, 0),
      });
      yPosition -= 14;
    }

    yPosition -= 15;

    page.drawLine({
      start: { x: MARGIN, y: yPosition },
      end: { x: PAGE_WIDTH - MARGIN, y: yPosition },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });

    yPosition -= 10;
  }

  return page;
}

function drawAssuranceChecks(
  page: PDFPage,
  flags: any[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  page.drawText('ASSURANCE CHECKS', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  page.drawText('The following quality assurance checks have been flagged:', {
    x: MARGIN,
    y: yPosition,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  yPosition -= 25;

  for (const flag of flags) {
    if (yPosition < MARGIN + 120) {
      ({ page } = addNewPage(pdfDoc, isDraft, totalPages));
      yPosition = PAGE_TOP_Y;
    }

    const severityColor = flag.severity === 'critical' ? rgb(0.8, 0, 0) :
                          flag.severity === 'high' ? rgb(0.9, 0.4, 0) :
                          flag.severity === 'medium' ? rgb(0.8, 0.6, 0) :
                          rgb(0.5, 0.5, 0.5);

    page.drawRectangle({
      x: MARGIN,
      y: yPosition - 3,
      width: 50,
      height: 14,
      color: severityColor,
    });

    page.drawText(flag.severity.toUpperCase(), {
      x: MARGIN + 5,
      y: yPosition,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText(flag.id, {
      x: MARGIN + 60,
      y: yPosition,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    yPosition -= 18;

    page.drawText('Detail:', {
      x: MARGIN + 10,
      y: yPosition,
      size: 9,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });

    yPosition -= 14;

    const detailText = sanitizePdfText(flag.detail);
    const detailLines = wrapText(detailText, CONTENT_WIDTH - 30, 9, font);
    for (const line of detailLines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN + 20,
        y: yPosition,
        size: 9,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      yPosition -= 13;
    }

    yPosition -= 10;
  }

  return page;
}
function drawDesignAssuranceCommentary(
  page: PDFPage,
  summary: any,
  actions: Action[],
  moduleInstances: ModuleInstance[],
  pdfDoc: PDFDocument,
  isDraft: boolean,
  totalPages: PDFPage[],
  font: any,
  fontBold: any
): PDFPage {
  let yPosition = PAGE_TOP_Y;

  const assuranceLevel = summary?.computedOutcome === 'compliant' ? 'high' :
    summary?.computedOutcome === 'minor_def' || summary?.computedOutcome === 'info_gap' ? 'medium' :
      summary?.computedOutcome === 'material_def' ? 'low' : 'medium';
  const deviationCount = Array.isArray(summary?.deviations) ? summary.deviations.length : 0;
  const infoGapCount = Array.isArray(summary?.infoGaps) ? summary.infoGaps.length : 0;
  const assuranceFlags = Array.isArray(summary?.assuranceFlags) ? summary.assuranceFlags : [];
  const criticalFlagCount = assuranceFlags.filter((flag: any) => flag.severity === 'critical').length;
  const highFlagCount = assuranceFlags.filter((flag: any) => flag.severity === 'high').length;
  const openActionCount = actions.filter((action) => !['closed', 'complete', 'completed', 'resolved'].includes((action.status || '').toLowerCase())).length;

  const levelSentence = assuranceLevel === 'low'
    ? 'Overall assurance is currently LOW, indicating material residual risk within the presented fire strategy evidence base.'
    : assuranceLevel === 'medium'
      ? 'Overall assurance is currently MEDIUM, indicating the strategy direction is credible but requires targeted improvement and closure of outstanding matters.'
      : 'Overall assurance is currently HIGH, indicating the strategy broadly aligns with the stated design basis and applicable guidance subject to routine close-out actions.';

  const strengthsSentence = assuranceLevel === 'low'
    ? 'The assessment still demonstrates a structured design approach across core modules, which provides a foundation for remediation and re-validation.'
    : assuranceLevel === 'medium'
      ? 'The assessment demonstrates a coherent design approach with many core components addressed and a workable basis for compliance refinement.'
      : 'The assessment demonstrates a coherent and coordinated design approach, with key strategy modules generally addressed to a strong assurance standard.';

  const riskSentence = assuranceLevel === 'low'
    ? `Key uncertainties remain elevated, including ${deviationCount} recorded deviation${deviationCount === 1 ? '' : 's'}, ${infoGapCount} information gap${infoGapCount === 1 ? '' : 's'}, and ${criticalFlagCount + highFlagCount} high-severity assurance check${criticalFlagCount + highFlagCount === 1 ? '' : 's'} that require prompt technical resolution.`
    : assuranceLevel === 'medium'
      ? `Residual uncertainty is driven by ${deviationCount} deviation${deviationCount === 1 ? '' : 's'}, ${infoGapCount} information gap${infoGapCount === 1 ? '' : 's'}, and ${criticalFlagCount + highFlagCount} high-severity assurance check${criticalFlagCount + highFlagCount === 1 ? '' : 's'}; these should be addressed before final acceptance.`
      : `Remaining uncertainty is limited but not absent, with ${deviationCount} deviation${deviationCount === 1 ? '' : 's'}, ${infoGapCount} information gap${infoGapCount === 1 ? '' : 's'}, and ${criticalFlagCount + highFlagCount} high-severity assurance check${criticalFlagCount + highFlagCount === 1 ? '' : 's'} requiring managed closure.`;

  const acceptabilitySentence = assuranceLevel === 'low'
    ? `On the current evidence, the strategy should not be treated as fully acceptable until critical issues are resolved and the ${openActionCount} open action${openActionCount === 1 ? '' : 's'} are demonstrably progressed.`
    : assuranceLevel === 'medium'
      ? `The strategy may be considered conditionally acceptable, subject to timely completion of ${openActionCount} open action${openActionCount === 1 ? '' : 's'} and verification of outstanding evidence.`
      : `The strategy is acceptable in principle, subject to normal governance and completion of ${openActionCount} open action${openActionCount === 1 ? '' : 's'} to formally close residual matters.`;

  const paragraphs = [levelSentence, strengthsSentence, riskSentence, acceptabilitySentence];

  page.drawText('DESIGN ASSURANCE COMMENTARY', {
    x: MARGIN,
    y: yPosition,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  for (const paragraph of paragraphs) {
    const lines = wrapText(sanitizePdfText(paragraph), CONTENT_WIDTH, 10, font);
    for (const line of lines) {
      ({ page, yPosition } = ensurePageSpace(18, page, yPosition, pdfDoc, isDraft, totalPages));
      page.drawText(line, {
        x: MARGIN,
        y: yPosition,
        size: 10,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      yPosition -= 14;
    }
    yPosition -= 10;
  }

  return page;
}
