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
  phone: '+44 01904 922362',
  footerStatement: `EziRisk is operated by EziSoft Solutions. ICO registration number: ICO:00014056799. Contact: ${SUPPORT_CONFIG.email} or +44 01904 922362.`,
  operationalNote: 'Structured fire and risk reporting workflows for FRA, FSD and DSEAR.',
} as const;

export function getSupportMailto(email: string = SUPPORT_CONFIG.email): string {
  return `mailto:${email}`;
}

