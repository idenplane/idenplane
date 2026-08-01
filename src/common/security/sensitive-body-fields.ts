/**
 * Canonical list of top-level request-body field names that must never
 * reach logs or the admin audit trail verbatim. Shared by the pino HTTP
 * logger (src/common/logging/logger.config.ts) and AdminEventInterceptor
 * (src/events/admin-event.interceptor.ts) so the two redaction points can't
 * drift out of sync with each other.
 *
 * `emailProviderConfig` and `smsProviderConfig` are redacted wholesale
 * (the whole nested object, not just specific sub-keys) because the secret
 * lives at a different path per provider (e.g. `resend.apiKey` vs.
 * `postmark.serverToken`), and both redaction mechanisms here only match on
 * top-level key name.
 */
export const SENSITIVE_BODY_FIELDS = [
  'password',
  'clientSecret',
  'client_secret',
  'smtpPassword',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'recaptchaSecretKey',
  'hcaptchaSecretKey',
  'emailProviderConfig',
  'smsProviderConfig',
] as const;
