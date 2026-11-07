/**
 * SMS providers a realm can be configured with. `none` disables SMS.
 *
 * The per-realm credentials themselves are validated by
 * `RealmSmsProviderConfigDto` (src/realms/dto/sms-config.dto.ts), which is the
 * shape the admin UI sends.
 */
export enum SmsProviderType {
  NONE = 'none',
  TWILIO = 'twilio',
  VONAGE = 'vonage',
  AWS_SNS = 'aws-sns',
  WEBHOOK = 'webhook',
}
