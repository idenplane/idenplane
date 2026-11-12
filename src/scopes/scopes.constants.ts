/**
 * OIDC standard scope definitions.
 * Each scope maps to the set of claims it grants access to.
 */
export const OIDC_SCOPES: Record<string, string[]> = {
  openid: ['sub'],
  profile: [
    'name',
    'family_name',
    'given_name',
    'preferred_username',
    'updated_at',
  ],
  email: ['email', 'email_verified'],
  roles: ['realm_access', 'resource_access'],
  // No claims: it asks for a refresh token that outlives the SSO session
  // (OIDC Core §11), with the realm's offline token lifespan.
  offline_access: [],
};

/** All valid scope names the server recognizes */
export const SUPPORTED_SCOPES = Object.keys(OIDC_SCOPES);
