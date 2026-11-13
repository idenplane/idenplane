import type { CryptoService } from './crypto.service.js';
import type { GeneratedKeyPair } from './jwk.service.js';
import { openSecret, sealSecret } from './stored-secrets.js';

/**
 * RealmSigningKey.privateKey (the realm's JWT and SAML signing key, PEM),
 * encrypted at rest. Every write of a key pair goes through `createData`;
 * the private key is decrypted once per process, by
 * CachedLookupsService.activeSigningKey, and kept in memory only.
 */
export const signingKeySecrets = {
  /** The nested `signingKeys.create` data for a new key pair. */
  createData(crypto: CryptoService, keyPair: GeneratedKeyPair) {
    return {
      kid: keyPair.kid,
      algorithm: 'RS256',
      publicKey: keyPair.publicKeyPem,
      privateKey: sealSecret(crypto, keyPair.privateKeyPem),
    };
  },

  /** The key pair with its private key encrypted, for code without crypto. */
  sealPair<T extends { privateKeyPem: string }>(
    crypto: CryptoService,
    keyPair: T,
  ): T {
    return {
      ...keyPair,
      privateKeyPem: sealSecret(crypto, keyPair.privateKeyPem),
    };
  },

  /** The plaintext private key PEM. */
  privateKeyPem(crypto: CryptoService, key: { privateKey: string }): string {
    return openSecret(crypto, key.privateKey);
  },
};
