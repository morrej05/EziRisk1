import type { UpgradeBlockReason } from './upgradeBlocks';

export interface UpgradeContextOptions {
  action?: string;
}

export function buildUpgradePath(reason: UpgradeBlockReason, options?: UpgradeContextOptions): string {
  const params = new URLSearchParams();
  params.set('reason', reason);

  if (options?.action) {
    params.set('action', options.action);
  }

  return `/upgrade?${params.toString()}`;
}
