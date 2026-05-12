import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { NhiCredentialType } from '@prisma/client';

export class CreateNhiCredentialPolicyDto {
  @ApiProperty({ description: 'Name of the credential policy' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Description of the policy' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the policy is enabled',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Priority of the policy (lower numbers have higher priority)',
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Type of credential this policy applies to',
    enum: NhiCredentialType,
    default: NhiCredentialType.API_KEY,
  })
  @IsEnum(NhiCredentialType)
  @IsOptional()
  credentialType?: NhiCredentialType;

  @ApiPropertyOptional({
    description: 'Number of days between credential rotations',
    default: 90,
  })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  rotationIntervalDays?: number;

  @ApiPropertyOptional({
    description: 'Number of days before rotation date to start warning',
    default: 7,
  })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  rotationBeforeDays?: number;

  @ApiPropertyOptional({
    description: 'Whether to automatically rotate credentials',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  autoRotate?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum age of credentials in days',
    default: 365,
  })
  @IsInt()
  @Min(1)
  @Max(730)
  @IsOptional()
  maxCredentialAgeDays?: number;

  @ApiPropertyOptional({
    description: 'Maximum requests per day (null = no limit)',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRequestsPerDay?: number | null;

  @ApiPropertyOptional({
    description: 'Maximum requests per month (null = no limit)',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRequestsPerMonth?: number | null;

  @ApiPropertyOptional({
    description: 'Rate limit per minute (null = no limit)',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  rateLimitPerMinute?: number | null;

  @ApiPropertyOptional({
    description: 'Whether to require certificate authentication',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  requireCertificate?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to require IP restriction',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  requireIpRestriction?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to require audit logging',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  requireAuditLogging?: boolean;
}
