import type { CryptoService } from '../crypto/crypto.service.js';
import {
  openSecret,
  redactSecret,
  sealSecret,
  sealSecretUpdate,
} from '../crypto/stored-secrets.js';

/**
 * IdentityProvider.clientSecret, encrypted at rest. Written encrypted by the
 * admin API, the realm import and the migration importers; shown as the
 * placeholder by the admin API; decrypted only for the broker's token
 * request.
 */
export const idpSecrets = {
  /** The column value for a new provider. */
  forCreate(crypto: CryptoService, clientSecret: string): string {
    return sealSecret(crypto, clientSecret);
  },

  /** The column value on update, or undefined to keep the stored secret. */
  forUpdate(
    crypto: CryptoService,
    clientSecret: string | undefined,
  ): string | undefined {
    return sealSecretUpdate(crypto, clientSecret);
  },

  /** A provider row as the admin API returns it. */
  redact<T extends { clientSecret?: string }>(idp: T): T {
    if (idp.clientSecret === undefined) return idp;
    return { ...idp, clientSecret: redactSecret(idp.clientSecret) };
  },

  /** The plaintext client secret, for the token request. */
  clientSecret(crypto: CryptoService, idp: { clientSecret: string }): string {
    return openSecret(crypto, idp.clientSecret);
  },
};
