import { getModuleDisplayLabel, getModuleName, MODULE_CATALOG } from './moduleCatalog';

export interface ModuleInstance {
  id: string;
  module_key: string;
  outcome: string | null;
  completed_at: string | null;
  [key: string]: unknown;
}

export interface ModuleSection {
  key: string;
  label: string;
  modules: ModuleInstance[];
}

const CORE_MODULE_KEYS = new Set(['A1_DOC_CONTROL', 'A2_BUILDING_PROFILE', 'A3_PERSONS_AT_RISK']);
const FRA_ADDITIONAL_A_KEYS = new Set(['A4_MANAGEMENT_CONTROLS', 'A5_EMERGENCY_ARRANGEMENTS']);

const FRA_PREMIUM_ORDER = [
  'FRA_1_HAZARDS',
  'FRA_2_ESCAPE_ASIS',
  'FRA_3_ACTIVE_SYSTEMS',
  'FRA_4_PASSIVE_PROTECTION',
  'FRA_8_FIREFIGHTING_EQUIPMENT',
  'FRA_5_EXTERNAL_FIRE_SPREAD',
  'FRA_6_MANAGEMENT_SYSTEMS',
  'FRA_7_EMERGENCY_ARRANGEMENTS',
  'FRA_90_SIGNIFICANT_FINDINGS',
];

const RE_BADGE_OVERRIDE: Record<string, string> = {
  'RE_06_FIRE_PROTECTION': 'RE-04',
  'RE_07_NATURAL_HAZARDS': 'RE-05',
  'RE_08_UTILITIES': 'RE-06',
  'RE_09_MANAGEMENT': 'RE-07',
  'RE_12_LOSS_VALUES': 'RE-08',
  'RE_13_RECOMMENDATIONS': 'RE-09',
  'RE_10_SITE_PHOTOS': 'RE-10',
};

export function getModuleCode(moduleKey: string): string {
  if (moduleKey === 'RISK_ENGINEERING') return 'RE-00';

  if (RE_BADGE_OVERRIDE[moduleKey]) {
    return RE_BADGE_OVERRIDE[moduleKey];
  }

  const moduleCode = getModuleName(moduleKey).split(' ')[0];
  return moduleCode.replace(/[–-]$/, '');
}

export function getModuleDisplayName(moduleKey: string): string {
  return getModuleDisplayLabel(moduleKey);
}

export function isDerivedModule(moduleKey: string): boolean {
  return MODULE_CATALOG[moduleKey]?.type === 'derived';
}

function getModuleOrder(moduleKey: string): number {
  return MODULE_CATALOG[moduleKey]?.order ?? 999;
}

function sortByOrder(items: ModuleInstance[]): ModuleInstance[] {
  return [...items].sort((a, b) => getModuleOrder(a.module_key) - getModuleOrder(b.module_key));
}

function sortFraModules(fraModules: ModuleInstance[]): ModuleInstance[] {
  const orderMap = new Map(FRA_PREMIUM_ORDER.map((key, idx) => [key, idx]));

  return [...fraModules].sort((a, b) => {
    const orderA = orderMap.get(a.module_key) ?? 999;
    const orderB = orderMap.get(b.module_key) ?? 999;
    return orderA - orderB;
  });
}

function filterFraModules(fraModules: ModuleInstance[]): ModuleInstance[] {
  const moduleKeys = new Set(fraModules.map(m => m.module_key));
  const hasNewSplitModules =
    moduleKeys.has('FRA_3_ACTIVE_SYSTEMS') ||
    moduleKeys.has('FRA_4_PASSIVE_PROTECTION') ||
    moduleKeys.has('FRA_8_FIREFIGHTING_EQUIPMENT');

  if (hasNewSplitModules) {
    return fraModules.filter(m => m.module_key !== 'FRA_3_PROTECTION_ASIS');
  }

  return fraModules;
}

export function buildModuleSections(modules: ModuleInstance[]): ModuleSection[] {
  const fraModulesRaw = modules.filter((m) =>
    (m.module_key.startsWith('FRA_') || FRA_ADDITIONAL_A_KEYS.has(m.module_key))
    && m.module_key !== 'A7_REVIEW_ASSURANCE'
  );
  const fraModulesFiltered = filterFraModules(fraModulesRaw);
  const fraModulesSorted = sortFraModules(fraModulesFiltered);

  const sections: ModuleSection[] = [
    {
      key: 'site_setup',
      label: 'Site setup',
      modules: sortByOrder(modules.filter((m) => CORE_MODULE_KEYS.has(m.module_key))),
    },
    {
      key: 'site_walk_hazards',
      label: 'Site walk & hazards',
      modules: sortByOrder(modules.filter((m) =>
        ['FRA_1_HAZARDS', 'DSEAR_1_DANGEROUS_SUBSTANCES', 'DSEAR_2_PROCESS_RELEASES', 'DSEAR_4_IGNITION_SOURCES', 'RE_10_SITE_PHOTOS'].includes(m.module_key)
      )),
    },
    {
      key: 'technical_assessment',
      label: 'Technical assessment',
      modules: sortByOrder([
        ...fraModulesSorted.filter((m) => !['FRA_1_HAZARDS', 'FRA_90_SIGNIFICANT_FINDINGS'].includes(m.module_key)),
        ...modules.filter((m) => m.module_key.startsWith('FSD_')),
        ...modules.filter((m) => m.module_key.startsWith('DSEAR_') && !['DSEAR_1_DANGEROUS_SUBSTANCES', 'DSEAR_2_PROCESS_RELEASES', 'DSEAR_4_IGNITION_SOURCES'].includes(m.module_key)),
        ...modules.filter((m) => (m.module_key.startsWith('RE_') || m.module_key === 'RISK_ENGINEERING') && !['RE_10_SITE_PHOTOS', 'RE_13_RECOMMENDATIONS'].includes(m.module_key)),
      ]),
    },
    {
      key: 'findings_actions',
      label: 'Findings & actions',
      modules: sortByOrder(modules.filter((m) => ['FRA_90_SIGNIFICANT_FINDINGS', 'RE_13_RECOMMENDATIONS'].includes(m.module_key))),
    },
    {
      key: 'review_issue',
      label: 'Review & issue',
      modules: sortByOrder(modules.filter((m) => m.module_key === 'A7_REVIEW_ASSURANCE')),
    },
    {
      key: 'other',
      label: 'Additional',
      modules: sortByOrder(modules.filter((m) => {
        const key = m.module_key;
        return !CORE_MODULE_KEYS.has(key)
          && !FRA_ADDITIONAL_A_KEYS.has(key)
          && !key.startsWith('FRA_')
          && !key.startsWith('FSD_')
          && !key.startsWith('DSEAR_')
          && !key.startsWith('RE_')
          && key !== 'A7_REVIEW_ASSURANCE'
          && key !== 'RISK_ENGINEERING';
      })),
    },
  ].filter((section) => section.modules.length > 0);

  return sections;
}
