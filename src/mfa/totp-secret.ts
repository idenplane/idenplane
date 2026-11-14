import type { CryptoService } from '../crypto/crypto.service.js';
import { openSecret, sealSecret } from '../crypto/stored-secrets.js';

/**
 * UserCredential.secretKey of a TOTP factor (the base32 seed), encrypted at
 * rest. Written once at enrolment and decrypted only to check a code.
 */
export const totpSecret = {
  /** The column value for a new TOTP credential. */
  forCreate(crypto: CryptoService, base32: string): string {
    return sealSecret(crypto, base32);
  },

  /** The base32 seed, for checking a code. */
  base32(crypto: CryptoService, credential: { secretKey: string }): string {
    return openSecret(crypto, credential.secretKey);
  },
};
