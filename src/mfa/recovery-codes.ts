import { randomBytes } from 'node:crypto';
import type { CryptoService } from '../crypto/crypto.service.js';

/**
 * Recovery codes (lookup secrets, ASVS V6.5.2).
 *
 * Since 0.11.0 a code is 15 random bytes (120 bits) as 24 base32 characters,
 * shown in four groups of six: `abcdef-ghijkl-mnopqr-stuvwx`. At 112 bits or
 * more a code cannot be enumerated, so a standard hash is enough (ASVS
 * allows it) and the lookup stays a single indexed-equality query. It is
 * stored as `rc2$` + SHA-256 of the normalised code.
 *
 * Not a keyed hash (CryptoService.hmac): codes live for years, and an
 * ENCRYPTION_KEY rotation would silently invalidate every one of them.
 *
 * Codes issued before 0.11.0 (8 hex characters, 32 bits) were stored as an
 * unsalted SHA-256, reversible from a database copy in seconds. They keep
 * working; RecoveryCodeRewrapService replaces each stored hash with
 * `rc1a$` + Argon2id(that hash), so the database no longer gives them away.
 */

/** Stored-hash prefix of a 0.11.0 code. */
export const RECOVERY_CODE_V2_PREFIX = 'rc2$';
/** Stored-hash prefix of a pre-0.11.0 hash wrapped in Argon2id. */
export const RECOVERY_CODE_WRAPPED_PREFIX = 'rc1a$';

/** Random bytes per code: 120 bits. */
export const RECOVERY_CODE_BYTES = 15;
/** Codes issued at a time. */
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lower case, no padding. */
function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** A new code, grouped for display. */
export function generateRecoveryCode(): string {
  const raw = base32(randomBytes(RECOVERY_CODE_BYTES));
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 6) groups.push(raw.slice(i, i + 6));
  return groups.join('-');
}

/** The code as hashed: lower case, without spaces or dashes. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

/** True for input in the shape of a pre-0.11.0 code (8 hex characters). */
export function isLegacyRecoveryCode(normalized: string): boolean {
  return /^[0-9a-f]{8}$/.test(normalized);
}

/** The stored hash of a 0.11.0 code. */
export function recoveryCodeHash(
  crypto: Pick<CryptoService, 'sha256'>,
  code: string,
): string {
  return RECOVERY_CODE_V2_PREFIX + crypto.sha256(normalizeRecoveryCode(code));
}

/** The pre-0.11.0 stored hash: unsalted SHA-256 of the lower-case code. */
export function legacyRecoveryCodeHash(
  crypto: Pick<CryptoService, 'sha256'>,
  normalized: string,
): string {
  return crypto.sha256(normalized);
}

/** A stored hash still in the pre-0.11.0 format (not rewrapped). */
export function isLegacyRecoveryCodeHash(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored);
}

/** A stored hash of a pre-0.11.0 code, rewrapped or not. */
export function isOldFormatRecoveryCodeHash(stored: string): boolean {
  return (
    isLegacyRecoveryCodeHash(stored) ||
    stored.startsWith(RECOVERY_CODE_WRAPPED_PREFIX)
  );
}
