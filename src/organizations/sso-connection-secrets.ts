import type { CryptoService } from '../crypto/crypto.service.js';
import {
  openSecretJson,
  redactSecretJson,
  sealSecretJson,
  type SecretJsonShape,
} from '../crypto/stored-secrets.js';

/**
 * Key names (lowercased, letters and digits only) that end a secret's name.
 * The connection config has no fixed shape, so a key is a secret when its
 * normalized name ends with one of these, so `clientSecret`,
 * `client_secret`, `bindPassword`, `privateKey` and `sp-private-key-pem` all
 * are, while `tokenUrl` and `publicKey` are not. Everything under a secret
 * key (an object or an array) is secret as well.
 */
const SECRET_KEY_SUFFIXES = [
  'secret',
  'password',
  'passphrase',
  'privatekey',
  'privatekeypem',
  'signingkey',
  'signingkeypem',
  'encryptionkey',
  'decryptionkey',
  'token',
  'apikey',
  'credential',
  'credentials',
] as const;

/** Lowercase letters and digits of `key`, without a regular expression. */
function normalizeKey(key: string): string {
  let out = '';
  for (const ch of key.toLowerCase()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) out += ch;
  }
  return out;
}

export function isSsoSecretKey(key: string): boolean {
  const name = normalizeKey(key);
  return SECRET_KEY_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export const SSO_CONFIG_SHAPE: SecretJsonShape = {
  isSecretKey: isSsoSecretKey,
};

/**
 * OrganizationSsoConnection.config: the secrets in it (see
 * SECRET_KEY_SUFFIXES) are encrypted at rest and shown as the placeholder;
 * the rest stays readable. Nothing signs anyone in through these
 * connections yet; `config` is what such code must read them with.
 */
export const ssoConnectionSecrets = {
  /**
   * The config to store from what the client sent. It replaces the stored
   * one; a secret sent back as the placeholder keeps the stored value at the
   * same path.
   */
  forWrite(
    crypto: CryptoService,
    incoming: Record<string, unknown>,
    stored?: unknown,
  ): Record<string, unknown> {
    return sealSecretJson(crypto, incoming, SSO_CONFIG_SHAPE, stored) as Record<
      string,
      unknown
    >;
  },

  /** A connection row as the admin API returns it. */
  redact<T extends { config?: unknown }>(connection: T): T {
    if (connection.config === undefined) return connection;
    return {
      ...connection,
      config: redactSecretJson(connection.config, SSO_CONFIG_SHAPE),
    };
  },

  /** The config with its secrets decrypted, for the code that uses them. */
  config(crypto: CryptoService, connection: { config: unknown }): unknown {
    return openSecretJson(crypto, connection.config, SSO_CONFIG_SHAPE);
  },
};
