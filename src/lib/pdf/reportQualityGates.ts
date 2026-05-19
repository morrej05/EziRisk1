/**
 * Report Quality Gates & Validation
 *
 * Validates report completeness and data quality before PDF generation.
 * Detects placeholders, missing IDs, missing outcomes, advisory recommendation depth issues, and other issues.
 */

interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  assessor_notes: string;
  data: Record<string, unknown>;
  completed_at: string | null;
  updated_at: string;
}


interface ActionQualityInput {
  id?: string | null;
  module_instance_id?: string | null;
  reference_number?: string | null;
  recommended_action?: string | null;
  priority?: string | null;
  priority_band?: string | null;
  status?: string | null;
  target_date?: string | null;
  trigger_text?: string | null;
  escalation_justification?: string | null;
  closure_notes?: string | null;
  recommendation_detail?: unknown;
}

export interface QualityIssue {
  type: 'placeholder' | 'missing_action_id' | 'missing_action_text' | 'empty_commentary' | 'missing_outcome' | 'missing_recommendation_rationale' | 'missing_recommendation_observation' | 'missing_recommendation_timeframe' | 'standards_reference_detail' | 'closure_notes_advisory' | 'major_deficiency_without_recommendation';
  severity: 'blocking' | 'warning';
  message: string;
  moduleKey?: string;
  field?: string;
}

export interface QualityGateResult {
  passed: boolean;
  blockingIssues: QualityIssue[];
  warnings: QualityIssue[];
  assuranceGaps: string[]; // Compact 2-item max list for PDF
  advisoryNotes: string[]; // Optional non-blocking quality notes; not used for completeness
}

/**
 * Common placeholder patterns to detect
 */
const PLACEHOLDER_PATTERNS = [
  /\[.*?\]/i, // [placeholder text]
  /\{.*?\}/i, // {placeholder}
  /TODO:/i,
  /TBC/i,
  /TBD/i,
  /PENDING/i,
  /AWAITING/i,
  /INSERT\s/i,
  /PLACEHOLDER/i,
  /XXX/i,
  /N\/A\s*-\s*awaiting/i,
];

/**
 * Check if text contains placeholder patterns
 */
function containsPlaceholder(text: string | null | undefined): boolean {
  if (!text || text.trim().length === 0) return false;

  const normalizedText = text.trim();

  // Check against patterns
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(normalizedText));
}

/**
 * Check if commentary is effectively empty (too short, placeholder, or missing)
 */
function isEmptyCommentary(text: string | null | undefined): boolean {
  if (!text || text.trim().length === 0) return true;

  const trimmed = text.trim();

  // Too short to be meaningful (less than 10 characters)
  if (trimmed.length < 10) return true;

  // Common non-informative phrases
  const nonInformative = [
    /^n\/?a$/i,
    /^none$/i,
    /^nil$/i,
    /^-$/,
    /^\.$/,
    /^ok$/i,
    /^good$/i,
    /^see above$/i,
    /^as above$/i,
    /^tbc$/i,
  ];

  if (nonInformative.some(pattern => pattern.test(trimmed))) {
    return true;
  }

  return false;
}


function getRecommendationDetail(action: ActionQualityInput): Record<string, string> {
  const raw = action?.recommendation_detail;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const detail: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim()) detail[key] = value.trim();
  }
  return detail;
}

function hasMeaningfulText(value: unknown, minLength = 8): boolean {
  return typeof value === 'string' && value.trim().length >= minLength;
}

/**
 * Validate actions for quality issues
 */
function validateActions(actions: ActionQualityInput[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const action of actions) {
    // Check for missing reference IDs (should be auto-generated)
    if (!action.reference_number) {
      issues.push({
        type: 'missing_action_id',
        severity: 'warning',
        message: `Action missing reference number: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }

    // Check for placeholder text in action description
    if (containsPlaceholder(action.recommended_action)) {
      issues.push({
        type: 'placeholder',
        severity: 'blocking',
        message: `Action contains placeholder text: "${action.recommended_action?.substring(0, 50)}"`,
      });
    }

    // Check for empty/minimal action text
    if (!action.recommended_action || action.recommended_action.trim().length < 15) {
      issues.push({
        type: 'missing_action_text',
        severity: 'blocking',
        message: 'Action description is too short or missing',
      });
    }

    const detail = getRecommendationDetail(action);
    const priority = String(action.priority_band || action.priority || '').toUpperCase();
    const hasAnyDetail = Object.keys(detail).length > 0;

    if ((priority === 'P1' || priority === 'P2') && !hasMeaningfulText(detail.rationale) && !hasMeaningfulText(action.escalation_justification)) {
      issues.push({
        type: 'missing_recommendation_rationale',
        severity: 'warning',
        message: `High-priority action lacks recorded rationale: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }

    if (hasAnyDetail && !hasMeaningfulText(detail.observation) && !hasMeaningfulText(action.trigger_text)) {
      issues.push({
        type: 'missing_recommendation_observation',
        severity: 'warning',
        message: `Structured recommendation lacks an observation/finding: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }

    if (!action.target_date && !hasMeaningfulText(detail.timeframe_guidance) && (priority === 'P1' || priority === 'P2' || priority === 'P3')) {
      issues.push({
        type: 'missing_recommendation_timeframe',
        severity: 'warning',
        message: `Recommendation has no target date or timeframe guidance: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }

    if (/\b(bs|pas|en|approved document|regulation|order|guidance|standard)\b/i.test(action.recommended_action || '') && !hasMeaningfulText(detail.standards_reference)) {
      issues.push({
        type: 'standards_reference_detail',
        severity: 'warning',
        message: `Recommendation references standards/guidance but has no structured standards detail: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }

    if (String(action.status || '').toLowerCase() === 'closed' && 'closure_notes' in action && !hasMeaningfulText(action.closure_notes)) {
      issues.push({
        type: 'closure_notes_advisory',
        severity: 'warning',
        message: `Closed action has no closure notes: "${action.recommended_action?.substring(0, 50) || 'Unknown'}"`,
      });
    }
  }

  return issues;
}

/**
 * Validate module instances for quality issues
 */
function validateModules(modules: ModuleInstance[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const module of modules) {
    // Check for missing outcomes in completed modules
    if (module.completed_at && !module.outcome) {
      issues.push({
        type: 'missing_outcome',
        severity: 'warning',
        message: `Module "${module.module_key}" is marked complete but has no outcome`,
        moduleKey: module.module_key,
      });
    }

    // Check assessor notes for placeholders
    if (containsPlaceholder(module.assessor_notes)) {
      issues.push({
        type: 'placeholder',
        severity: 'blocking',
        message: `Module "${module.module_key}" contains placeholder text in assessor notes`,
        moduleKey: module.module_key,
        field: 'assessor_notes',
      });
    }

    // Check data fields for common placeholders
    if (module.data) {
      for (const [key, value] of Object.entries(module.data)) {
        if (typeof value === 'string' && containsPlaceholder(value)) {
          issues.push({
            type: 'placeholder',
            severity: 'blocking',
            message: `Module "${module.module_key}" field "${key}" contains placeholder text`,
            moduleKey: module.module_key,
            field: key,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Generate compact assurance gaps summary (max 2 items for PDF)
 */
function generateAssuranceGaps(issues: QualityIssue[]): string[] {
  const gaps: string[] = [];

  // Count issues by type
  const placeholderCount = issues.filter(i => i.type === 'placeholder').length;
  const missingOutcomeCount = issues.filter(i => i.type === 'missing_outcome').length;
  const missingActionTextCount = issues.filter(i => i.type === 'missing_action_text').length;

  // Generate summary statements (max 2)
  if (placeholderCount > 0) {
    gaps.push(`${placeholderCount} field${placeholderCount > 1 ? 's' : ''} contain placeholder text requiring completion`);
  }

  if (missingActionTextCount > 0 && gaps.length < 2) {
    gaps.push(`${missingActionTextCount} action${missingActionTextCount > 1 ? 's' : ''} missing required description text`);
  }

  if (missingOutcomeCount > 0 && gaps.length < 2) {
    gaps.push(`${missingOutcomeCount} completed module${missingOutcomeCount > 1 ? 's' : ''} missing outcome ratings`);
  }

  return gaps.slice(0, 2); // Strict max 2 items
}

/**
 * Run quality gate validation on report data
 */
export function validateReportQuality(
  modules: ModuleInstance[],
  actions: ActionQualityInput[]
): QualityGateResult {
  const allIssues: QualityIssue[] = [];

  // Validate modules
  allIssues.push(...validateModules(modules));

  // Validate actions
  allIssues.push(...validateActions(actions));

  const actionModuleIds = new Set(actions.map((action) => action.module_instance_id).filter(Boolean));
  for (const module of modules) {
    if (module.outcome === 'material_def' && !actionModuleIds.has(module.id)) {
      allIssues.push({
        type: 'major_deficiency_without_recommendation',
        severity: 'warning',
        message: `Material deficiency module "${module.module_key}" has no linked recommendation/action`,
        moduleKey: module.module_key,
      });
    }
  }

  // Separate blocking vs warnings
  const blockingIssues = allIssues.filter(i => i.severity === 'blocking');
  const warnings = allIssues.filter(i => i.severity === 'warning');

  // Generate assurance gaps for PDF from genuinely required/completion-blocking checks only.
  const assuranceGaps = generateAssuranceGaps([...blockingIssues, ...warnings]);
  const advisoryNotes = modules
    .filter(module => module.completed_at && isEmptyCommentary(module.assessor_notes))
    .map(module => `Module "${module.module_key}" is complete but has minimal/no assessor commentary`);

  return {
    passed: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    assuranceGaps,
    advisoryNotes,
  };
}

/**
 * Standardize outcome language (critical vs governance)
 *
 * Maps raw outcome values to standardized labels for professional reports.
 */
export function standardizeOutcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return 'Not Assessed';

  const n = outcome.toLowerCase().trim();

  if (n === 'na' || n === 'n/a' || n === 'not_applicable' || n === 'not applicable') return 'Not Applicable';
  if (n === 'info_gap' || n === 'information_gap' || n === 'information gap' || n === 'information_incomplete' || n === 'information incomplete') return 'Information Gap';
  if (n === 'not_assessed' || n === 'not assessed') return 'Not Assessed';
  if (n === 'moderate_def' || n === 'moderate deficiency' || n === 'moderate_deficiency') return 'Moderate Deficiency';
  if (
    n === 'material_def' || n === 'significant_def' ||
    n === 'material deficiency' || n === 'significant deficiency' ||
    n === 'material_deficiency' || n === 'significant_deficiency' ||
    n.includes('critical') || n.includes('immediate')
  ) return 'Significant Deficiency';
  if (
    n === 'minor_def' || n === 'minor deficiency' || n === 'minor_deficiency' ||
    n.includes('minor') || n.includes('governance') || n.includes('observation')
  ) return 'Minor Deficiency';
  if (
    n === 'compliant' || n === 'satisfactory' || n === 'adequate' ||
    n.includes('compliant') || n.includes('satisfactory') || n.includes('adequate') || n.includes('partial')
  ) return 'Compliant';

  return outcome
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generate stable action reference ID
 *
 * Format: FRA-DOC-{shortDocId}-{sequenceNumber}
 * Example: FRA-DOC-A3F2-001
 */
export function generateActionReferenceId(
  documentId: string,
  sequenceNumber: number,
  documentType: string = 'FRA'
): string {
  // Take last 4 chars of document ID for uniqueness
  const shortId = documentId.slice(-4).toUpperCase();

  // Zero-pad sequence number to 3 digits
  const paddedSeq = sequenceNumber.toString().padStart(3, '0');

  return `${documentType}-DOC-${shortId}-${paddedSeq}`;
}

/**
 * Check if action owner should be displayed or suppressed
 *
 * Returns null if owner is "(Unassigned)" or similar noise.
 */
export function getDisplayableOwner(owner: string | null | undefined): string | null {
  if (!owner || owner.trim().length === 0) return null;

  const normalized = owner.toLowerCase().trim();

  // Suppress common noise values
  const suppressPatterns = [
    'unassigned',
    'not assigned',
    'n/a',
    'tbc',
    'tbd',
    'pending',
  ];

  if (suppressPatterns.some(pattern => normalized.includes(pattern))) {
    return null;
  }

  return owner;
}
