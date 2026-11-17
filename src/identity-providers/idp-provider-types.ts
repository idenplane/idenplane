import { WELL_KNOWN_PROVIDERS } from '../broker/providers.js';

/**
 * Identity provider types Idenplane can sign users in with:
 *
 * - `oidc` and `oauth2`: the broker (src/broker) sends the user to
 *   `authorizationUrl`, redeems the code at `tokenUrl` and reads the profile
 *   from `userinfoUrl`.
 * - `saml`: Idenplane is a SAML 2.0 service provider; everything it needs is
 *   in `samlConfig` (see saml-config.ts) and the OAuth columns stay empty.
 */
export const SUPPORTED_IDP_PROVIDER_TYPES = ['oidc', 'oauth2', 'saml'] as const;
export type IdpProviderType = (typeof SUPPORTED_IDP_PROVIDER_TYPES)[number];

/** The supported type for `value` (case-insensitive), or null. */
export function supportedIdpProviderType(
  value: unknown,
): IdpProviderType | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return (SUPPORTED_IDP_PROVIDER_TYPES as readonly string[]).includes(lower)
    ? (lower as IdpProviderType)
    : null;
}

/** Why an identity provider of type `value` cannot be imported. */
export function unsupportedIdpTypeReason(value: unknown): string {
  const shown = typeof value === 'string' && value ? value : '(none)';
  const supported = SUPPORTED_IDP_PROVIDER_TYPES.join(', ');
  if (typeof value === 'string' && /ws-?fed|wsfed|adfs|waad/i.test(value)) {
    return (
      `provider type '${shown}' is WS-Federation, which Idenplane does not ` +
      `support (supported: ${supported}). ADFS and Entra ID also offer SAML 2.0 ` +
      `and OpenID Connect: add the provider with one of those.`
    );
  }
  return `provider type '${shown}' is not supported (supported: ${supported}).`;
}

/** The fields an identity provider needs before the broker can use it. */
export interface BrokerFields {
  clientId?: string | null;
  clientSecret?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
  userinfoUrl?: string | null;
  jwksUrl?: string | null;
  issuer?: string | null;
  defaultScopes?: string | null;
}

/**
 * Fills endpoints left out of an export for a provider whose endpoints are
 * fixed (Keycloak's and Auth0's Google, GitHub and Microsoft connections
 * carry no URLs). Values present in `fields` win.
 */
export function withWellKnownEndpoints(
  wellKnown: keyof typeof WELL_KNOWN_PROVIDERS | null,
  fields: BrokerFields,
): BrokerFields {
  const known = wellKnown ? WELL_KNOWN_PROVIDERS[wellKnown] : undefined;
  if (!known) return fields;
  const pick = (own: string | null | undefined, fallback: string) =>
    own || fallback || null;
  return {
    ...fields,
    authorizationUrl: pick(fields.authorizationUrl, known.authorizationUrl),
    tokenUrl: pick(fields.tokenUrl, known.tokenUrl),
    userinfoUrl: pick(fields.userinfoUrl, known.userinfoUrl),
    jwksUrl: pick(fields.jwksUrl, known.jwksUrl),
    issuer: pick(fields.issuer, known.issuer),
    defaultScopes: pick(fields.defaultScopes, known.defaultScopes),
  };
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The required broker fields that are missing or unusable: `clientId`, and
 * `authorizationUrl` and `tokenUrl` as http(s) URLs. Empty when the provider
 * can be used (the client secret is checked separately: without one the
 * provider is imported disabled).
 */
export function missingBrokerFields(fields: BrokerFields): string[] {
  const missing: string[] = [];
  if (!fields.clientId) missing.push('clientId');
  if (!isHttpUrl(fields.authorizationUrl)) missing.push('authorizationUrl');
  if (!isHttpUrl(fields.tokenUrl)) missing.push('tokenUrl');
  return missing;
}

/**
 * Whether an exported client secret is usable. Keycloak writes
 * `**********` in place of secrets it does not export.
 */
export function hasUsableSecret(secret: string | null | undefined): boolean {
  return !!secret && !/^\*+$/.test(secret);
}
