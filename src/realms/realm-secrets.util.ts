import type { CryptoService } from '../crypto/crypto.service.js';
import type { EmailProviderConfigDto } from '../email/dto/email-config.dto.js';

/**
 * Encrypt the API-key/token sub-fields of a per-provider email config before
 * it's persisted. `from`/`domain`/`region` stay plaintext — they're not
 * secrets and admins need to see them back in the API response.
 *
 * Idempotent: `crypto.encryptSecret` leaves an already-encrypted value
 * untouched, so re-running this (e.g. on a config round-tripped unchanged
 * through a GET+PATCH, or from the one-shot backfill script) is safe.
 */
export function encryptEmailProviderConfig(
  crypto: CryptoService,
  config: EmailProviderConfigDto | Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!config) return undefined;

  const cfg = config as Record<string, Record<string, unknown> | undefined>;
  const encrypted: Record<string, unknown> = { ...cfg };

  if (cfg['resend']) {
    encrypted['resend'] = {
      ...cfg['resend'],
      apiKey: crypto.encryptSecret(
        cfg['resend']['apiKey'] as string | undefined,
      ),
    };
  }
  if (cfg['sendgrid']) {
    encrypted['sendgrid'] = {
      ...cfg['sendgrid'],
      apiKey: crypto.encryptSecret(
        cfg['sendgrid']['apiKey'] as string | undefined,
      ),
    };
  }
  if (cfg['mailgun']) {
    encrypted['mailgun'] = {
      ...cfg['mailgun'],
      apiKey: crypto.encryptSecret(
        cfg['mailgun']['apiKey'] as string | undefined,
      ),
    };
  }
  if (cfg['postmark']) {
    encrypted['postmark'] = {
      ...cfg['postmark'],
      serverToken: crypto.encryptSecret(
        cfg['postmark']['serverToken'] as string | undefined,
      ),
    };
  }
  return encrypted;
}
