import { isIP } from 'node:net';
import {
  canonicalIp,
  configuredRules,
  type TlsClientAuthRules,
} from '../client-auth/certificate-checks.js';
import {
  DistinguishedNameError,
  parseRfc4514,
} from '../client-auth/distinguished-name.js';

export const TOKEN_ENDPOINT_AUTH_METHODS = [
  'client_secret_basic',
  'client_secret_post',
  'none',
  'tls_client_auth',
  'self_signed_tls_client_auth',
] as const;

export type TokenEndpointAuthMethodValue =
  (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];

/** A client's authentication settings after a create or update. */
export interface ClientAuthSettings extends TlsClientAuthRules {
  clientType: 'CONFIDENTIAL' | 'PUBLIC';
  tokenEndpointAuthMethod: TokenEndpointAuthMethodValue | null;
}

/**
 * Why these settings cannot be saved, or `undefined`:
 *
 * - `none` only for a PUBLIC client; every other method only for a
 *   CONFIDENTIAL one.
 * - `tls_client_auth` needs exactly one subject rule (RFC 8705 §2.1.2), and
 *   the rules mean nothing for any other method, so they must be empty.
 * - `self_signed_tls_client_auth` may be saved before any certificate is
 *   registered; it cannot authenticate until one is.
 */
export function clientAuthSettingsProblem(
  settings: ClientAuthSettings,
): string | undefined {
  const method = settings.tokenEndpointAuthMethod;
  if (method === 'none' && settings.clientType !== 'PUBLIC') {
    return 'tokenEndpointAuthMethod "none" needs a PUBLIC client';
  }
  if (method && method !== 'none' && settings.clientType !== 'CONFIDENTIAL') {
    return `tokenEndpointAuthMethod "${method}" needs a CONFIDENTIAL client`;
  }
  const rules = configuredRules(settings);
  if (method === 'tls_client_auth') {
    if (rules.length !== 1) {
      return (
        'tls_client_auth needs exactly one of tlsClientAuthSubjectDn, ' +
        'tlsClientAuthSanDns, tlsClientAuthSanUri, tlsClientAuthSanIp, ' +
        `tlsClientAuthSanEmail; ${rules.length} set`
      );
    }
  } else if (rules.length > 0) {
    return `${rules.join(', ')} apply only to tls_client_auth; set them to null`;
  }
  return undefined;
}

// ─── Field formats (used by the DTO validators) ──────────────────────────────

export function isValidSubjectDn(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return parseRfc4514(value).length > 0;
  } catch (err) {
    if (err instanceof DistinguishedNameError) return false;
    throw err;
  }
}

/** A DNS name, no wildcard. */
export function isValidSanDns(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 253 &&
    isIP(value) === 0 &&
    /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$/.test(
      value,
    )
  );
}

/** An absolute URI. */
export function isValidSanUri(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) {
    return false;
  }
  try {
    return /^[a-z][a-z0-9+.-]*:/i.test(value) && Boolean(new URL(value));
  } catch {
    return false;
  }
}

export function isValidSanIp(value: unknown): boolean {
  return typeof value === 'string' && canonicalIp(value) !== undefined;
}

/** An rfc822Name: local@domain, no spaces. */
export function isValidSanEmail(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+$/.test(value)
  );
}
