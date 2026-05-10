import { IsString, IsOptional, IsBoolean, IsInt, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SmsProviderConfigDto {
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

export class UpdateSmsConfigDto {
  @ApiPropertyOptional({
    description: 'SMS provider to use',
    enum: ['none', 'twilio', 'vonage', 'aws-sns', 'webhook'],
  })
  @IsOptional()
  @IsString()
  smsProvider?: string;

  @ApiPropertyOptional({ description: 'Sender name or phone number for SMS OTP' })
  @IsOptional()
  @IsString()
  smsFrom?: string;

  @ApiPropertyOptional({ description: 'OTP code length (digits)' })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(8)
  otpLength?: number;

  @ApiPropertyOptional({ description: 'OTP code expiry time in seconds' })
  @IsOptional()
  @IsInt()
  @Min(60)
  otpExpirySeconds?: number;

  @ApiPropertyOptional({ description: 'Provider-specific configuration (JSON)', type: Object })
  @IsOptional()
  @IsObject()
  smsProviderConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Maximum SMS OTP requests per user within the rate limit window' })
  @IsOptional()
  @IsInt()
  @Min(1)
  smsMaxRequestsPerUser?: number;

  @ApiPropertyOptional({ description: 'Rate limit window in seconds' })
  @IsOptional()
  @IsInt()
  @Min(60)
  smsRateLimitWindow?: number;

  @ApiPropertyOptional({ description: 'Enable SMS OTP for multi-factor authentication' })
  @IsOptional()
  @IsBoolean()
  smsMfaEnabled?: boolean;
}