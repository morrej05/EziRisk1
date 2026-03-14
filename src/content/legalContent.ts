export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocumentContent {
  title: string;
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
}

export const privacyPolicyContent: LegalDocumentContent = {
  title: 'Privacy Policy',
  lastUpdated: 'Last updated: [Month Day, Year]',
  intro: [
    'This Privacy Policy explains how EziRisk (the “platform”) collects, uses, stores, and protects personal data when people use EziRisk.',
    'EziRisk is operated by the operator of EziRisk. Where this policy refers to “we”, “us”, or “our”, it means EziRisk and the operator of EziRisk.',
  ],
  sections: [
    {
      heading: '1. Scope',
      paragraphs: [
        'This policy applies to public visitors, organisation account holders, invited users, and consultants using EziRisk.',
      ],
    },
    {
      heading: '2. Data we collect',
      bullets: [
        'Account and profile details (for example, name, email address, role, and organisation membership).',
        'Organisation data required to operate shared organisation-based accounts.',
        'Assessment, survey, and report content entered by users and consultants.',
        'Operational and technical usage data (for example, logs, browser/device metadata, and timestamps).',
        'Billing and subscription metadata where relevant (payment processing is handled by payment providers).',
      ],
    },
    {
      heading: '3. How we use data',
      bullets: [
        'Provide and maintain EziRisk platform functionality.',
        'Support organisation-level collaboration and account administration.',
        'Generate report outputs and workflow records requested by users.',
        'Improve reliability, security, and product performance.',
        'Communicate important service, legal, or policy updates.',
      ],
    },
    {
      heading: '4. Legal basis and responsibility',
      paragraphs: [
        'We process personal data where necessary for service delivery, legitimate platform operations, contractual commitments, and legal obligations.',
        'Organisation administrators are responsible for ensuring their teams and consultants use EziRisk in accordance with applicable law and internal policy.',
      ],
    },
    {
      heading: '5. Data sharing',
      paragraphs: [
        'We do not sell personal data. Data is shared only where needed to deliver the service, operate infrastructure, process payments, comply with law, or protect the rights, safety, and security of EziRisk and its users.',
      ],
    },
    {
      heading: '6. Security and retention',
      paragraphs: [
        'We apply reasonable technical and organisational controls to protect data, including access controls and secure hosted infrastructure.',
        'Data is retained for as long as needed for service operation, legal requirements, and legitimate business records, then removed or anonymised where appropriate.',
      ],
    },
    {
      heading: '7. Account deletion and organisation closure',
      paragraphs: [
        'Users can request account deletion and organisation administrators can request organisation closure using the available support and closure workflows.',
        'Where deletion or closure is completed, data handling will follow legal, contractual, and operational retention requirements.',
      ],
    },
    {
      heading: '8. Your rights and contact',
      paragraphs: [
        'Depending on your jurisdiction, you may have rights to access, correct, export, or erase your personal data, and to object to or restrict certain processing.',
        'For privacy requests, contact the operator of EziRisk through the platform support channel.',
      ],
    },
  ],
};

export const termsOfUseContent: LegalDocumentContent = {
  title: 'Terms of Use',
  lastUpdated: 'Last updated: [Month Day, Year]',
  intro: [
    'These Terms of Use govern access to and use of EziRisk.',
    'By accessing or using EziRisk, you agree to these terms on behalf of yourself and, where applicable, your organisation.',
  ],
  sections: [
    {
      heading: '1. Platform role',
      paragraphs: [
        'EziRisk provides digital tools for assessment capture, workflow management, and report generation support. EziRisk does not provide legal, engineering, safety, or other professional advice.',
      ],
    },
    {
      heading: '2. Account model',
      bullets: [
        'Accounts are organisation-based and may include administrators, consultants, and other authorised users.',
        'Organisations are responsible for access control, user permissions, and content created under their account.',
      ],
    },
    {
      heading: '3. User responsibilities',
      bullets: [
        'Keep credentials secure and use EziRisk lawfully.',
        'Ensure assessment and report content is accurate, evidence-based, and professionally reviewed before issue or reliance.',
        'Comply with all applicable legal and regulatory requirements.',
      ],
    },
    {
      heading: '4. Disclaimer and professional judgement',
      paragraphs: [
        'Generated outputs are support material only. Final professional judgement, validation, and sign-off remain with the responsible consultant, competent person, and/or organisation issuing the report.',
      ],
    },
    {
      heading: '5. Availability and changes',
      paragraphs: [
        'We may update, improve, or discontinue features from time to time. We aim to maintain reliable service but do not guarantee uninterrupted availability.',
      ],
    },
    {
      heading: '6. Intellectual property',
      paragraphs: [
        'EziRisk branding, software, and platform materials are owned by or licensed to the operator of EziRisk. Your organisation retains rights in content you upload, subject to the permissions needed for service operation.',
      ],
    },
    {
      heading: '7. Suspension and termination',
      paragraphs: [
        'We may suspend or terminate access where needed for security, legal compliance, non-payment, misuse, or material breach of these terms.',
      ],
    },
    {
      heading: '8. Limitation',
      paragraphs: [
        'To the maximum extent permitted by law, EziRisk is provided “as is” and liability is limited to foreseeable direct losses arising from proven breach. EziRisk is not responsible for indirect, consequential, or reliance losses arising from unreviewed or misapplied outputs.',
      ],
    },
  ],
};

export const professionalLiabilityDisclaimerContent: LegalDocumentContent = {
  title: 'Professional Liability Disclaimer',
  lastUpdated: 'Last updated: [Month Day, Year]',
  intro: [
    'EziRisk provides report generation support tools. It does not replace professional expertise, legal duties, or site-specific judgement.',
  ],
  sections: [
    {
      heading: 'Key disclaimer statements',
      bullets: [
        'By using EziRisk, you acknowledge that professional judgement remains your responsibility.',
        'Generated outputs are support tools requiring competent review before issue or reliance.',
        'You must validate reports against site evidence, legal obligations, applicable standards, and your organisation requirements.',
        'EziRisk does not provide professional advice and does not accept responsibility for decisions made without suitable professional review.',
      ],
    },
    {
      heading: 'Consistency with in-app acceptance',
      paragraphs: [
        'This public page is intended to align with the mandatory in-app disclaimer acceptance flow used before dashboard access.',
      ],
    },
  ],
};

export const securityTrustContent: LegalDocumentContent = {
  title: 'Security & Trust',
  lastUpdated: 'Last updated: [Month Day, Year]',
  intro: [
    'EziRisk is designed with practical safeguards to help organisations and consultants use the platform with confidence.',
  ],
  sections: [
    {
      heading: '1. Platform security approach',
      bullets: [
        'Role-based access controls for organisation users.',
        'Authenticated access to protected app data and workflows.',
        'Use of managed cloud infrastructure and encryption in transit.',
        'Operational monitoring and error handling to maintain service integrity.',
      ],
    },
    {
      heading: '2. Data governance',
      bullets: [
        'Organisation data is logically scoped to authorised users and roles.',
        'We maintain controls to support secure storage, access management, and traceability of key actions.',
      ],
    },
    {
      heading: '3. User and organisation responsibilities',
      bullets: [
        'Maintain strong passwords and account hygiene.',
        'Limit access to authorised personnel and remove access promptly when roles change.',
        'Review generated outputs and approvals in line with professional and internal governance requirements.',
      ],
    },
    {
      heading: '4. Continuous improvement',
      paragraphs: [
        'Security and trust controls are reviewed and improved over time as EziRisk evolves and operational requirements mature.',
      ],
    },
  ],
};
