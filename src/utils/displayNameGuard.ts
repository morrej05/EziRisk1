type UserWithName = {
  name?: string | null;
} | null | undefined;

/**
 * Returns true when the user needs to set (or fix) their display name.
 * Triggers when:
 *   - name is absent / empty
 *   - name looks like an email address (seeded from auth email at signup)
 */
export function needsDisplayName(user: UserWithName): boolean {
  if (!user) return false;
  const name = user.name?.trim();
  if (!name) return true;
  if (name.includes('@')) return true;
  return false;
}
