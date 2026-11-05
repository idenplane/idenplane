import {
  IsInt,
  IsJSON,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SECRET_PLACEHOLDER } from '../secret-placeholder.js';

/**
 * Per-realm SMS provider credentials, in the flat shape the admin UI's SMS tab
 * sends (`smsProviderConfig` on the realm). Only the block for the realm's
 * selected `smsProvider` is used; any field left empty falls back to the
 * server-wide environment variable for that provider (TWILIO_*, VONAGE_*,
 * AWS_*, SMS_WEBHOOK_*), so existing env-based setups keep working.
 *
 * The secret fields (see SMS_SECRET_FIELDS) are encrypted at rest and never
 * returned by the API — reads get a placeholder, and sending the placeholder
 * back keeps the stored value.
 */
/**
 * Stored secrets render as SECRET_PLACEHOLDER in the form's password fields.
 * Sent back exactly, it means "keep". Typing a new value without clearing the
 * field first sends the placeholder glued to it ('••••••AC9f…'), which would be
 * saved as a credential that can never work, so that is rejected instead.
 */
const PLACEHOLDER_TYPED_OVER =
  '$property still contains the hidden-value marker; clear the field before entering a new value';

const keepsStoredSecret =
  (field: keyof RealmSmsProviderConfigDto) => (o: RealmSmsProviderConfigDto) =>
    o[field] !== SECRET_PLACEHOLDER;

export class RealmSmsProviderConfigDto {
  // Twilio
  @ApiPropertyOptional({ description: 'Twilio Account SID' })
  @IsOptional()
  @IsString()
  twilioAccountSid?: string;

  @ApiPropertyOptional({ description: 'Twilio Auth Token (write-only)' })
  @IsOptional()
  @ValidateIf(keepsStoredSecret('twilioAuthToken'))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  twilioAuthToken?: string;

  // Vonage
  @ApiPropertyOptional({ description: 'Vonage API key' })
  @IsOptional()
  @IsString()
  vonageApiKey?: string;

  @ApiPropertyOptional({ description: 'Vonage API secret (write-only)' })
  @IsOptional()
  @ValidateIf(keepsStoredSecret('vonageApiSecret'))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  vonageApiSecret?: string;

  // AWS SNS
  @ApiPropertyOptional({ description: 'AWS access key ID' })
  @IsOptional()
  @IsString()
  awsAccessKeyId?: string;

  @ApiPropertyOptional({ description: 'AWS secret access key (write-only)' })
  @IsOptional()
  @ValidateIf(keepsStoredSecret('awsSecretAccessKey'))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  awsSecretAccessKey?: string;

  @ApiPropertyOptional({ description: 'AWS region, e.g. eu-west-1' })
  @IsOptional()
  @IsString()
  awsRegion?: string;

  // Webhook
  @ApiPropertyOptional({
    description:
      'URL the webhook provider POSTs { to, message, timestamp } to. Delivered through the SSRF-safe HTTP client.',
  })
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  webhookUrl?: string;

  @ApiPropertyOptional({
    description:
      'Extra request headers as JSON: an object ({"Authorization": "Bearer …"}) or a list ([{"name": …, "value": …}]). Write-only.',
  })
  @IsOptional()
  // The API hands stored headers back as SECRET_PLACEHOLDER, and a form saved
  // without touching them sends that back — which means "keep", not JSON.
  @ValidateIf(
    (o: RealmSmsProviderConfigDto) => o.webhookHeaders !== SECRET_PLACEHOLDER,
  )
  @IsJSON()
  webhookHeaders?: string;

  @ApiPropertyOptional({
    description: 'Webhook request timeout in milliseconds',
    default: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  webhookTimeout?: number;
}

/** Fields of RealmSmsProviderConfigDto that are credentials. */
export const SMS_SECRET_FIELDS = [
  'twilioAuthToken',
  'vonageApiSecret',
  'awsSecretAccessKey',
  'webhookHeaders',
] as const satisfies readonly (keyof RealmSmsProviderConfigDto)[];
