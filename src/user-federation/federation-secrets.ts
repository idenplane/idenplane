import type { CryptoService } from '../crypto/crypto.service.js';
import {
  openSecret,
  redactSecret,
  sealSecret,
  sealSecretUpdate,
} from '../crypto/stored-secrets.js';

/**
 * UserFederation.bindCredential (the LDAP bind password), encrypted at rest.
 * Written encrypted by the admin API and the realm import; shown as the
 * placeholder by the admin API; decrypted only to bind to the directory.
 */
export const federationSecrets = {
  /** The column value for a new federation. */
  forCreate(crypto: CryptoService, bindCredential: string): string {
    return sealSecret(crypto, bindCredential);
  },

  /** The column value on update, or undefined to keep the stored secret. */
  forUpdate(
    crypto: CryptoService,
    bindCredential: string | undefined,
  ): string | undefined {
    return sealSecretUpdate(crypto, bindCredential);
  },

  /** A federation row as the admin API returns it. */
  redact<T extends { bindCredential?: string }>(federation: T): T {
    if (federation.bindCredential === undefined) return federation;
    return {
      ...federation,
      bindCredential: redactSecret(federation.bindCredential),
    };
  },

  /** The plaintext bind password, for the LDAP bind. */
  bindCredential(
    crypto: CryptoService,
    federation: { bindCredential: string },
  ): string {
    return openSecret(crypto, federation.bindCredential);
  },
};
