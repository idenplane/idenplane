import { pbkdf2Sync, randomBytes } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';
import { CryptoService } from '../crypto.service.js';
import { PasswordVerificationService } from '../password-verification.service.js';
import { encodePbkdf2, type Pbkdf2Digest } from '../password-hash-formats.js';

/**
 * Real password hashes in the formats a migrated user can have (what the
 * Keycloak, Auth0, Authentik and Zitadel importers write), for tests of
 * every place that checks a password. Cheap parameters so tests stay fast.
 */

// Test passwords only; never real credentials.
export const PASSWORD = 'correct-horse-example-1';
export const WRONG = 'wrong-horse-example-2';

const KEY_BYTES: Record<Pbkdf2Digest, number> = {
  sha1: 20,
  sha256: 64, // Keycloak derives 512 bits whatever the digest
  sha512: 64,
};

/** Raw PBKDF2 parts, as an importer would read them from the source IdP. */
export function pbkdf2(
  digest: Pbkdf2Digest,
  password = PASSWORD,
  iterations = 1000,
): { salt: Buffer; hash: Buffer; iterations: number } {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(
    password,
    salt,
    iterations,
    KEY_BYTES[digest],
    digest,
  );
  return { salt, hash, iterations };
}

/** A PHC PBKDF2 hash (`$pbkdf2-sha256$i=…`), as the importers store it. */
export function pbkdf2Hash(
  digest: Pbkdf2Digest = 'sha256',
  password = PASSWORD,
): string {
  return encodePbkdf2({ digest, ...pbkdf2(digest, password) });
}

/**
 * A row as the Keycloak importer wrote it before 0.11.0:
 * `<iterations>$<salt>$<hash>`, which names no algorithm. Stored with
 * `passwordAlgorithm` `pbkdf2-sha256` although the key is SHA-512, so it
 * verifies only if the caller passes the user's `passwordAlgorithm` along.
 */
export function legacyKeycloakRow(password = PASSWORD): string {
  const { salt, hash, iterations } = pbkdf2('sha512', password);
  return `${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** A bcrypt hash (`$2b$04$…`), as Auth0 and Zitadel imports store it. */
export function bcryptHash(password = PASSWORD): string {
  return bcryptjs.hashSync(password, 4);
}

/**
 * The real shared verifier, with a real CryptoService and a stub Prisma
 * whose `user.updateMany` records the rehash-on-success write.
 */
export function realPasswordVerifier(): {
  passwords: PasswordVerificationService;
  updateMany: jest.Mock;
} {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const passwords = new PasswordVerificationService(new CryptoService(), {
    user: { updateMany },
  } as never);
  return { passwords, updateMany };
}
