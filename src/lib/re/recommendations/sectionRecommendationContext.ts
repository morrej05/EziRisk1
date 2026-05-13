export interface BuildRecommendationContextParams {
  documentId: string;
  moduleInstanceId: string;
  moduleKey: string;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
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
  const haystack = [moduleKey, sectionKey, sourceKey, sourceLabel]
    .map(normalise)
    .join(" ");

  if (haystack.includes("fixed_wiring") || haystack.includes("fixed wiring"))
    return "Electrical installation";
  if (haystack.includes("portable") || haystack.includes("pat"))
    return "Electrical safety";
  if (haystack.includes("electrical")) return "Electrical ignition sources";
  if (haystack.includes("hot_work") || haystack.includes("hot work"))
    return "Hot works";
  if (haystack.includes("smoking")) return "Smoking controls";
  if (haystack.includes("cooking")) return "Cooking equipment";
  if (haystack.includes("lightning")) return "Lightning protection";
  if (haystack.includes("emergency")) return "Emergency arrangements";
  if (
    haystack.includes("means_of_escape") ||
    haystack.includes("means of escape") ||
    haystack.includes("evacuation")
  )
    return "Means of escape";
  if (haystack.includes("sprinkler")) return "Sprinklers";
  if (haystack.includes("suppression")) return "Suppression";
  if (
    haystack.includes("alarm") ||
    haystack.includes("detection") ||
    haystack.includes("active_fire") ||
    haystack.includes("active fire")
  )
    return "Detection & alarm";
  if (haystack.includes("fire_stopping") || haystack.includes("fire stopping"))
    return "Fire stopping";
  if (haystack.includes("fire_door") || haystack.includes("fire door"))
    return "Fire doors";
  if (haystack.includes("compartment")) return "Compartmentation";
  if (haystack.includes("passive_fire") || haystack.includes("passive fire"))
    return "Passive fire protection";
  if (
    haystack.includes("firefighting") ||
    haystack.includes("fire fighting") ||
    haystack.includes("extinguisher")
  )
    return "Firefighting equipment";
  if (haystack.includes("external_fire") || haystack.includes("external fire"))
    return "External fire spread";
  if (
    haystack.includes("management") ||
    haystack.includes("procedure") ||
    haystack.includes("management_system")
  )
    return "Management & procedures";
  if (haystack.includes("housekeeping")) return "Housekeeping";
  if (haystack.includes("hazard") || haystack.includes("ignition"))
    return "Hazards & ignition sources";

  return (
    sourceLabel?.trim() ||
    sectionLabelFromKey(sectionKey) ||
    "General risk improvement"
  );
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
}: BuildRecommendationContextParams): RecommendationSectionContext {
  const resolvedSectionLabel =
    sectionLabel?.trim() ||
    sourceLabel?.trim() ||
    sectionLabelFromKey(sectionKey) ||
    moduleKey;
  const resolvedSourceLabel = sourceLabel?.trim() || resolvedSectionLabel;
  const resolvedSectionKey =
    sectionKey?.trim() || slugify(resolvedSectionLabel);
  const resolvedSourceKey = sourceKey?.trim() || resolvedSectionKey;
  const defaultCategory = deriveRecommendationCategory({
    moduleKey,
    sectionKey: resolvedSectionKey,
    sourceKey: resolvedSourceKey,
    sourceLabel: resolvedSourceLabel,
  });
  const displayLabel =
    resolvedSourceLabel === resolvedSectionLabel
      ? resolvedSectionLabel
      : `${resolvedSectionLabel} — ${resolvedSourceLabel}`;

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
    },
  };
}
