import type { WebAuthnRelyingParty } from '../webauthn/webauthn.service.js';

/** The environment the admin console's relying party is read from. */
export interface AdminRpEnv {
  ADMIN_WEBAUTHN_RP_ID?: string;
  /** Comma-separated origins the console is served from. */
  ADMIN_WEBAUTHN_ORIGINS?: string;
  BASE_URL?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:3000';

function parseUrl(value: string | undefined): URL | null {
  try {
    return new URL(value || DEFAULT_BASE_URL);
  } catch {
    return null;
  }
}

/**
 * The relying party the admin console registers and checks passkeys with.
 * It does not depend on the master realm's WebAuthn switch:
 *
 * - RP ID: ADMIN_WEBAUTHN_RP_ID, else the master realm's WebAuthn RP ID
 *   (so passkeys set up for the master account work here too), else the
 *   host name of BASE_URL;
 * - origins: ADMIN_WEBAUTHN_ORIGINS, else the origin of BASE_URL (the
 *   console is served from the server, under /console).
 *
 * User verification is preferred, not required: the passkey is a second
 * factor after the password.
 */
export function adminWebAuthnRp(
  master: { webAuthnRpId: string | null },
  env: AdminRpEnv,
): WebAuthnRelyingParty {
  const base = parseUrl(env.BASE_URL);
  const id =
    env.ADMIN_WEBAUTHN_RP_ID?.trim() ||
    master.webAuthnRpId?.trim() ||
    base?.hostname ||
    'localhost';
  const configured = (env.ADMIN_WEBAUTHN_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const origins = configured.length
    ? configured
    : [base?.origin ?? new URL(DEFAULT_BASE_URL).origin];
  return {
    id,
    name: 'Idenplane admin console',
    origins,
    userVerificationRequired: false,
  };
}
