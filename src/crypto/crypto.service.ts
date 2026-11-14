import {
  Injectable,
  Logger,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  randomBytes,
  createHash,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from 'crypto';
import {
  effectiveCpuCount,
  workerCount,
} from '../common/utils/cpu-count.util.js';
import { createConcurrencyLimiter } from '../common/utils/concurrency-limiter.util.js';
import {
  DEFAULT_WEBHOOK_ENCRYPTION_SALT,
  DEFAULT_WEBHOOK_SECRET_KEY,
  isEnvelope,
  keyRingFromEnv,
  parseEnvelope,
  seal,
  tryOpen,
  UnreadableSecretError,
  type KeyRing,
  type KeySlot,
} from './key-ring.js';

/** Maximum password length accepted by hashPassword / verifyPassword.
 *  Argon2 has no built-in length limit; feeding it a multi-megabyte string
 *  causes CPU exhaustion (DoS).  1 024 characters is a generous practical
 *  limit that covers every legitimate password while bounding hashing time.
 */
const MAX_PASSWORD_LENGTH = 1024;

/**
 * Argon2id with memoryCost: 65536 (64 MiB) allocates real memory per call.
 * With no cap, a burst of concurrent logins/registrations can drive
 * unbounded memory/CPU pressure. One in-flight hash per CPU core keeps the
 * server responsive under load; excess calls queue instead of piling on.
 * Overridable via ARGON2_MAX_CONCURRENCY for environments that need to tune
 * it (e.g. containers with a CPU limit below the host's core count).
 */
// The CPUs this container may use (cpuset and quota, see effectiveCpuCount),
// shared out between cluster workers: together they keep one hash per core.
const DEFAULT_ARGON2_MAX_CONCURRENCY = Math.max(
  1,
  Math.floor(effectiveCpuCount() / workerCount()),
);

/** Storage prefix for fast-hashed generated secrets; see hashSecret. */
const SHA256_SECRET_PREFIX = 'sha256$';

/** The shape generateSecret() returns by default: 32 random bytes as hex. */
const isGeneratedSecret = (secret: string): boolean =>
  /^[0-9a-f]{64}$/.test(secret);

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);

  /**
   * The keys that encrypt secrets at rest (see key-ring.ts): the current
   * one, derived with scrypt from WEBHOOK_SECRET_KEY and
   * WEBHOOK_ENCRYPTION_SALT, and during a rotation the previous one, from
   * WEBHOOK_SECRET_KEY_PREVIOUS / WEBHOOK_ENCRYPTION_SALT_PREVIOUS. Falls
   * back to a deterministic development key when the variable is absent;
   * production refuses to start without one.
   */
  private readonly keyRing: KeyRing = keyRingFromEnv(process.env);

  /** The current key: it encrypts, and keys {@link hmac}. */
  private readonly encryptionKey: Buffer = this.keyRing.current.key;

  /** Bounds concurrent Argon2 hash/verify calls; see DEFAULT_ARGON2_MAX_CONCURRENCY. */
  private readonly limitArgon2Concurrency = createConcurrencyLimiter(
    parseInt(
      process.env['ARGON2_MAX_CONCURRENCY'] ??
        String(DEFAULT_ARGON2_MAX_CONCURRENCY),
      10,
    ),
  );

  /**
   * True when WEBHOOK_SECRET_KEY and WEBHOOK_ENCRYPTION_SALT are both set to
   * something other than the built-in development defaults.
   */
  usesConfiguredKey(): boolean {
    const key = process.env['WEBHOOK_SECRET_KEY'];
    const salt = process.env['WEBHOOK_ENCRYPTION_SALT'];
    return (
      !!key &&
      key !== DEFAULT_WEBHOOK_SECRET_KEY &&
      !!salt &&
      salt !== DEFAULT_WEBHOOK_ENCRYPTION_SALT
    );
  }

  /** The id of the current key, as written in each envelope. */
  get currentKeyId(): string {
    return this.keyRing.current.id;
  }

  /** The id of the previous key, if one is configured. */
  get previousKeyId(): string | undefined {
    return this.keyRing.previous?.id;
  }

  /** A previous key is configured: a rotation may have values to move. */
  hasPreviousKey(): boolean {
    return this.keyRing.previous !== undefined;
  }

  onModuleInit(): void {
    if (this.keyRing.previousIsCurrent) {
      this.logger.warn(
        'WEBHOOK_SECRET_KEY_PREVIOUS / WEBHOOK_ENCRYPTION_SALT_PREVIOUS derive the same key as the current ones and are ignored; remove them.',
      );
    }
    const key = process.env['WEBHOOK_SECRET_KEY'];
    const salt = process.env['WEBHOOK_ENCRYPTION_SALT'];
    const isProduction = process.env['NODE_ENV'] === 'production';

    if (!key || key === DEFAULT_WEBHOOK_SECRET_KEY) {
      const msg =
        'WEBHOOK_SECRET_KEY is not set or is still the default placeholder value. ' +
        'Webhook secrets in the database are encrypted with an insecure key. ' +
        'Set WEBHOOK_SECRET_KEY to a strong random secret (e.g. `openssl rand -hex 32`).';
      if (isProduction) {
        this.logger.error(`SECURITY: ${msg}`);
        console.error(
          '\n\nFATAL: WEBHOOK_SECRET_KEY is not configured.\n' +
            'Set WEBHOOK_SECRET_KEY=<random> in your environment before starting the server.\n' +
            'Generate one with:  openssl rand -hex 32\n\n',
        );
        process.exit(1);
      } else {
        this.logger.warn(`SECURITY WARNING: ${msg}`);
      }
    }

    if (!salt || salt === DEFAULT_WEBHOOK_ENCRYPTION_SALT) {
      const saltMsg =
        'WEBHOOK_ENCRYPTION_SALT is not set or is still the default placeholder value. ' +
        'Set WEBHOOK_ENCRYPTION_SALT to a unique random value (e.g. `openssl rand -hex 16`).';
      if (isProduction) {
        this.logger.error(`SECURITY: ${saltMsg}`);
        console.error(
          '\n\nFATAL: WEBHOOK_ENCRYPTION_SALT is not configured.\n' +
            'Set WEBHOOK_ENCRYPTION_SALT=<random> in your environment before starting the server.\n' +
            'Generate one with:  openssl rand -hex 16\n\n',
        );
        process.exit(1);
      } else {
        this.logger.warn(`SECURITY WARNING: ${saltMsg}`);
      }
    }
  }

  async hashPassword(password: string): Promise<string> {
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new UnprocessableEntityException(
        `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`,
      );
    }
    return this.limitArgon2Concurrency(() =>
      argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      }),
    );
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    if (password.length > MAX_PASSWORD_LENGTH) {
      // Reject immediately — do not pass an oversized input to Argon2.
      // Return false rather than throwing so callers treat it as a bad
      // credential (no information about the limit is leaked to the client
      // beyond the normal "invalid credentials" response).
      return false;
    }
    return this.limitArgon2Concurrency(() => argon2.verify(hash, password));
  }

  generateSecret(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  /**
   * Hash a client secret or API key for storage.
   *
   * A value in the shape {@link generateSecret} produces (64 hex characters,
   * 256 random bits) is stored as `sha256$<hex>`: no attacker can enumerate
   * 2^256 candidates, so a slow hash adds nothing but cost, and these values
   * are checked on every token, introspection or API request. Anything else
   * (a secret imported from another IdP, possibly chosen by a person) gets
   * Argon2id like a password.
   */
  async hashSecret(secret: string): Promise<string> {
    return isGeneratedSecret(secret)
      ? `${SHA256_SECRET_PREFIX}${this.sha256(secret)}`
      : this.hashPassword(secret);
  }

  /**
   * Check a presented secret against a value from {@link hashSecret} (or an
   * Argon2 hash written before it existed). Dispatches on the stored format.
   * Anything else in the column fails closed instead of throwing.
   *
   * `rehash` is set when the secret matched but is not stored the way
   * {@link hashSecret} would store it now. Callers write it back,
   * conditionally on the stored value being unchanged.
   */
  async verifySecret(
    stored: string,
    presented: string,
  ): Promise<{ valid: boolean; rehash?: string }> {
    if (presented.length > MAX_PASSWORD_LENGTH) return { valid: false };

    let valid: boolean;
    if (stored.startsWith(SHA256_SECRET_PREFIX)) {
      const expected = Buffer.from(
        stored.slice(SHA256_SECRET_PREFIX.length),
        'hex',
      );
      const actual = createHash('sha256').update(presented).digest();
      valid =
        expected.length === actual.length && timingSafeEqual(expected, actual);
    } else if (stored.startsWith('$argon2')) {
      valid = await this.verifyPassword(stored, presented);
    } else {
      this.logger.warn(
        'A stored secret is in no recognized hash format; rejecting it.',
      );
      return { valid: false };
    }

    if (!valid) return { valid: false };
    const fast = isGeneratedSecret(presented);
    const storedFast = stored.startsWith(SHA256_SECRET_PREFIX);
    return fast === storedFast
      ? { valid: true }
      : { valid: true, rehash: await this.hashSecret(presented) };
  }

  /** True if `value` is something {@link hashSecret} could have produced. */
  isSecretHash(value: string): boolean {
    return /^sha256\$[0-9a-f]{64}$/.test(value) || value.startsWith('$argon2');
  }

  sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /** Per-purpose HMAC keys, derived once from the encryption key. */
  private readonly hmacKeys = new Map<string, Buffer>();

  /**
   * Keyed hash for low-entropy values (one-time codes, phone numbers) that a
   * plain sha256 would not protect: anyone holding a database dump can hash
   * every 6-digit code or phone number and match. The key never leaves this
   * service and is derived with HKDF under `purpose`, so a hash made for one
   * purpose can't be replayed as another. Hex output, fixed length.
   *
   * Always keyed by the current key. After a key rotation, values hashed
   * before it (pending one-time codes, flow sign-in links, the SMS per-phone
   * and per-IP rate-limit windows) no longer match: codes and links fail
   * closed and must be requested again. All of them are short-lived.
   */
  hmac(purpose: string, data: string): string {
    let key = this.hmacKeys.get(purpose);
    if (!key) {
      key = Buffer.from(
        hkdfSync(
          'sha256',
          this.encryptionKey,
          Buffer.alloc(0),
          `idenplane:hmac:${purpose}`,
          32,
        ),
      );
      this.hmacKeys.set(purpose, key);
    }
    return createHmac('sha256', key).update(data, 'utf8').digest('hex');
  }

  /**
   * Encrypt a plaintext string with AES-256-GCM under the current key.
   *
   * Output: `ek1.<key id>.<base64(iv | tag | ciphertext)>` (see key-ring.ts).
   * A fresh random IV is generated on every call, so encrypting the same
   * plaintext twice will produce different ciphertext.
   */
  encrypt(plaintext: string): string {
    return seal(this.keyRing, plaintext);
  }

  /**
   * Decrypt a value produced by {@link encrypt}, or by an older version (no
   * key id), with the current or the previous key. Throws if no configured
   * key opens it (another key, plaintext, or tampering).
   */
  decrypt(ciphertext: string): string {
    const opened = tryOpen(this.keyRing, ciphertext);
    if (opened) return opened.plaintext;
    const envelope = parseEnvelope(ciphertext);
    if (envelope) throw new UnreadableSecretError(envelope.keyId);
    throw new Error('Unsupported state or unable to authenticate data');
  }

  /**
   * Decrypt with whichever configured key `value` belongs to and say which
   * ('current' or 'previous'), or undefined if neither opens it.
   */
  open(value: string): { plaintext: string; slot: KeySlot } | undefined {
    return tryOpen(this.keyRing, value);
  }

  /** True for a value in the envelope format, whether or not it opens. */
  isEnvelope(value: string): boolean {
    return isEnvelope(value);
  }

  /**
   * True if `value` is ciphertext this service can decrypt, with the current
   * or the previous key. GCM's auth tag makes this reliable in both
   * directions: real ciphertext always decrypts, and plaintext can only fail
   * to decrypt (a false-positive would require forging the tag), so this
   * doubles as a "not already encrypted" check.
   */
  private isEncrypted(value: string): boolean {
    return tryOpen(this.keyRing, value) !== undefined;
  }

  /**
   * Encrypt a secret before writing it to the database, unless it is already
   * ciphertext (under the current or the previous key), e.g. a stored value
   * kept by an update. Nullish/empty values pass through so "field omitted"
   * and "clear the field" both behave as before. An envelope that no
   * configured key opens is ciphertext under another key: it is kept as it
   * is rather than encrypted a second time.
   */
  encryptSecret<T extends string | null | undefined>(value: T): T {
    if (!value) return value;
    if (this.isEncrypted(value)) return value;
    if (isEnvelope(value)) return value;
    return this.encrypt(value) as T;
  }

  /**
   * Decrypt a secret read from the database. Realms written before this
   * field was encrypted still hold plaintext; decrypt() can only fail closed
   * on those (it can't mistake plaintext for a valid ciphertext+tag), so
   * falling back to the raw value on failure is safe and lets old rows keep
   * working until they're next written (encryptSecret then encrypts them).
   *
   * An envelope (`ek1.…`) is never plaintext: one that no configured key
   * opens throws UnreadableSecretError rather than being used as the secret.
   */
  decryptSecret<T extends string | null | undefined>(value: T): T {
    if (!value) return value;
    const opened = tryOpen(this.keyRing, value);
    if (opened) return opened.plaintext as T;
    const envelope = parseEnvelope(value);
    if (envelope) throw new UnreadableSecretError(envelope.keyId);
    return value;
  }
}
