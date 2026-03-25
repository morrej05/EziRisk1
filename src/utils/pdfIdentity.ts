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

export function resolvePdfPreparedByName(
  preparedByName: string | null | undefined,
  organisationName: string | null | undefined
): string {
  const authPreparedByName = preparedByName?.trim();
  if (authPreparedByName) return authPreparedByName;

  const authOrganisationName = organisationName?.trim();
  if (authOrganisationName) return authOrganisationName;

  return 'Authenticated User';
}

export function buildPdfIdentityOptions(
  organisation: Organisation | null | undefined,
  user: AuthLikeUser
): { applyTrialWatermark: boolean; preparedByName: string } {
  return {
    applyTrialWatermark: isWatermarked(organisation),
    preparedByName: resolvePdfPreparedByName(resolvePreparedByName(user), organisation?.name),
  };
}
