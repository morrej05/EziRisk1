import { getModuleDisplayLabel } from '../lib/modules/moduleCatalog';

export type ReadinessState = 'ready' | 'needs_review' | 'blocked';

export interface IssueReadinessItem {
  key: string;
  label: string;
  detail: string;
  state: ReadinessState;
}

export interface IssueValidatorResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

const MODULE_MESSAGE_PATTERN = /\bmodule\s+([A-Z0-9_]+)/i;

export function readinessStateLabel(state: ReadinessState): string {
  if (state === 'blocked') return 'Blocked';
  if (state === 'needs_review') return 'Needs review';
  return 'Ready';
}

export function getValidatorBlockerItems(validation: IssueValidatorResult | null): IssueReadinessItem[] {
  if (!validation || validation.valid) return [];

  return validation.errors.map((error, index) => {
    const copy = getValidatorMessageCopy(error, 'blocked');

    return {
      key: `validator-blocker-${index}`,
      label: copy.label,
      detail: copy.detail,
      state: 'blocked',
    };
  });
}

export function getValidatorReviewItems(validation: IssueValidatorResult | null): IssueReadinessItem[] {
  if (!validation?.warnings?.length) return [];

  return validation.warnings.map((warning, index) => {
    const copy = getValidatorMessageCopy(warning, 'needs_review');

    return {
      key: `validator-warning-${index}`,
      label: copy.label,
      detail: copy.detail,
      state: 'needs_review',
    };
  });
}

function getValidatorMessageCopy(
  message: string,
  state: Extract<ReadinessState, 'blocked' | 'needs_review'>,
): Pick<IssueReadinessItem, 'label' | 'detail'> {
  const moduleKey = extractModuleKey(message);
  const normalized = message.toLowerCase();

  if (moduleKey) {
    return getModuleMessageCopy(message, moduleKey, state);
  }

  if (normalized.includes('approval')) {
    return {
      label: 'Approval required before issue',
      detail: 'Complete the approval or sign-off step before issuing this assessment.',
    };
  }

  if (normalized.includes('only draft') || normalized.includes('document status')) {
    return {
      label: 'Document status prevents issue',
      detail: 'Only an eligible draft document can be issued.',
    };
  }

  if (normalized.includes('permission')) {
    return {
      label: 'Issue permission required',
      detail: 'Your account does not currently have permission to issue this document.',
    };
  }

  if (state === 'needs_review') {
    return {
      label: 'Recommended before issue',
      detail: professionalizeGenericValidatorMessage(message) || 'Review and confirm before issuing.',
    };
  }

  return {
    label: 'Issue requirement not yet met',
    detail: professionalizeGenericValidatorMessage(message) || 'Resolve this requirement before issuing.',
  };
}

function getModuleMessageCopy(
  message: string,
  moduleKey: string,
  state: Extract<ReadinessState, 'blocked' | 'needs_review'>,
): Pick<IssueReadinessItem, 'label' | 'detail'> {
  const moduleName = getModuleDisplayLabel(moduleKey);
  const normalized = message.toLowerCase();

  if (normalized.includes('unrated required factors')) {
    return {
      label: `${moduleName} incomplete`,
      detail: removeRawModuleReference(message, moduleKey)
        .replace(/^has\s+/i, 'Required ratings have ')
        .replace(/unrated required factors/i, 'not yet been completed') ||
        'Required ratings have not yet been completed.',
    };
  }

  if (normalized.includes('missing')) {
    return {
      label: `${moduleName} missing`,
      detail: state === 'blocked'
        ? 'This required section is not available in the draft. Add or restore this section before issue.'
        : 'Recommended before issue.',
    };
  }

  if (normalized.includes('has no data') || normalized.includes('incomplete')) {
    return {
      label: `${moduleName} ${state === 'blocked' ? 'incomplete' : 'not completed'}`,
      detail: state === 'blocked'
        ? 'This required section has not yet been completed.'
        : 'Recommended before issue.',
    };
  }

  return {
    label: `${moduleName} ${state === 'blocked' ? 'requires attention' : 'should be reviewed'}`,
    detail: state === 'blocked'
      ? 'Resolve this section before issuing.'
      : 'Recommended before issue.',
  };
}

function extractModuleKey(message: string): string | null {
  const match = message.match(MODULE_MESSAGE_PATTERN);
  return match?.[1] ?? null;
}

function removeRawModuleReference(message: string, moduleKey: string): string {
  return message
    .replace(new RegExp(`\\bRequired\\s+module\\s+${moduleKey}\\s*`, 'i'), '')
    .replace(new RegExp(`\\bOptional\\s+module\\s+${moduleKey}\\s*`, 'i'), '')
    .replace(new RegExp(`\\bModule\\s+${moduleKey}\\s*`, 'i'), '')
    .trim();
}

function professionalizeGenericValidatorMessage(message: string): string {
  return message
    .replace(/\bhas no data\b/gi, 'has not yet been completed')
    .replace(/\bmust have\b/gi, 'Record')
    .replace(/\bmust be\b/gi, 'Needs to be')
    .trim();
}
