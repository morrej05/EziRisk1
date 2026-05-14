export interface BuildRecommendationContextParams {
  documentId: string;
  moduleInstanceId: string;
  moduleKey: string;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  defaultCategory?: string | null;
  warnOnMissingContext?: boolean;
}

export interface RecommendationSectionContext {
  documentId: string;
  moduleInstanceId: string;
  moduleKey: string;
  sectionKey: string;
  sectionLabel: string;
  sourceKey: string;
  sourceLabel: string;
  displayLabel: string;
  defaultCategory: string;
  hasValidSectionContext: boolean;
  metadata: Record<string, unknown>;
  returnAnchor: string;
  defaultWording: string;
}

const normalise = (value?: string | null): string =>
  (value || "").trim().toLowerCase();

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "section";

const HOUSEKEEPING_PATTERN = /(^|[_\s:-])housekeeping([_\s:-]|$)/;

const SOURCE_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /fixed[_\s:-]*wiring|eicr|electrical[_\s:-]*installation/, category: "Electrical installation" },
  { pattern: /lithium|battery|charging|electrical[_\s:-]*ignition/, category: "Electrical ignition sources" },
  { pattern: /electrical[_\s:-]*safety|electrical[_\s:-]*and[_\s:-]*utilities|electrical/, category: "Electrical ignition sources" },
  { pattern: /portable|pat/, category: "Electrical installation" },
  { pattern: /hot[_\s:-]*work.*(permit|control|procedure)|(?:permit|control|procedure).*hot[_\s:-]*work/, category: "Fire safety management" },
  { pattern: /hot[_\s:-]*work/, category: "Hot works" },
  { pattern: /contractor|permit[_\s:-]*to[_\s:-]*work|maintenance/, category: "Fire safety management" },
  { pattern: /laundry|lint|dryer/, category: "Laundry fire risk" },
  { pattern: /smoking/, category: "Fire safety management" },
  { pattern: /cooking|kitchen|duct/, category: "Commercial kitchen fire risk" },
  { pattern: /lightning/, category: "Lightning protection" },
  { pattern: /means[_\s:-]*of[_\s:-]*escape|evacuation/, category: "Means of escape" },
  { pattern: /sprinkler/, category: "Sprinklers" },
  { pattern: /suppression/, category: "Suppression" },
  { pattern: /alarm|detection|active[_\s:-]*fire/, category: "Detection & alarm" },
  { pattern: /fire[_\s:-]*stopping/, category: "Fire stopping" },
  { pattern: /fire[_\s:-]*door/, category: "Fire doors" },
  { pattern: /compartment/, category: "Compartmentation" },
  { pattern: /passive[_\s:-]*fire/, category: "Passive fire protection" },
  { pattern: /firefighting|fire[_\s:-]*fighting|extinguisher/, category: "Firefighting equipment" },
  { pattern: /external[_\s:-]*fire/, category: "External fire spread" },
  { pattern: /management[_\s:-]*system|procedure|management/, category: "Fire safety management" },
  { pattern: /hazard|ignition/, category: "Electrical ignition sources" },
];

const SECTION_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /electrical[_\s:-]*safety|utilities/, category: "Electrical installation" },
  { pattern: /management/, category: "Fire safety management" },
  { pattern: /hazards|ignition/, category: "Electrical ignition sources" },
  { pattern: /fire[_\s:-]*protection/, category: "Fire protection" },
  { pattern: /natural[_\s:-]*hazards|exposures/, category: "Natural hazards" },
  { pattern: /occupancy/, category: "Occupancy" },
  { pattern: /construction/, category: "Construction" },
];

const MODULE_LABEL_MAP: Record<string, string> = {
  FRA_1_HAZARDS: "Hazards & Ignition Sources",
  FRA_2_ESCAPE_ASIS: "Means of Escape",
  FRA_3_ACTIVE_SYSTEMS: "Fire Detection & Alarm",
  FRA_4_PASSIVE_PROTECTION: "Passive Fire Protection",
  FRA_5_EXTERNAL_FIRE_SPREAD: "External Fire Spread",
  FRA_6_MANAGEMENT_SYSTEMS: "Fire Safety Management",
  FRA_7_EMERGENCY_ARRANGEMENTS: "Emergency Arrangements",
  FRA_8_FIREFIGHTING_EQUIPMENT: "Firefighting Equipment",
};

const MODULE_CATEGORY_MAP: Record<string, string> = {
  RE_02_CONSTRUCTION: "Construction",
  RE_03_OCCUPANCY: "Occupancy",
  RE_06_FIRE_PROTECTION: "Fire protection",
  RE_07_NATURAL_HAZARDS: "Natural hazards",
  RE_08_UTILITIES: "Electrical installation",
  RE_09_MANAGEMENT: "Fire safety management",
  FRA_2_ESCAPE_ASIS: "Means of escape",
  FRA_3_ACTIVE_SYSTEMS: "Detection & alarm",
  FRA_4_PASSIVE_PROTECTION: "Passive fire protection",
  FRA_5_EXTERNAL_FIRE_SPREAD: "External fire spread",
  FRA_6_MANAGEMENT_SYSTEMS: "Fire safety management",
  FRA_7_EMERGENCY_ARRANGEMENTS: "Emergency arrangements",
  FRA_8_FIREFIGHTING_EQUIPMENT: "Firefighting equipment",
  FRA_1_HAZARDS: "Electrical ignition sources",
};

function matchPatternCategory(value: string, patterns: Array<{ pattern: RegExp; category: string }>): string | null {
  const match = patterns.find(({ pattern }) => pattern.test(value));
  return match?.category || null;
}

export function deriveRecommendationCategory({
  moduleKey,
  sectionKey,
  sourceKey,
  sourceLabel,
}: {
  moduleKey?: string | null;
  sectionKey?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
}): string {
  const normalisedSource = [sourceKey, sourceLabel].map(normalise).join(" ");
  const sourceCategory = matchPatternCategory(normalisedSource, SOURCE_CATEGORY_PATTERNS);
  if (sourceCategory) return sourceCategory;
  if (HOUSEKEEPING_PATTERN.test(normalisedSource)) return "Housekeeping";

  const normalisedSection = normalise(sectionKey);
  const sectionCategory = matchPatternCategory(normalisedSection, SECTION_CATEGORY_PATTERNS);
  if (sectionCategory) return sectionCategory;
  if (HOUSEKEEPING_PATTERN.test(normalisedSection)) return "Housekeeping";

  const normalisedModule = normalise(moduleKey).toUpperCase();
  const moduleCategory = moduleKey ? MODULE_CATEGORY_MAP[moduleKey] || MODULE_CATEGORY_MAP[normalisedModule] : null;
  if (moduleCategory) return moduleCategory;
  if (HOUSEKEEPING_PATTERN.test(normalise(moduleKey))) return "Housekeeping";

  return "General fire risk recommendation";
}

function moduleLabelFromKey(moduleKey?: string | null): string | null {
  if (!moduleKey) return null;
  return MODULE_LABEL_MAP[moduleKey] || MODULE_LABEL_MAP[moduleKey.toUpperCase()] || null;
}

function sectionLabelFromKey(sectionKey?: string | null): string | null {
  if (!sectionKey) return null;
  return sectionKey
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function buildRecommendationContext({
  documentId,
  moduleInstanceId,
  moduleKey,
  sectionKey,
  sectionLabel,
  sourceKey,
  sourceLabel,
  defaultCategory: explicitDefaultCategory,
  warnOnMissingContext = false,
}: BuildRecommendationContextParams): RecommendationSectionContext {
  const hasValidSectionContext = Boolean(
    sectionKey?.trim() &&
      sourceKey?.trim() &&
      (sourceLabel?.trim() || sectionLabel?.trim()),
  );

  if (warnOnMissingContext && !hasValidSectionContext && import.meta.env.DEV) {
    console.warn(
      "Recommendation workflow opened without valid section/source context",
      { documentId, moduleInstanceId, moduleKey, sectionKey, sectionLabel, sourceKey, sourceLabel },
    );
  }

  const resolvedSectionLabel =
    sectionLabel?.trim() ||
    sourceLabel?.trim() ||
    sectionLabelFromKey(sectionKey) ||
    moduleLabelFromKey(moduleKey) ||
    moduleKey;
  const assessorSectionLabel = resolvedSectionLabel === moduleKey ? "Assessment area" : resolvedSectionLabel;
  const resolvedSourceLabel = sourceLabel?.trim() || (resolvedSectionLabel === moduleKey ? assessorSectionLabel : resolvedSectionLabel);
  const resolvedSectionKey =
    sectionKey?.trim() || slugify(resolvedSectionLabel);
  const resolvedSourceKey = sourceKey?.trim() || resolvedSectionKey;
  const derivedCategory = deriveRecommendationCategory({
    moduleKey,
    sectionKey: resolvedSectionKey,
    sourceKey: resolvedSourceKey,
    sourceLabel: resolvedSourceLabel,
  });
  const defaultCategory = explicitDefaultCategory?.trim() || derivedCategory;
  const displayLabel =
    resolvedSourceLabel === assessorSectionLabel
      ? assessorSectionLabel
      : `${assessorSectionLabel} — ${resolvedSourceLabel}`;

  return {
    documentId,
    moduleInstanceId,
    moduleKey,
    sectionKey: resolvedSectionKey,
    sectionLabel: resolvedSectionLabel,
    sourceKey: resolvedSourceKey,
    sourceLabel: resolvedSourceLabel,
    displayLabel,
    defaultCategory,
    hasValidSectionContext,
    returnAnchor: `recommendation-${resolvedSectionKey}-${resolvedSourceKey}`,
    defaultWording: `Review and improve ${resolvedSourceLabel.toLowerCase()} controls to address the recorded finding.`,
    metadata: {
      documentId,
      moduleInstanceId,
      moduleKey,
      sectionKey: resolvedSectionKey,
      sectionLabel: resolvedSectionLabel,
      sourceKey: resolvedSourceKey,
      sourceLabel: resolvedSourceLabel,
      defaultCategory,
      hasValidSectionContext,
    },
  };
}
