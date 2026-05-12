import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiPropertyOptional({ example: 'ci-pipeline-key' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: ['read:users', 'write:tokens'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  // Usage quotas
  @ApiPropertyOptional({
    example: 10000,
    description: 'Maximum requests allowed per day',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRequestsPerDay?: number;

  @ApiPropertyOptional({
    example: 100000,
    description: 'Maximum requests allowed per month',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRequestsPerMonth?: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'Maximum requests allowed per minute (rate limit)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;

  // IP restrictions
  @ApiPropertyOptional({
    description: 'Require client IP to be in allowed ranges',
  })
  @IsOptional()
  @IsBoolean()
  requireIpRestriction?: boolean;

  @ApiPropertyOptional({
    example: ['10.0.0.0/8', '192.168.1.1'],
    description: 'Allowed IP ranges (CIDR notation or exact IPs)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIpRanges?: string[];
}
