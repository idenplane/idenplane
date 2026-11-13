import type { CryptoService } from '../crypto/crypto.service.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';
import { redactSecret, sealSecret } from '../crypto/stored-secrets.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * WizardState.smtpConfig.password, encrypted at rest with encryptSecret: the
 * same format as Realm.smtpPassword, which completing the wizard copies it
 * into unchanged. Shown as the placeholder; sent back as the placeholder it
 * keeps the stored password.
 */
export const wizardSecrets = {
  /** The SMTP password to store, from what the client sent. */
  smtpPassword(
    crypto: CryptoService,
    incoming: string | undefined,
    storedConfig: unknown,
  ): string | undefined {
    if (incoming === SECRET_PLACEHOLDER) {
      const kept = isRecord(storedConfig) ? storedConfig['password'] : null;
      return typeof kept === 'string' && kept
        ? crypto.encryptSecret(kept)
        : undefined;
    }
    return sealSecret(crypto, incoming);
  },

  /**
   * A wizard state as the API returns it: the SMTP password as the
   * placeholder, and never the admin's password hash.
   */
  redact<T extends { smtpConfig?: unknown; adminPasswordHash?: unknown }>(
    state: T,
  ): Omit<T, 'adminPasswordHash'> {
    const { adminPasswordHash: _hash, ...rest } = state;
    const config = rest.smtpConfig;
    if (!isRecord(config) || typeof config['password'] !== 'string') {
      return rest;
    }
    return {
      ...rest,
      smtpConfig: { ...config, password: redactSecret(config['password']) },
    };
  },
};
