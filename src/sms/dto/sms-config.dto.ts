import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * SMS Provider types supported by the system.
 */
export enum SmsProviderType {
  NONE = 'none',
  TWILIO = 'twilio',
  VONAGE = 'vonage',
  AWS_SNS = 'aws-sns',
  WEBHOOK = 'webhook',
}

/**
 * Twilio-specific configuration.
 */
export class TwilioSmsConfigDto {
  @ApiPropertyOptional({ description: 'Twilio Account SID' })
  @IsOptional()
  @IsString()
  accountSid?: string;

  @ApiPropertyOptional({ description: 'Twilio Auth Token' })
  @IsOptional()
  @IsString()
  authToken?: string;

  @ApiPropertyOptional({ description: 'Twilio Phone Number (from)' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

/**
 * Vonage-specific configuration.
 */
export class VonageSmsConfigDto {
  @ApiPropertyOptional({ description: 'Vonage API Key' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Vonage API Secret' })
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional({ description: 'Vonage Phone Number (from)' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

/**
 * AWS SNS-specific configuration.
 */
export class AwsSnsConfigDto {
  @ApiPropertyOptional({ description: 'AWS Access Key ID' })
  @IsOptional()
  @IsString()
  accessKeyId?: string;

  @ApiPropertyOptional({ description: 'AWS Secret Access Key' })
  @IsOptional()
  @IsString()
  secretAccessKey?: string;

  @ApiPropertyOptional({ description: 'AWS Region' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'AWS SNS Sender ID / From Number' })
  @IsOptional()
  @IsString()
  senderId?: string;
}

/**
 * Webhook-specific configuration.
 */
export class WebhookSmsConfigDto {
  @ApiPropertyOptional({ description: 'Webhook URL for SMS delivery' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description: 'Custom headers as JSON array',
    example: '[{"name":"X-API-Key","value":"secret"}]',
  })
  @IsOptional()
  @IsString()
  headers?: string;

  @ApiPropertyOptional({
    description: 'Request timeout in milliseconds',
    default: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;
}

/**
 * Combined SMS provider configuration.
 * Each provider type has its own config section.
 */
export class SmsProviderConfigDto {
  @ApiPropertyOptional({
    description: 'Twilio configuration',
    type: TwilioSmsConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TwilioSmsConfigDto)
  twilio?: TwilioSmsConfigDto;

  @ApiPropertyOptional({
    description: 'Vonage configuration',
    type: VonageSmsConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VonageSmsConfigDto)
  vonage?: VonageSmsConfigDto;

  @ApiPropertyOptional({
    description: 'AWS SNS configuration',
    type: AwsSnsConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AwsSnsConfigDto)
  awsSns?: AwsSnsConfigDto;

  @ApiPropertyOptional({
    description: 'Webhook configuration',
    type: WebhookSmsConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookSmsConfigDto)
  webhook?: WebhookSmsConfigDto;
}

/**
 * SMS Configuration DTO for realm settings.
 * This DTO captures all SMS-related configuration options for a realm.
 */
export class SmsConfigDto {
  @ApiPropertyOptional({
    description: 'SMS provider to use',
    enum: SmsProviderType,
    default: SmsProviderType.NONE,
  })
  @IsOptional()
  @IsEnum(SmsProviderType)
  smsProvider?: SmsProviderType;

  @ApiPropertyOptional({
    description: 'Sender name or phone number displayed to recipients',
  })
  @IsOptional()
  @IsString()
  smsFrom?: string;

  @ApiPropertyOptional({
    description: 'OTP code length (digits)',
    default: 6,
    minimum: 4,
    maximum: 8,
  })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(8)
  otpLength?: number;

  @ApiPropertyOptional({
    description: 'OTP code expiry time in seconds',
    default: 300,
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  otpExpirySeconds?: number;

  @ApiPropertyOptional({
    description: 'Provider-specific configuration (JSON)',
    type: SmsProviderConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SmsProviderConfigDto)
  smsProviderConfig?: SmsProviderConfigDto;

  @ApiPropertyOptional({
    description:
      'Maximum SMS OTP requests per user within the rate limit window',
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  smsMaxRequestsPerUser?: number;

  @ApiPropertyOptional({
    description: 'Rate limit window in seconds (default: 15 minutes)',
    default: 900,
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  smsRateLimitWindow?: number;

  @ApiPropertyOptional({
    description: 'Enable SMS OTP for multi-factor authentication',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  smsMfaEnabled?: boolean;
}
