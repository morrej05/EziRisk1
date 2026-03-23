export const DEFAULT_LOGO = '/ezirisk-logo-primary.svg';

export function resolveLogoUrl(preferred?: string | null): string {
  const normalized = preferred?.trim();
  return normalized || DEFAULT_LOGO;
}
