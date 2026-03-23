import { isWatermarked, type Organisation } from './entitlements';

type AuthLikeUser = {
  name?: string | null;
  email?: string | null;
} | null | undefined;

export function resolvePreparedByName(user: AuthLikeUser): string | null {
  const profileName = user?.name?.trim();
  if (profileName) return profileName;

  const email = user?.email?.trim();
  if (email) return email;

  return null;
}

export function buildPdfIdentityOptions(
  organisation: Organisation | null | undefined,
  user: AuthLikeUser
): { applyTrialWatermark: boolean; preparedByName: string | null } {
  return {
    applyTrialWatermark: isWatermarked(organisation),
    preparedByName: resolvePreparedByName(user),
  };
}
