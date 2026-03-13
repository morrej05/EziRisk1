const KNOWN_LABELS: Record<string, string> = {
  'unassigned module': 'Unassigned Module',
};

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function formatPortfolioGroupLabel(value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'Unassigned';

  const lower = trimmed.toLowerCase();
  if (KNOWN_LABELS[lower]) {
    return KNOWN_LABELS[lower];
  }

  if (/^[A-Z]+\d+(?:\s*-\s*.+)?$/.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(normalized);
}

export function formatPortfolioStatusLabel(value: string): string {
  return formatPortfolioGroupLabel(value);
}
