export const SUPPORT_CONFIG = {
  email: 'support@ezirisk.co.uk',
  legalEmail: 'support@ezirisk.co.uk',
  linkLabel: 'Contact Support',
} as const;

export const PUBLIC_LEGAL_DETAILS = {
  operator: 'EziSoft Solutions',
  dataController: 'EziSoft Solutions',
  icoRegistrationNumber: 'ICO:00014056799',
  contactEmail: SUPPORT_CONFIG.email,
  website: 'https://www.ezirisk.co.uk',
  phone: '07766 504361',
  footerStatement: `EziRisk is operated by EziSoft Solutions. ICO registration number: ICO:00014056799. Contact: ${SUPPORT_CONFIG.email}.`,
  operationalNote: 'EziRisk is currently in an early operational rollout phase focused on structured fire and risk reporting workflows across FRA, FSD and DSEAR disciplines.',
} as const;

export function getSupportMailto(email: string = SUPPORT_CONFIG.email): string {
  return `mailto:${email}`;
}

