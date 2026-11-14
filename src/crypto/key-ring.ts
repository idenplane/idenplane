import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scryptSync,
} from 'crypto';

/**
 * The keys that encrypt secrets at rest: the current one, which encrypts,
 * and optionally the previous one, which only decrypts while a rotation
 * moves every stored value to the current key (SecretsAtRestService).
 *
 * Each key is derived with scrypt from a raw secret and a salt:
 * WEBHOOK_SECRET_KEY + WEBHOOK_ENCRYPTION_SALT for the current key,
 * WEBHOOK_SECRET_KEY_PREVIOUS + WEBHOOK_ENCRYPTION_SALT_PREVIOUS for the
 * previous one (either may be left out to reuse the current value).
 *
 * Ciphertext format, AES-256-GCM:
 *
 * - envelope (written from 0.8): `ek1.<key id>.<base64(iv | tag | data)>`,
 *   the `ek1.<key id>` prefix bound as additional authenticated data. The key
 *   id names the key, so decryption needs no trial and error.
 * - legacy (written before): `base64(iv | tag | data)`, no key id. Tried
 *   with the current key, then the previous one; the GCM tag makes a wrong
 *   key fail reliably.
 */

export const ALGORITHM = 'aes-256-gcm';
export const IV_BYTES = 12; // 96-bit IV recommended for GCM
export const TAG_BYTES = 16; // 128-bit authentication tag

/** Prefix of the envelope format; `.` is not a base64 character. */
export const ENVELOPE_PREFIX = 'ek1.';
/** Length of a key id: 4 bytes of HKDF output, as hex. */
export const KEY_ID_LENGTH = 8;

/** Default/placeholder values that must never be used in production. */
export const DEFAULT_WEBHOOK_SECRET_KEY = 'dev-webhook-secret-key-replace-me';
export const DEFAULT_WEBHOOK_ENCRYPTION_SALT = 'idenplane-webhook-salt';

export interface RingKey {
  /** Short public identifier, derived from the key (never key bytes). */
  readonly id: string;
  readonly key: Buffer;
}

export interface KeyRing {
  readonly current: RingKey;
  readonly previous?: RingKey;
  /** The previous key was configured but derives the same key as current. */
  readonly previousIsCurrent?: boolean;
}

/** Which ring key opened a value. */
export type KeySlot = 'current' | 'previous';

/** Thrown for a well-formed envelope that no key of the ring opens. */
export class UnreadableSecretError extends Error {
  constructor(keyId: string) {
    super(
      `A stored secret is encrypted with key ${keyId}, which is neither WEBHOOK_SECRET_KEY nor WEBHOOK_SECRET_KEY_PREVIOUS (or the value is damaged)`,
    );
    this.name = 'UnreadableSecretError';
  }
}

/** The 32-byte AES key for a raw secret and salt (scrypt N=2^14, r=8, p=1). */
export function deriveKey(raw: string, salt: string): Buffer {
  return scryptSync(raw, salt, 32);
}

/** The public id of a key: HKDF-SHA256 under its own label, 4 bytes, hex. */
export function keyIdOf(key: Buffer): string {
  return Buffer.from(
    hkdfSync('sha256', key, Buffer.alloc(0), 'idenplane:key-id', 4),
  ).toString('hex');
}

function ringKey(key: Buffer): RingKey {
  return { id: keyIdOf(key), key };
}

/** The key ring configured by these environment variables. */
export function keyRingFromEnv(env: NodeJS.ProcessEnv): KeyRing {
  const raw = env['WEBHOOK_SECRET_KEY'] ?? DEFAULT_WEBHOOK_SECRET_KEY;
  const salt =
    env['WEBHOOK_ENCRYPTION_SALT'] ?? DEFAULT_WEBHOOK_ENCRYPTION_SALT;
  const current = ringKey(deriveKey(raw, salt));

  const previousRaw = env['WEBHOOK_SECRET_KEY_PREVIOUS'] || undefined;
  const previousSalt = env['WEBHOOK_ENCRYPTION_SALT_PREVIOUS'] || undefined;
  if (!previousRaw && !previousSalt) return { current };
  const previous = ringKey(deriveKey(previousRaw ?? raw, previousSalt ?? salt));
  if (previous.key.equals(current.key)) {
    return { current, previousIsCurrent: true };
  }
  return { current, previous };
}

/** The parts of a well-formed envelope, or undefined for anything else. */
export function parseEnvelope(
  value: string,
): { keyId: string; aad: Buffer; packed: Buffer } | undefined {
  if (!value.startsWith(ENVELOPE_PREFIX)) return undefined;
  const dot = ENVELOPE_PREFIX.length + KEY_ID_LENGTH;
  if (value.charAt(dot) !== '.') return undefined;
  const keyId = value.slice(ENVELOPE_PREFIX.length, dot);
  for (const c of keyId) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return undefined;
  }
  const body = value.slice(dot + 1);
  const packed = Buffer.from(body, 'base64');
  // Canonical base64 only: Buffer.from skips characters it does not know.
  if (packed.length < IV_BYTES + TAG_BYTES) return undefined;
  if (packed.toString('base64') !== body) return undefined;
  return { keyId, aad: Buffer.from(value.slice(0, dot), 'utf8'), packed };
}

/** True for a value in the envelope format (whether or not it opens). */
export function isEnvelope(value: string): boolean {
  return parseEnvelope(value) !== undefined;
}

/** Encrypt under the current key, in the envelope format. */
export function seal(ring: KeyRing, plaintext: string): string {
  const prefix = `${ENVELOPE_PREFIX}${ring.current.id}`;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, ring.current.key, iv);
  cipher.setAAD(Buffer.from(prefix, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  return `${prefix}.${packed.toString('base64')}`;
}

function openPacked(key: Buffer, packed: Buffer, aad?: Buffer): string {
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = packed.subarray(IV_BYTES + TAG_BYTES);
  // The full 128-bit tag: without authTagLength, GCM accepts a tag as
  // short as 4 bytes, so a short plaintext value could pass for ciphertext
  // far more often than a forged full tag would.
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

function slots(ring: KeyRing): Array<[KeySlot, RingKey]> {
  return ring.previous
    ? [
        ['current', ring.current],
        ['previous', ring.previous],
      ]
    : [['current', ring.current]];
}

/**
 * Decrypt with whichever ring key the value belongs to, and say which; or
 * undefined if no ring key opens it (plaintext, another key, or damage).
 */
export function tryOpen(
  ring: KeyRing,
  value: string,
): { plaintext: string; slot: KeySlot } | undefined {
  const envelope = parseEnvelope(value);
  if (envelope) {
    // Both keys are tried only in the 1-in-2^32 case that their ids collide.
    for (const [slot, key] of slots(ring)) {
      if (key.id !== envelope.keyId) continue;
      try {
        return {
          plaintext: openPacked(key.key, envelope.packed, envelope.aad),
          slot,
        };
      } catch {
        // try the next key with this id
      }
    }
    return undefined;
  }
  const packed = Buffer.from(value, 'base64');
  if (packed.length < IV_BYTES + TAG_BYTES) return undefined;
  for (const [slot, key] of slots(ring)) {
    try {
      return { plaintext: openPacked(key.key, packed), slot };
    } catch {
      // try the next key
    }
  }
  return undefined;
}

/**
 * Shaped like ciphertext: an envelope, or canonical base64 of at least
 * IV (12) + tag (16) + 1 bytes (the legacy format). Checked without a
 * regular expression.
 */
export function looksEncrypted(value: string): boolean {
  if (isEnvelope(value)) return true;
  if (value.length < 40 || value.length % 4 !== 0) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= 29 && bytes.toString('base64') === value;
}
