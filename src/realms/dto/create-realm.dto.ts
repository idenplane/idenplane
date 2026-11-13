import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  Min,
  Max,
  MinLength,
  Matches,
  NotContains,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  EmailProviderType,
  EmailProviderConfigDto,
} from '../../email/dto/email-config.dto.js';
import { SmsProviderType } from '../../sms/dto/sms-config.dto.js';
import { RealmSmsProviderConfigDto } from './sms-config.dto.js';
import { CAPTCHA_PROVIDERS } from '../../captcha/captcha-config.js';
import {
  PLACEHOLDER_TYPED_OVER,
  SECRET_PLACEHOLDER,
} from '../secret-placeholder.js';

export class CreateRealmDto {
  @ApiProperty({ example: 'my-app' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: 'Realm name must be a lowercase slug (e.g. "my-app")',
  })
  name!: string;

  @ApiPropertyOptional({ example: 'My Application' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: 300 })
  @IsOptional()
  @IsInt()
  @Min(60)
  accessTokenLifespan?: number;

  @ApiPropertyOptional({ default: 1800 })
  @IsOptional()
  @IsInt()
  @Min(60)
  refreshTokenLifespan?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtpHost?: string;

  @ApiPropertyOptional({ default: 587 })
  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtpUser?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtpFrom?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @ApiPropertyOptional({
    description: 'Email provider to use',
    enum: EmailProviderType,
    default: EmailProviderType.SMTP,
  })
  @IsOptional()
  @IsEnum(EmailProviderType)
  emailProvider?: EmailProviderType;

  @ApiPropertyOptional({
    description: 'Provider-specific email configuration',
    type: EmailProviderConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmailProviderConfigDto)
  emailProviderConfig?: EmailProviderConfigDto;

  // Password policies
  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  passwordMinLength?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  passwordRequireUppercase?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  passwordRequireLowercase?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  passwordRequireDigits?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  passwordRequireSpecialChars?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  passwordHistoryCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  passwordMaxAgeDays?: number;

  // Brute force
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  bruteForceEnabled?: boolean;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxLoginFailures?: number;

  @ApiPropertyOptional({ default: 900 })
  @IsOptional()
  @IsInt()
  @Min(1)
  lockoutDuration?: number;

  @ApiPropertyOptional({ default: 600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  failureResetTime?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  permanentLockoutAfter?: number;

  // Registration
  @ApiPropertyOptional({
    default: true,
    description: 'Allow self-service user registration',
  })
  @IsOptional()
  @IsBoolean()
  registrationAllowed?: boolean;

  // Email verification
  @ApiPropertyOptional({
    default: false,
    description: 'Require email verification before login',
  })
  @IsOptional()
  @IsBoolean()
  requireEmailVerification?: boolean;

  // Magic link / passwordless authentication
  @ApiPropertyOptional({
    default: false,
    description: 'Enable magic link / passwordless email authentication',
  })
  @IsOptional()
  @IsBoolean()
  magicLinkEnabled?: boolean;

  @ApiPropertyOptional({
    default: 600,
    description: 'Magic link expiry in seconds (default 10 minutes)',
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  magicLinkExpirySeconds?: number;

  @ApiPropertyOptional({
    default: 3,
    description: 'Max magic link requests per email per rate limit window',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  magicLinkRateLimitPerEmail?: number;

  @ApiPropertyOptional({
    default: 900,
    description: 'Magic link rate limit window in seconds (default 15 minutes)',
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  magicLinkRateLimitWindowSeconds?: number;

  @ApiPropertyOptional({ description: 'Magic link email subject template' })
  @IsOptional()
  @IsString()
  magicLinkEmailSubject?: string;

  @ApiPropertyOptional({
    description:
      'Magic link email body template (supports {{link}} and {{email}} placeholders)',
  })
  @IsOptional()
  @IsString()
  magicLinkEmailTemplate?: string;

  // MFA
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  // Offline tokens
  @ApiPropertyOptional({ default: 2592000 })
  @IsOptional()
  @IsInt()
  @Min(60)
  offlineTokenLifespan?: number;

  // Events configuration
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  eventsEnabled?: boolean;

  @ApiPropertyOptional({ default: 604800 })
  @IsOptional()
  @IsInt()
  @Min(60)
  eventsExpiration?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  adminEventsEnabled?: boolean;

  // Rate limiting
  @ApiPropertyOptional({
    default: false,
    description: 'Enable per-client/user/IP rate limiting',
  })
  @IsOptional()
  @IsBoolean()
  rateLimitEnabled?: boolean;

  @ApiPropertyOptional({
    default: 60,
    description: 'Max token requests per minute per OAuth client',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerMinute?: number;

  @ApiPropertyOptional({
    default: 1000,
    description: 'Max token requests per hour per OAuth client',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerHour?: number;

  @ApiPropertyOptional({
    default: 30,
    description: 'Max admin API requests per minute per user',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userRateLimitPerMinute?: number;

  @ApiPropertyOptional({
    default: 500,
    description: 'Max admin API requests per hour per user',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userRateLimitPerHour?: number;

  @ApiPropertyOptional({
    default: 20,
    description: 'Max login requests per minute per IP address',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  ipRateLimitPerMinute?: number;

  @ApiPropertyOptional({
    default: 200,
    description: 'Max login requests per hour per IP address',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  ipRateLimitPerHour?: number;

  // Session management
  @ApiPropertyOptional({
    default: 10,
    description:
      'Maximum number of concurrent active sessions per user (oldest session is evicted when the limit is reached, 0 = unlimited)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxSessionsPerUser?: number;

  // Theming
  @ApiPropertyOptional({
    default: 'idenplane',
    description: 'Name of the theme preset to use',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  themeName?: string;

  @ApiPropertyOptional({
    description: 'Realm theme configuration (color overrides)',
  })
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @ApiPropertyOptional({
    default: 'idenplane',
    description: 'Login page theme',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  loginTheme?: string;

  @ApiPropertyOptional({
    default: 'idenplane',
    description: 'Account page theme',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  accountTheme?: string;

  @ApiPropertyOptional({
    default: 'idenplane',
    description: 'Email template theme',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  emailTheme?: string;

  // Impersonation
  @ApiPropertyOptional({
    default: false,
    description: 'Allow admin impersonation of users',
  })
  @IsOptional()
  @IsBoolean()
  impersonationEnabled?: boolean;

  @ApiPropertyOptional({
    default: 3600,
    description: 'Max duration (seconds) of an impersonation session',
  })
  @IsOptional()
  @IsInt()
  impersonationMaxDuration?: number;

  // WebAuthn / passkeys
  @ApiPropertyOptional({
    default: false,
    description: 'Enable WebAuthn / passkey authentication',
  })
  @IsOptional()
  @IsBoolean()
  webAuthnEnabled?: boolean;

  @ApiPropertyOptional({ description: 'WebAuthn Relying Party display name' })
  @IsOptional()
  @IsString()
  webAuthnRpName?: string;

  @ApiPropertyOptional({
    description: 'WebAuthn Relying Party ID (origin domain)',
  })
  @IsOptional()
  @IsString()
  webAuthnRpId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Require WebAuthn user verification (biometric or PIN) on registration and login',
  })
  @IsOptional()
  @IsBoolean()
  webAuthnUserVerificationRequired?: boolean;

  // SMS provider + OTP (the admin UI's SMS tab)
  @ApiPropertyOptional({
    default: false,
    description:
      'Offer SMS one-time codes as an MFA method. Not yet enforced at login.',
  })
  @IsOptional()
  @IsBoolean()
  smsMfaEnabled?: boolean;

  @ApiPropertyOptional({ enum: SmsProviderType, default: SmsProviderType.NONE })
  @IsOptional()
  @IsEnum(SmsProviderType)
  smsProvider?: SmsProviderType;

  @ApiPropertyOptional({
    description:
      "Sender ID or phone number. Falls back to the provider's env variable.",
  })
  @IsOptional()
  @IsString()
  smsFrom?: string;

  @ApiPropertyOptional({ type: () => RealmSmsProviderConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RealmSmsProviderConfigDto)
  smsProviderConfig?: RealmSmsProviderConfigDto;

  @ApiPropertyOptional({ description: 'OTP code length (digits)', default: 6 })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(8)
  otpLength?: number;

  @ApiPropertyOptional({
    description: 'OTP code lifetime in seconds',
    default: 300,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  otpExpirySeconds?: number;

  @ApiPropertyOptional({
    description: 'Maximum SMS codes a user can request per rate-limit window',
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  smsMaxRequestsPerUser?: number;

  @ApiPropertyOptional({
    description: 'SMS rate-limit window in seconds',
    default: 900,
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  smsRateLimitWindow?: number;

  // Adaptive authentication
  @ApiPropertyOptional({
    default: false,
    description: 'Enable AI-powered adaptive / risk-based authentication',
  })
  @IsOptional()
  @IsBoolean()
  adaptiveAuthEnabled?: boolean;

  @ApiPropertyOptional({
    default: 70,
    description: 'Risk score threshold (0-100) that triggers step-up MFA',
  })
  @IsOptional()
  @IsInt()
  riskThresholdStepUp?: number;

  @ApiPropertyOptional({
    default: 90,
    description: 'Risk score threshold (0-100) that blocks the login attempt',
  })
  @IsOptional()
  @IsInt()
  riskThresholdBlock?: number;

  // Localisation
  @ApiPropertyOptional({
    default: 'en',
    description: 'Default locale for this realm',
  })
  @IsOptional()
  @IsString()
  defaultLocale?: string;

  @ApiPropertyOptional({
    description: 'List of locales supported by this realm',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedLocales?: string[];

  // Legal / registration controls
  @ApiPropertyOptional({
    description: 'URL to the terms-of-service page shown during registration',
  })
  @IsOptional()
  @IsString()
  termsOfServiceUrl?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Require admin approval before a self-registered account is activated',
  })
  @IsOptional()
  @IsBoolean()
  registrationApprovalRequired?: boolean;

  @ApiPropertyOptional({
    description:
      'Whitelist of email domains permitted to self-register (empty = all allowed)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  @ApiPropertyOptional({
    description: 'URL to the privacy policy page shown during registration',
  })
  @IsOptional()
  @IsString()
  privacyPolicyUrl?: string;

  // CAPTCHA configuration
  @ApiPropertyOptional({
    default: false,
    description: 'Enable CAPTCHA protection for registration',
  })
  @IsOptional()
  @IsBoolean()
  captchaEnabled?: boolean;

  @ApiPropertyOptional({
    enum: [...CAPTCHA_PROVIDERS],
    description:
      'CAPTCHA provider to use. Required, with its site key and secret key, when captchaEnabled is true.',
  })
  @IsOptional()
  @IsIn(CAPTCHA_PROVIDERS)
  captchaProvider?: string;

  @ApiPropertyOptional({ description: 'reCAPTCHA site key for v3' })
  @IsOptional()
  @IsString()
  recaptchaSiteKey?: string;

  @ApiPropertyOptional({
    description:
      'reCAPTCHA secret key for v3 verification (write-only: returned as the hidden-value placeholder, which on update means "unchanged")',
  })
  @IsOptional()
  @ValidateIf(
    (o: CreateRealmDto) => o.recaptchaSecretKey !== SECRET_PLACEHOLDER,
  )
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  recaptchaSecretKey?: string;

  @ApiPropertyOptional({ description: 'hCaptcha site key' })
  @IsOptional()
  @IsString()
  hcaptchaSiteKey?: string;

  @ApiPropertyOptional({
    description:
      'hCaptcha secret key for verification (write-only: returned as the hidden-value placeholder, which on update means "unchanged")',
  })
  @IsOptional()
  @ValidateIf((o: CreateRealmDto) => o.hcaptchaSecretKey !== SECRET_PLACEHOLDER)
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  hcaptchaSecretKey?: string;

  @ApiPropertyOptional({
    default: 0.5,
    description: 'Minimum score threshold for reCAPTCHA v3 (0-1)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  captchaScoreThreshold?: number;

  // SCIM provisioning
  @ApiPropertyOptional({
    default: false,
    description: 'Enable SCIM provisioning for this realm',
  })
  @IsOptional()
  @IsBoolean()
  scimEnabled?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Automatically create users on SCIM provision if they do not exist',
  })
  @IsOptional()
  @IsBoolean()
  scimUserAutocreate?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Sync SCIM group membership changes to realm groups',
  })
  @IsOptional()
  @IsBoolean()
  scimGroupSyncEnabled?: boolean;

  // Event retention
  @ApiPropertyOptional({
    default: 30,
    description: 'Number of days to retain login event records',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  loginEventRetentionDays?: number;

  @ApiPropertyOptional({
    default: 90,
    description: 'Number of days to retain admin event records',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  adminEventRetentionDays?: number;

  // User lifecycle
  @ApiPropertyOptional({
    default: 14,
    description:
      'Grace period in days before a soft-deleted user account is permanently removed',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  deletionGracePeriodDays?: number;

  // RFC 8705 certificate client authentication
  @ApiPropertyOptional({
    default: false,
    description:
      'Accept tls_client_auth and self_signed_tls_client_auth for this realm. Takes effect only when the server runs with MTLS_ENABLED=true.',
  })
  @IsOptional()
  @IsBoolean()
  mtlsClientAuthEnabled?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Also trust the CAs in MTLS_GLOBAL_TRUST_ANCHORS_FILE for tls_client_auth, besides the realm’s own trust anchors.',
  })
  @IsOptional()
  @IsBoolean()
  mtlsTrustGlobalAnchors?: boolean;
}
