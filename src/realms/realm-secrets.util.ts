import type { CryptoService } from '../crypto/crypto.service.js';
import type { EmailProviderConfigDto } from '../email/dto/email-config.dto.js';
import { SMS_SECRET_FIELDS } from './dto/sms-config.dto.js';
import { SECRET_PLACEHOLDER } from './secret-placeholder.js';

/** The secret field of each email provider section. */
export const EMAIL_SECRET_FIELDS: Record<string, string> = {
  smtp: 'password',
  resend: 'apiKey',
  sendgrid: 'apiKey',
  mailgun: 'apiKey',
  postmark: 'serverToken',
};

/**
 * Build the `emailProviderConfig` to persist from what the client sent.
 *
 * The client sends the whole config, so it replaces the stored one — except
 * that a secret still holding SECRET_PLACEHOLDER (what the API handed out on
 * read) keeps the stored ciphertext. Every other secret is encrypted;
 * `encryptSecret` is idempotent, so ciphertext is left alone.
 */
export function encryptEmailProviderConfig(
  crypto: CryptoService,
  config: EmailProviderConfigDto | Record<string, unknown> | undefined | null,
  stored?: unknown,
): Record<string, unknown> | undefined {
  if (!config) return undefined;

  const incoming = config as Record<string, unknown>;
  const previous = isRecord(stored) ? stored : {};
  const out: Record<string, unknown> = { ...incoming };

  for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
    const values = incoming[section];
    if (!isRecord(values)) continue;
    const next: Record<string, unknown> = { ...values };
    const value = next[field];

    if (value === SECRET_PLACEHOLDER) {
      const prev = previous[section];
      const kept = isRecord(prev) ? prev[field] : undefined;
      if (typeof kept === 'string' && kept) {
        next[field] = crypto.encryptSecret(kept);
      } else {
        delete next[field];
      }
    } else if (typeof value === 'string' && value) {
      next[field] = crypto.encryptSecret(value);
    } else {
      delete next[field];
    }
    out[section] = next;
  }
  return out;
}

/** Replace each stored email provider secret with SECRET_PLACEHOLDER. */
export function redactEmailProviderConfig(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const out: Record<string, unknown> = { ...config };
  for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
    const values = out[section];
    if (isRecord(values) && values[field]) {
      out[section] = { ...values, [field]: SECRET_PLACEHOLDER };
    }
  }
  return out;
}

export { SECRET_PLACEHOLDER };

type SmsConfig = Record<string, unknown>;

/**
 * Build the `smsProviderConfig` to persist from what the client sent.
 *
 * The client sends the whole config, so it replaces the stored one — with one
 * exception: a secret field still holding SECRET_PLACEHOLDER (the value the
 * API handed out on read) keeps the stored ciphertext. Every other secret is
 * encrypted; `encryptSecret` is idempotent, so a value that is already
 * ciphertext is left alone.
 */
export function encryptSmsProviderConfig(
  crypto: CryptoService,
  incoming: SmsConfig | undefined | null,
  stored: unknown,
): SmsConfig | undefined {
  if (!incoming) return undefined;

  const previous = isRecord(stored) ? stored : {};
  const out: SmsConfig = { ...incoming };

  for (const field of SMS_SECRET_FIELDS) {
    const value = out[field];
    if (value === SECRET_PLACEHOLDER) {
      const kept = previous[field];
      // encryptSecret is idempotent: stored ciphertext stays as it is, and a
      // value that somehow got stored in plaintext is encrypted on this save.
      if (typeof kept === 'string' && kept) {
        out[field] = crypto.encryptSecret(kept);
      } else {
        delete out[field];
      }
    } else if (field === 'webhookHeaders' && isEmptyJson(value)) {
      // The form defaults this to '{}'. Storing that as a "secret" would show
      // every realm a masked headers field nobody ever filled in.
      delete out[field];
    } else if (typeof value === 'string') {
      out[field] = crypto.encryptSecret(value);
    }
  }
  return out;
}

/** Replace every stored SMS secret with SECRET_PLACEHOLDER for API responses. */
export function redactSmsProviderConfig(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const out: SmsConfig = { ...config };
  for (const field of SMS_SECRET_FIELDS) {
    if (out[field]) out[field] = SECRET_PLACEHOLDER;
  }
  return out;
}

/** Decrypt the SMS secrets of a stored config, for building a provider. */
export function decryptSmsProviderConfig(
  crypto: CryptoService,
  config: unknown,
): SmsConfig {
  if (!isRecord(config)) return {};
  const out: SmsConfig = { ...config };
  for (const field of SMS_SECRET_FIELDS) {
    if (typeof out[field] === 'string') {
      out[field] = crypto.decryptSecret(out[field]);
    }
  }
  return out;
}

/**
 * A stored provider config as a realm export carries it: each secret
 * decrypted (`includeSecrets`) or removed. Secrets of the email config sit
 * one level down, under the provider's section.
 */
export function exportProviderConfig(
  crypto: CryptoService,
  kind: 'email-provider' | 'sms-provider',
  config: unknown,
  includeSecrets: boolean,
): unknown {
  if (!isRecord(config)) return config;
  const reveal = (holder: Record<string, unknown>, field: string) => {
    if (!(field in holder)) return;
    if (includeSecrets && typeof holder[field] === 'string') {
      try {
        holder[field] = crypto.decryptSecret(holder[field]);
      } catch {
        // Encrypted with a key this instance no longer has: left out.
        delete holder[field];
      }
    } else {
      delete holder[field];
    }
  };
  const out: Record<string, unknown> = { ...config };
  if (kind === 'sms-provider') {
    for (const field of SMS_SECRET_FIELDS) reveal(out, field);
    return out;
  }
  for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
    const values = out[section];
    if (!isRecord(values)) continue;
    const copy = { ...values };
    reveal(copy, field);
    out[section] = copy;
  }
  return out;
}

/** The paths of the secrets a provider config holds, for import checks. */
export function providerConfigSecrets(
  kind: 'email-provider' | 'sms-provider',
  config: unknown,
): Array<{ path: string; value: unknown }> {
  if (!isRecord(config)) return [];
  if (kind === 'sms-provider') {
    return SMS_SECRET_FIELDS.filter((f) => f in config).map((f) => ({
      path: f,
      value: config[f],
    }));
  }
  const found: Array<{ path: string; value: unknown }> = [];
  for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
    const values = config[section];
    if (isRecord(values) && field in values) {
      found.push({ path: `${section}.${field}`, value: values[field] });
    }
  }
  return found;
}

function isEmptyJson(value: unknown): boolean {
  return typeof value === 'string' && ['', '{}', '[]'].includes(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
