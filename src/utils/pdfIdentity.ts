import { isWatermarked, type Organisation } from './entitlements';

type AuthLikeUser = {
  name?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null | undefined;

export function resolveDisplayName(user: AuthLikeUser): string | null {
  // 1. Profile name (user_profiles.name, surfaced as user.name)
  const profileName = user?.name?.trim();
  if (profileName) return profileName;

  const meta = user?.user_metadata;

  // 2. user_metadata.full_name (OAuth / signup flows)
  const metaFullName = (meta?.full_name as string | undefined)?.trim();
  if (metaFullName) return metaFullName;

  // 3. user_metadata first_name + last_name
  const first = (meta?.first_name as string | undefined)?.trim() || '';
  const last = (meta?.last_name as string | undefined)?.trim() || '';
  const composite = [first, last].filter(Boolean).join(' ');
  if (composite) return composite;

  // 4. user_metadata.name
  const metaName = (meta?.name as string | undefined)?.trim();
  if (metaName) return metaName;

  // 5. Email prefix only — never the full raw email address
  const email = user?.email?.trim();
  if (email) {
    const prefix = email.split('@')[0];
    if (prefix) return prefix;
  }

  return null;
}

export function resolvePreparedByName(user: AuthLikeUser): string | null {
  return resolveDisplayName(user);
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
    preparedByName: resolvePdfPreparedByName(resolveDisplayName(user), organisation?.name),
  };
}
