/**
 * Password hash formats other than Argon2: the ones user migration brings in.
 *
 * Pure functions (no Nest, no database) so every format can be tested on its
 * own. {@link PasswordVerificationService} dispatches to them.
 *
 * Stored formats:
 * - Argon2 (`$argon2id$...`, `$argon2i$...`, `$argon2d$...`): verified by
 *   CryptoService.
 * - bcrypt (`$2a$`, `$2b$`, `$2y$`): Auth0, Zitadel.
 * - PBKDF2 in PHC form, with the digest and iteration count in the string:
 *   `$pbkdf2-<sha1|sha256|sha512>$i=<iterations>[,l=<key length>]$<salt>$<hash>`,
 *   salt and hash in standard base64, padding optional. Written by the
 *   Keycloak and Authentik importers since 0.11.0; also the format of Auth0's
 *   `custom_password_hash` for PBKDF2.
 * - Legacy PBKDF2 written by importers before 0.11.0: `<iterations>$<salt>$<hash>`
 *   or `<salt>:<hash>` (27 500 iterations), with the digest only in the
 *   user's `passwordAlgorithm` column.
 */
import { pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as bcryptjs from 'bcryptjs';

const pbkdf2Async = promisify(pbkdf2);

export const PBKDF2_DIGESTS = ['sha1', 'sha256', 'sha512'] as const;
export type Pbkdf2Digest = (typeof PBKDF2_DIGESTS)[number];

/**
 * Bounds that keep a malformed or hostile stored hash from turning one
 * sign-in into seconds of CPU. Real deployments are far below them
 * (Keycloak 26: 600 000 for SHA-256, 210 000 for SHA-512; OWASP 2023:
 * 1 300 000 for SHA-1).
 */
export const MAX_PBKDF2_ITERATIONS = 10_000_000;
const MAX_PBKDF2_KEY_BYTES = 1024;
const MAX_PBKDF2_SALT_BYTES = 1024;
/** bcrypt cost factor 2^n; 31 would take days. */
const MAX_BCRYPT_COST = 18;

/** Keycloak's default iteration count before it stored one per credential. */
const LEGACY_DEFAULT_ITERATIONS = 27_500;

export interface Pbkdf2Hash {
  digest: Pbkdf2Digest;
  iterations: number;
  salt: Buffer;
  hash: Buffer;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Strict standard base64 (padding optional); `null` when it is not. */
export function decodeBase64(value: string): Buffer | null {
  if (!BASE64.test(value)) return null;
  const unpadded = value.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return null;
  const out = Buffer.from(unpadded, 'base64');
  return out.length > 0 ? out : null;
}

function b64(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

function validIterations(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PBKDF2_ITERATIONS;
}

function checked(p: Pbkdf2Hash): Pbkdf2Hash | null {
  if (!validIterations(p.iterations)) return null;
  if (p.salt.length > MAX_PBKDF2_SALT_BYTES) return null;
  if (p.hash.length < 16 || p.hash.length > MAX_PBKDF2_KEY_BYTES) return null;
  return p;
}

export function isPbkdf2Digest(value: unknown): value is Pbkdf2Digest {
  return (PBKDF2_DIGESTS as readonly unknown[]).includes(value);
}

/** The PHC form the importers write: `$pbkdf2-sha256$i=27500,l=64$salt$hash`. */
export function encodePbkdf2(p: Pbkdf2Hash): string {
  return `$pbkdf2-${p.digest}$i=${p.iterations},l=${p.hash.length}$${b64(p.salt)}$${b64(p.hash)}`;
}

const PHC_PBKDF2 =
  /^\$pbkdf2-(sha1|sha256|sha512)\$i=(\d{1,9})(?:,l=(\d{1,4}))?\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

/** Parse the PHC form; `null` when `stored` is not a valid one. */
export function parsePbkdf2(stored: string): Pbkdf2Hash | null {
  const m = PHC_PBKDF2.exec(stored);
  if (!m) return null;
  const salt = decodeBase64(m[4]);
  const hash = decodeBase64(m[5]);
  if (!salt || !hash) return null;
  if (m[3] !== undefined && Number(m[3]) !== hash.length) return null;
  return checked({
    digest: m[1] as Pbkdf2Digest,
    iterations: Number(m[2]),
    salt,
    hash,
  });
}

/**
 * The digests to try for a legacy (pre-0.11.0) PBKDF2 row, by its
 * `passwordAlgorithm` column. The Keycloak importer used to label every
 * Keycloak credential `pbkdf2-sha256` whatever its real algorithm, so a row
 * labelled that way may hold a SHA-512 or SHA-1 key: all three are tried.
 */
function legacyDigests(algorithm: string | null | undefined): Pbkdf2Digest[] {
  switch (algorithm) {
    case 'pbkdf2-sha256':
      return ['sha256', 'sha512', 'sha1'];
    case 'pbkdf2-sha512':
      return ['sha512'];
    case 'pbkdf2':
    case 'pbkdf2-sha1':
      return ['sha1'];
    default:
      return [];
  }
}

/** Parse a legacy row: `<iterations>$<salt>$<hash>` or `<salt>:<hash>`. */
export function parseLegacyPbkdf2(
  stored: string,
  algorithm: string | null | undefined,
): Pbkdf2Hash[] {
  const digests = legacyDigests(algorithm);
  if (digests.length === 0) return [];
  let iterations: number;
  let saltText: string;
  let hashText: string;
  const dollar = stored.split('$');
  const colon = stored.split(':');
  if (dollar.length === 3 && /^\d{1,9}$/.test(dollar[0])) {
    iterations = Number(dollar[0]);
    [, saltText, hashText] = dollar;
  } else if (colon.length === 2) {
    iterations = LEGACY_DEFAULT_ITERATIONS;
    [saltText, hashText] = colon;
  } else {
    return [];
  }
  const salt = decodeBase64(saltText);
  const hash = decodeBase64(hashText);
  if (!salt || !hash) return [];
  return digests
    .map((digest) => checked({ digest, iterations, salt, hash }))
    .filter((p): p is Pbkdf2Hash => p !== null);
}

/** Derive and compare in constant time. Never throws. */
export async function verifyPbkdf2(
  password: string,
  p: Pbkdf2Hash,
): Promise<boolean> {
  try {
    const derived = await pbkdf2Async(
      password,
      p.salt,
      p.iterations,
      p.hash.length,
      p.digest,
    );
    return derived.length === p.hash.length && timingSafeEqual(derived, p.hash);
  } catch {
    return false;
  }
}

const BCRYPT = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(stored: string): boolean {
  return BCRYPT.test(stored);
}

/** bcrypt (`$2a$`, `$2b$`, `$2y$`); false for a malformed hash. Never throws. */
export async function verifyBcrypt(
  password: string,
  stored: string,
): Promise<boolean> {
  const m = BCRYPT.exec(stored);
  if (!m || Number(m[1]) < 4 || Number(m[1]) > MAX_BCRYPT_COST) return false;
  try {
    // bcryptjs compares in constant time.
    return await bcryptjs.compare(password, stored);
  } catch {
    return false;
  }
}
