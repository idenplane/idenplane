/**
 * Turning the password hashes of other identity providers into what
 * Idenplane stores, with the real algorithm recorded. Pure functions, one
 * per source, so each can be tested on its own.
 *
 * What is stored (see crypto/password-hash-formats.ts for the formats
 * PasswordVerificationService reads):
 * - PBKDF2 in PHC form, digest and iterations in the string:
 *   `$pbkdf2-sha512$i=210000,l=64$<salt>$<hash>`, `passwordAlgorithm`
 *   `pbkdf2-sha512`;
 * - Argon2 as a PHC string (`$argon2id$v=19$m=…`), `passwordAlgorithm`
 *   `argon2`;
 * - bcrypt as is, `passwordAlgorithm` `bcrypt`.
 *
 * A hash that cannot be carried over is never stored under a wrong label:
 * the user is imported without a password (they reset it) and the import
 * report gets a warning that says why.
 */
import type { KeycloakCredential } from './keycloak-types.js';
import type { Auth0User } from './auth0-types.js';
import {
  decodeBase64,
  encodePbkdf2,
  isBcryptHash,
  isPbkdf2Digest,
  MAX_PBKDF2_ITERATIONS,
  parsePbkdf2,
  type Pbkdf2Digest,
} from '../crypto/password-hash-formats.js';

export interface ImportedPassword {
  /** The hash to store, or `null` for "no password". */
  hash: string | null;
  /** The `passwordAlgorithm` column. */
  algorithm: string;
  /** A plaintext password from the export, to hash with Argon2id. */
  plaintext?: string;
  /** Why the password was not carried over, for the import report. */
  warning?: string;
}

const NONE: ImportedPassword = { hash: null, algorithm: 'argon2' };

function dropped(reason: string): ImportedPassword {
  return {
    ...NONE,
    warning: `${reason}; imported without a password (the user must reset it)`,
  };
}

function pbkdf2(
  digest: Pbkdf2Digest,
  iterations: unknown,
  saltB64: unknown,
  hashB64: unknown,
  source: string,
): ImportedPassword {
  const iter = Number(iterations);
  const salt = typeof saltB64 === 'string' ? decodeBase64(saltB64) : null;
  const hash = typeof hashB64 === 'string' ? decodeBase64(hashB64) : null;
  if (
    !Number.isSafeInteger(iter) ||
    iter < 1 ||
    iter > MAX_PBKDF2_ITERATIONS ||
    !salt ||
    !hash ||
    hash.length < 16
  ) {
    return dropped(`${source} PBKDF2 credential is malformed`);
  }
  return {
    hash: encodePbkdf2({ digest, iterations: iter, salt, hash }),
    algorithm: `pbkdf2-${digest}`,
  };
}

// ─── Keycloak ────────────────────────────────────────────────────────────────

/** Keycloak's algorithm ids for its PBKDF2 providers. */
const KEYCLOAK_PBKDF2: Record<string, Pbkdf2Digest> = {
  pbkdf2: 'sha1',
  'pbkdf2-sha256': 'sha256',
  'pbkdf2-sha512': 'sha512',
};

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Keycloak's `additionalParameters` values are lists of strings. */
function param(
  params: Record<string, unknown> | null,
  name: string,
): string | undefined {
  const v = params?.[name];
  const first: unknown = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' || typeof first === 'number'
    ? String(first)
    : undefined;
}

function unpadded(b64: string): string {
  return b64.replace(/=+$/, '');
}

/**
 * Keycloak's Argon2 provider (the default since Keycloak 24) stores the raw
 * hash and salt with the parameters beside them; rebuild the PHC string.
 */
function keycloakArgon2(
  iterations: unknown,
  params: Record<string, unknown> | null,
  saltB64: unknown,
  hashB64: unknown,
): ImportedPassword {
  const type = param(params, 'type') ?? 'id';
  const version = param(params, 'version') ?? '1.3';
  const memory = Number(param(params, 'memory') ?? 7168);
  const parallelism = Number(param(params, 'parallelism') ?? 1);
  const t = Number(iterations ?? 5);
  const salt = typeof saltB64 === 'string' ? decodeBase64(saltB64) : null;
  const hash = typeof hashB64 === 'string' ? decodeBase64(hashB64) : null;
  const v = version === '1.3' ? 19 : version === '1.0' ? 16 : null;
  if (
    !['id', 'i', 'd'].includes(type) ||
    v === null ||
    ![memory, parallelism, t].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !salt ||
    !hash
  ) {
    return dropped('Keycloak Argon2 credential is malformed');
  }
  return {
    hash:
      `$argon2${type}$v=${v}$m=${memory},t=${t},p=${parallelism}` +
      `$${unpadded(salt.toString('base64'))}$${unpadded(hash.toString('base64'))}`,
    algorithm: 'argon2',
  };
}

/**
 * A Keycloak user's password credential, in either export format:
 * - current (Keycloak 7+): `secretData` = `{"value","salt"}` and
 *   `credentialData` = `{"hashIterations","algorithm","additionalParameters"}`,
 *   both JSON strings;
 * - legacy: `hashedSaltedValue`, `salt`, `hashIterations`, `algorithm`.
 * Also a plaintext `value`, which Keycloak accepts on import.
 */
export function keycloakPassword(
  credentials: KeycloakCredential[] | undefined,
): ImportedPassword {
  const cred = credentials?.find((c) => c.type === 'password');
  if (!cred) return NONE;

  let algorithm: unknown;
  let iterations: unknown;
  let salt: unknown;
  let value: unknown;
  let params: Record<string, unknown> | null = null;

  if (cred.secretData !== undefined || cred.credentialData !== undefined) {
    const secret = parseJson(cred.secretData);
    const data = parseJson(cred.credentialData);
    if (!secret || !data) {
      return dropped(
        'Keycloak credential secretData/credentialData is not readable JSON',
      );
    }
    value = secret['value'];
    salt = secret['salt'];
    algorithm = data['algorithm'];
    iterations = data['hashIterations'];
    params = parseJson(data['additionalParameters']);
  } else if (cred.hashedSaltedValue !== undefined) {
    value = cred.hashedSaltedValue;
    salt = cred.salt;
    algorithm = cred.algorithm;
    iterations = cred.hashIterations;
  } else if (typeof cred.value === 'string' && cred.value !== '') {
    return { hash: null, algorithm: 'argon2', plaintext: cred.value };
  } else {
    return NONE;
  }

  if (algorithm === undefined || algorithm === null || algorithm === '') {
    // Very old exports carry no algorithm. Keycloak's default was PBKDF2
    // with SHA-1 before 4.x and SHA-256 after; store the legacy form, whose
    // verification tries each digest (see parseLegacyPbkdf2).
    const iter = Number(iterations ?? 27500);
    if (
      typeof salt !== 'string' ||
      typeof value !== 'string' ||
      !decodeBase64(salt) ||
      !decodeBase64(value) ||
      !Number.isSafeInteger(iter) ||
      iter < 1 ||
      iter > MAX_PBKDF2_ITERATIONS
    ) {
      return dropped('Keycloak credential is malformed');
    }
    return { hash: `${iter}$${salt}$${value}`, algorithm: 'pbkdf2-sha256' };
  }

  const name =
    typeof algorithm === 'string' ? algorithm : JSON.stringify(algorithm);
  const digest = KEYCLOAK_PBKDF2[name];
  if (digest)
    return pbkdf2(digest, iterations ?? 27500, salt, value, 'Keycloak');
  if (name === 'argon2') return keycloakArgon2(iterations, params, salt, value);
  if (name === 'bcrypt' && typeof value === 'string' && isBcryptHash(value)) {
    // keycloak-bcrypt and similar extensions store the full bcrypt string.
    return { hash: value, algorithm: 'bcrypt' };
  }
  return dropped(`Keycloak password algorithm "${name}" is not supported`);
}

// ─── Auth0 ───────────────────────────────────────────────────────────────────

/**
 * Auth0's bulk user export (`password_hash`, bcrypt) or a
 * `custom_password_hash` as the Auth0 user import format defines it.
 */
export function auth0Password(user: Auth0User): ImportedPassword {
  if (user.password_hash) {
    return isBcryptHash(user.password_hash)
      ? { hash: user.password_hash, algorithm: 'bcrypt' }
      : dropped('Auth0 password_hash is not a bcrypt hash');
  }
  const custom = user.custom_password_hash;
  if (!custom) return NONE;
  const value = custom.hash?.value;
  if (typeof value !== 'string' || value === '') {
    return dropped('Auth0 custom_password_hash has no hash value');
  }
  switch (custom.algorithm) {
    case 'bcrypt':
      return isBcryptHash(value)
        ? { hash: value, algorithm: 'bcrypt' }
        : dropped('Auth0 bcrypt custom_password_hash is malformed');
    case 'argon2':
      return /^\$argon2(id|i|d)\$/.test(value)
        ? { hash: value, algorithm: 'argon2' }
        : dropped('Auth0 argon2 custom_password_hash is not a PHC string');
    case 'pbkdf2': {
      // PHC string: $pbkdf2-<digest>$i=<iterations>,l=<length>$<salt>$<hash>
      const parsed = parsePbkdf2(value);
      return parsed
        ? { hash: encodePbkdf2(parsed), algorithm: `pbkdf2-${parsed.digest}` }
        : dropped(
            'Auth0 pbkdf2 custom_password_hash is malformed or uses an unsupported digest',
          );
    }
    default:
      return dropped(
        `Auth0 custom_password_hash algorithm "${String(custom.algorithm)}" is not supported`,
      );
  }
}

// ─── Authentik (Django hashers) ─────────────────────────────────────────────

/**
 * Authentik stores passwords in Django's format `<hasher>$<rest>`:
 * - `pbkdf2_sha256$<iterations>$<salt>$<base64 hash>` (the default) and
 *   `pbkdf2_sha1$…`; the salt is a plain string, used as its UTF-8 bytes;
 * - `argon2$argon2id$v=19$m=…` (Django's ArgonPasswordHasher): the PHC
 *   string after the `argon2` prefix.
 * Anything else (bcrypt_sha256, scrypt, md5…) is dropped with a warning.
 */
export function authentikPassword(raw: string | undefined): ImportedPassword {
  if (!raw) return NONE;
  if (/^argon2\$argon2(id|i|d)\$/.test(raw)) {
    return { hash: raw.slice('argon2'.length), algorithm: 'argon2' };
  }
  const django = /^pbkdf2_(sha1|sha256)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(raw);
  if (django) {
    const [, digest, iterations, saltPlain, hashB64] = django;
    if (!isPbkdf2Digest(digest)) {
      return dropped('Authentik password hasher is not supported');
    }
    return pbkdf2(
      digest,
      iterations,
      Buffer.from(saltPlain, 'utf8').toString('base64'),
      hashB64,
      'Authentik',
    );
  }
  const hasher = raw.split('$')[0];
  return dropped(`Authentik password hasher "${hasher}" is not supported`);
}
