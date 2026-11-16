import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService, MAX_PASSWORD_LENGTH } from './crypto.service.js';
import {
  isBcryptHash,
  parseLegacyPbkdf2,
  parsePbkdf2,
  verifyBcrypt,
  verifyPbkdf2,
} from './password-hash-formats.js';

/** What a stored password hash turned out to be. */
export type PasswordHashScheme =
  'argon2' | 'bcrypt' | 'pbkdf2' | 'legacy-pbkdf2' | 'unknown';

export interface StoredPassword {
  passwordHash: string | null;
  /** The user's `passwordAlgorithm` column; only legacy rows need it. */
  passwordAlgorithm?: string | null;
}

export interface PasswordCheck {
  valid: boolean;
  scheme: PasswordHashScheme;
  /** The password matched, but the hash is not Argon2id with today's parameters. */
  needsUpgrade: boolean;
}

/**
 * Checks a user's password against whatever hash is stored for them: the
 * single place every password sign-in goes through (hosted login page,
 * custom flows, the password grant, the device login page, the expired
 * password page).
 *
 * Dispatches on the stored format, never on what the caller expects:
 * Argon2 (`$argon2…`), bcrypt (`$2a$`/`$2b$`/`$2y$`), PBKDF2 with an
 * explicit digest and iteration count (`$pbkdf2-sha256$i=…`), and the
 * PBKDF2 rows importers wrote before 0.11.0. Every comparison is constant
 * time; a malformed hash is a wrong password, never an exception, so no
 * library message can reach a sign-in page and brute-force protection
 * counts the attempt.
 *
 * {@link verifyUserPassword} also moves a matched migrated hash to Argon2id.
 */
@Injectable()
export class PasswordVerificationService {
  private readonly logger = new Logger(PasswordVerificationService.name);

  constructor(
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Check `password` against a stored hash. Never throws. */
  async check(
    stored: StoredPassword,
    password: string,
  ): Promise<PasswordCheck> {
    const hash = stored.passwordHash;
    const no = (scheme: PasswordHashScheme): PasswordCheck => ({
      valid: false,
      scheme,
      needsUpgrade: false,
    });
    if (!hash || password.length > MAX_PASSWORD_LENGTH) return no('unknown');

    if (hash.startsWith('$argon2')) {
      if (!(await this.crypto.verifyPassword(hash, password))) {
        return no('argon2');
      }
      return {
        valid: true,
        scheme: 'argon2',
        needsUpgrade: this.crypto.argon2HashNeedsUpgrade(hash),
      };
    }

    if (isBcryptHash(hash)) {
      return (await verifyBcrypt(password, hash))
        ? { valid: true, scheme: 'bcrypt', needsUpgrade: true }
        : no('bcrypt');
    }

    if (hash.startsWith('$pbkdf2-')) {
      const parsed = parsePbkdf2(hash);
      if (parsed && (await verifyPbkdf2(password, parsed))) {
        return { valid: true, scheme: 'pbkdf2', needsUpgrade: true };
      }
      return no('pbkdf2');
    }

    const legacy = parseLegacyPbkdf2(hash, stored.passwordAlgorithm);
    if (legacy.length > 0) {
      for (const candidate of legacy) {
        if (await verifyPbkdf2(password, candidate)) {
          return { valid: true, scheme: 'legacy-pbkdf2', needsUpgrade: true };
        }
      }
      return no('legacy-pbkdf2');
    }

    return no('unknown');
  }

  /**
   * Check a user's password and, when it matches a hash that is not
   * Argon2id with today's parameters, store an Argon2id hash in its place.
   *
   * The upgrade is conditional on the stored hash being unchanged (a
   * concurrent password change wins) and best effort: a failure to write
   * it is logged and the sign-in goes on. Only `passwordHash` and
   * `passwordAlgorithm` change; password history and expiry do not.
   *
   * Callers check the account lock before calling this.
   */
  async verifyUserPassword(
    user: StoredPassword & { id: string },
    password: string,
  ): Promise<boolean> {
    const result = await this.check(user, password);
    if (result.valid && result.needsUpgrade) {
      await this.upgrade(user, password, result.scheme);
    }
    return result.valid;
  }

  private async upgrade(
    user: StoredPassword & { id: string },
    password: string,
    scheme: PasswordHashScheme,
  ): Promise<void> {
    try {
      const newHash = await this.crypto.hashPassword(password);
      const { count } = await this.prisma.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: newHash, passwordAlgorithm: 'argon2' },
      });
      if (count === 1) {
        this.logger.log(
          `Upgraded the password hash of user ${user.id} from ${scheme} to Argon2id`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not upgrade the password hash of user ${user.id} from ${scheme}: ` +
          (error as Error).message,
      );
    }
  }
}
