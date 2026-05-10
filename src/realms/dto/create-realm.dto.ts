import { IsString, IsOptional, IsBoolean, IsInt, IsArray, IsObject, IsEnum, Min, MinLength, Matches, Max, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
  @ApiPropertyOptional({ default: true, description: 'Allow self-service user registration' })
  @IsOptional()
  @IsBoolean()
  registrationAllowed?: boolean;

  // Email verification
  @ApiPropertyOptional({ default: false, description: 'Require email verification before login' })
  @IsOptional()
  @IsBoolean()
  requireEmailVerification?: boolean;

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
  @ApiPropertyOptional({ default: false, description: 'Enable per-client/user/IP rate limiting' })
  @IsOptional()
  @IsBoolean()
  rateLimitEnabled?: boolean;

  @ApiPropertyOptional({ default: 60, description: 'Max token requests per minute per OAuth client' })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerMinute?: number;

  @ApiPropertyOptional({ default: 1000, description: 'Max token requests per hour per OAuth client' })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerHour?: number;

  @ApiPropertyOptional({ default: 30, description: 'Max admin API requests per minute per user' })
  @IsOptional()
  @IsInt()
  @Min(1)
  userRateLimitPerMinute?: number;

  @ApiPropertyOptional({ default: 500, description: 'Max admin API requests per hour per user' })
  @IsOptional()
  @IsInt()
  @Min(1)
  userRateLimitPerHour?: number;

  @ApiPropertyOptional({ default: 20, description: 'Max login requests per minute per IP address' })
  @IsOptional()
  @IsInt()
  @Min(1)
  ipRateLimitPerMinute?: number;

  @ApiPropertyOptional({ default: 200, description: 'Max login requests per hour per IP address' })
  @IsOptional()
  @IsInt()
  @Min(1)
  ipRateLimitPerHour?: number;

  // Session management
  @ApiPropertyOptional({ default: 10, description: 'Maximum number of concurrent active sessions per user (oldest session is evicted when the limit is reached, 0 = unlimited)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxSessionsPerUser?: number;

  // Theming
  @ApiPropertyOptional({ default: 'authme', description: 'Name of the theme preset to use' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  themeName?: string;

  @ApiPropertyOptional({ description: 'Realm theme configuration (color overrides)' })
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @ApiPropertyOptional({ default: 'authme', description: 'Login page theme' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  loginTheme?: string;

  @ApiPropertyOptional({ default: 'authme', description: 'Account page theme' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  accountTheme?: string;

  @ApiPropertyOptional({ default: 'authme', description: 'Email template theme' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  emailTheme?: string;

  // Impersonation
  @ApiPropertyOptional({ default: false, description: 'Allow admin impersonation of users' })
  @IsOptional()
  @IsBoolean()
  impersonationEnabled?: boolean;

  @ApiPropertyOptional({ default: 3600, description: 'Max duration (seconds) of an impersonation session' })
  @IsOptional()
  @IsInt()
  impersonationMaxDuration?: number;

  // WebAuthn / passkeys
  @ApiPropertyOptional({ default: false, description: 'Enable WebAuthn / passkey authentication' })
  @IsOptional()
  @IsBoolean()
  webAuthnEnabled?: boolean;

  @ApiPropertyOptional({ description: 'WebAuthn Relying Party display name' })
  @IsOptional()
  @IsString()
  webAuthnRpName?: string;

  @ApiPropertyOptional({ description: 'WebAuthn Relying Party ID (origin domain)' })
  @IsOptional()
  @IsString()
  webAuthnRpId?: string;

  // Adaptive authentication
  @ApiPropertyOptional({ default: false, description: 'Enable AI-powered adaptive / risk-based authentication' })
  @IsOptional()
  @IsBoolean()
  adaptiveAuthEnabled?: boolean;

  @ApiPropertyOptional({ default: 70, description: 'Risk score threshold (0-100) that triggers step-up MFA' })
  @IsOptional()
  @IsInt()
  riskThresholdStepUp?: number;

  @ApiPropertyOptional({ default: 90, description: 'Risk score threshold (0-100) that blocks the login attempt' })
  @IsOptional()
  @IsInt()
  riskThresholdBlock?: number;

  // Localisation
  @ApiPropertyOptional({ default: 'en', description: 'Default locale for this realm' })
  @IsOptional()
  @IsString()
  defaultLocale?: string;

  @ApiPropertyOptional({ description: 'List of locales supported by this realm', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedLocales?: string[];

  // Legal / registration controls
  @ApiPropertyOptional({ description: 'URL to the terms-of-service page shown during registration' })
  @IsOptional()
  @IsString()
  termsOfServiceUrl?: string;

  @ApiPropertyOptional({ default: false, description: 'Require admin approval before a self-registered account is activated' })
  @IsOptional()
  @IsBoolean()
  registrationApprovalRequired?: boolean;

  @ApiPropertyOptional({ description: 'Whitelist of email domains permitted to self-register (empty = all allowed)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  // SMS MFA configuration
  @ApiPropertyOptional({
    description: 'SMS provider to use',
    enum: ['none', 'twilio', 'vonage', 'aws-sns', 'webhook'],
    default: 'none',
  })
  @IsOptional()
  @IsString()
  smsProvider?: string;

  @ApiPropertyOptional({ description: 'Sender name or phone number for SMS OTP' })
  @IsOptional()
  @IsString()
  smsFrom?: string;

  @ApiPropertyOptional({ description: 'OTP code length (digits)', default: 6 })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(8)
  otpLength?: number;

  @ApiPropertyOptional({ description: 'OTP code expiry time in seconds', default: 300 })
  @IsOptional()
  @IsInt()
  @Min(60)
  otpExpirySeconds?: number;

  @ApiPropertyOptional({ description: 'Provider-specific configuration (JSON)', type: Object })
  @IsOptional()
  @IsObject()
  smsProviderConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Maximum SMS OTP requests per user within the rate limit window', default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  smsMaxRequestsPerUser?: number;

  @ApiPropertyOptional({ description: 'Rate limit window in seconds (default: 15 minutes)', default: 900 })
  @IsOptional()
  @IsInt()
  @Min(60)
  smsRateLimitWindow?: number;

  @ApiPropertyOptional({ description: 'Enable SMS OTP for multi-factor authentication', default: false })
  @IsOptional()
  @IsBoolean()
  smsMfaEnabled?: boolean;
}
