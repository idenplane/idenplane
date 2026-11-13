export interface UserClaimSource {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  /** When the profile last changed; the OIDC `updated_at` claim. */
  updatedAt: Date;
}

/**
 * Build the full claims object for a user, then filter to only
 * those claims allowed by the granted scopes.
 * Custom attribute claims (via mapToOidcClaim) are always included
 * when present — they bypass the scope-based filter since the admin
 * explicitly mapped them.
 */
export function resolveUserClaims(
  user: UserClaimSource,
  allowedClaims: Set<string>,
  customAttributeClaims?: Record<string, string>,
): Record<string, unknown> {
  const allClaims: Record<string, unknown> = {
    sub: user.id,
    preferred_username: user.username,
    given_name: user.firstName ?? undefined,
    family_name: user.lastName ?? undefined,
    name:
      user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : (user.firstName ?? user.lastName ?? undefined),
    email: user.email ?? undefined,
    email_verified: user.emailVerified,
    // Seconds since the epoch (OIDC Core §5.1).
    updated_at: Math.floor(user.updatedAt.getTime() / 1000),
  };

  // `sub` is mandatory in every OIDC response — always include it.
  const filtered: Record<string, unknown> = { sub: user.id };
  for (const [key, value] of Object.entries(allClaims)) {
    if (key === 'sub') continue; // already set above
    if (allowedClaims.has(key) && value !== undefined) {
      filtered[key] = value;
    }
  }

  // Merge custom attribute OIDC claims — always included when mapped
  if (customAttributeClaims) {
    for (const [claim, value] of Object.entries(customAttributeClaims)) {
      if (value !== undefined && value !== '') {
        filtered[claim] = value;
      }
    }
  }

  return filtered;
}
