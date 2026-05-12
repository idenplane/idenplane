import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateNhiCredentialPolicyDto {
  @ApiPropertyOptional({ description: 'Name of the credential policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Description of the policy' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the policy is enabled' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Priority of the policy (lower numbers have higher priority)',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Type of credential this policy applies to',
    enum: NhiCredentialType,
  })
  @IsEnum(NhiCredentialType)
  @IsOptional()
  credentialType?: NhiCredentialType;

  @ApiPropertyOptional({
    description: 'Number of days between credential rotations',
  })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  rotationIntervalDays?: number;

  @ApiPropertyOptional({
    description: 'Number of days before rotation date to start warning',
  })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  rotationBeforeDays?: number;

  @ApiPropertyOptional({
    description: 'Whether to automatically rotate credentials',
  })
  @IsBoolean()
  @IsOptional()
  autoRotate?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum age of credentials in days',
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
  })
  @IsBoolean()
  @IsOptional()
  requireCertificate?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to require IP restriction',
  })
  @IsBoolean()
  @IsOptional()
  requireIpRestriction?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to require audit logging',
  })
  @IsBoolean()
  @IsOptional()
  requireAuditLogging?: boolean;
}
