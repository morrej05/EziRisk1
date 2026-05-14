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

export function readinessStateLabel(state: ReadinessState): string {
  if (state === 'blocked') return 'Blocked';
  if (state === 'needs_review') return 'Needs review';
  return 'Ready';
}

export function getValidatorBlockerItems(validation: IssueValidatorResult | null): IssueReadinessItem[] {
  if (!validation || validation.valid) return [];

  return validation.errors.map((error, index) => ({
    key: `validator-blocker-${index}`,
    label: getValidatorBlockerLabel(error),
    detail: error,
    state: 'blocked',
  }));
}

export function getValidatorReviewItems(validation: IssueValidatorResult | null): IssueReadinessItem[] {
  if (!validation?.warnings?.length) return [];

  return validation.warnings.map((warning, index) => ({
    key: `validator-warning-${index}`,
    label: 'Recommended before issue',
    detail: warning,
    state: 'needs_review',
  }));
}

function getValidatorBlockerLabel(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('approval')) {
    return 'Approval required before issue';
  }

  if (normalized.includes('only draft') || normalized.includes('document status')) {
    return 'Document status prevents issue';
  }

  if (normalized.includes('required module') || normalized.includes('module')) {
    return 'Required module incomplete';
  }

  return 'Issue validator blocker';
}
