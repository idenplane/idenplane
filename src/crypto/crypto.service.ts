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
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'crypto';

/** Maximum password length accepted by hashPassword / verifyPassword.
 *  Argon2 has no built-in length limit; feeding it a multi-megabyte string
 *  causes CPU exhaustion (DoS).  1 024 characters is a generous practical
 *  limit that covers every legitimate password while bounding hashing time.
 */
const MAX_PASSWORD_LENGTH = 1024;

// Algorithm constants for AES-256-GCM symmetric encryption.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16; // 128-bit authentication tag

/** Default/placeholder values that must never be used in production. */
const DEFAULT_WEBHOOK_SECRET_KEY = 'dev-webhook-secret-key-replace-me';
const DEFAULT_WEBHOOK_ENCRYPTION_SALT = 'idenplane-webhook-salt';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);

  /**
   * 32-byte key derived from the WEBHOOK_SECRET_KEY environment variable.
   * The raw env value is run through scrypt so operators can supply any
   * length string without having to produce exactly 32 bytes themselves.
   * Falls back to a deterministic development key when the variable is
   * absent – startup should be blocked by env validation in production.
   */
  private readonly encryptionKey: Buffer = (() => {
    const raw = process.env['WEBHOOK_SECRET_KEY'] ?? DEFAULT_WEBHOOK_SECRET_KEY;
    // scrypt: N=2^14, r=8, p=1 → 32-byte key
    // Salt is read from WEBHOOK_ENCRYPTION_SALT so operators can rotate it;
    // falls back to the original hardcoded value for backwards compatibility.
    const salt =
      process.env['WEBHOOK_ENCRYPTION_SALT'] ?? DEFAULT_WEBHOOK_ENCRYPTION_SALT;
    return scryptSync(raw, salt, 32);
  })();

  onModuleInit(): void {
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
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    if (password.length > MAX_PASSWORD_LENGTH) {
      // Reject immediately — do not pass an oversized input to Argon2.
      // Return false rather than throwing so callers treat it as a bad
      // credential (no information about the limit is leaked to the client
      // beyond the normal "invalid credentials" response).
      return false;
    }
    return argon2.verify(hash, password);
  }

  generateSecret(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Encrypt a plaintext string with AES-256-GCM.
   *
   * Output format (base64-encoded):  <12-byte IV> | <ciphertext> | <16-byte tag>
   *
   * A fresh random IV is generated on every call, so encrypting the same
   * plaintext twice will produce different ciphertext.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Pack: iv (12) + tag (16) + ciphertext
    const packed = Buffer.concat([iv, tag, encrypted]);
    return packed.toString('base64');
  }

  /**
   * Decrypt a value produced by {@link encrypt}.
   * Throws if the authentication tag does not match (tampering detected).
   */
  decrypt(ciphertext: string): string {
    const packed = Buffer.from(ciphertext, 'base64');
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = packed.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }
}
