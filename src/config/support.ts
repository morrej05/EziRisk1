export const SUPPORT_CONFIG = {
  email: 'support@ezirisk.com',
  legalEmail: 'legal@ezirisk.com',
  linkLabel: 'Contact Support',
} as const;

export function getSupportMailto(email: string = SUPPORT_CONFIG.email): string {
  return `mailto:${email}`;
}

