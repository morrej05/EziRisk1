export const SUPPORT_CONFIG = {
  email: 'support@ezirisk.co.uk',
  legalEmail: 'support@ezirisk.co.uk',
  linkLabel: 'Contact Support',
} as const;

export function getSupportMailto(email: string = SUPPORT_CONFIG.email): string {
  return `mailto:${email}`;
}

