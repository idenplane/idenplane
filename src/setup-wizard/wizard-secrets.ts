import type { WizardState } from '@prisma/client';
import type { CryptoService } from '../crypto/crypto.service.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';
import { redactSecret, sealSecret } from '../crypto/stored-secrets.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The SMTP settings the API returns, with the password as the placeholder. */
export interface PublicSmtpConfig {
  host: unknown;
  port: unknown;
  user: unknown;
  password: string | undefined;
  from: unknown;
  secure: unknown;
}

/** The wizard state the API returns. */
export interface PublicWizardState {
  id: string;
  completed: boolean;
  skipped: boolean;
  currentStep: number;
  adminUsername: string | null;
  adminEmail: string | null;
  realmName: string | null;
  realmDisplayName: string | null;
  smtpConfig: PublicSmtpConfig | null;
  clientId: string | null;
  redirectUris: string[];
  sdkGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function publicSmtpConfig(config: unknown): PublicSmtpConfig | null {
  if (!isRecord(config)) return null;
  const password = config['password'];
  return {
    host: config['host'],
    port: config['port'],
    user: config['user'],
    password:
      typeof password === 'string' && password
        ? redactSecret(password)
        : undefined,
    from: config['from'],
    secure: config['secure'],
  };
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
   * A wizard state as the API returns it. An allowlist, so a column added to
   * WizardState later stays private until it is listed here: never the
   * admin's password hash, never the legacy `clientSecret` column, and the
   * SMTP password only as the placeholder.
   */
  publicState(state: WizardState): PublicWizardState {
    return {
      id: state.id,
      completed: state.completed,
      skipped: state.skipped,
      currentStep: state.currentStep,
      adminUsername: state.adminUsername,
      adminEmail: state.adminEmail,
      realmName: state.realmName,
      realmDisplayName: state.realmDisplayName,
      smtpConfig: publicSmtpConfig(state.smtpConfig),
      clientId: state.clientId,
      redirectUris: state.redirectUris,
      sdkGenerated: state.sdkGenerated,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  },
};
