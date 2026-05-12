import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RateLimitConfigDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Enable per-client/user/IP rate limiting',
  })
  @IsOptional()
  @IsBoolean()
  rateLimitEnabled?: boolean;

  @ApiPropertyOptional({
    default: 60,
    description: 'Max requests per minute per OAuth client',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerMinute?: number;

  @ApiPropertyOptional({
    default: 1000,
    description: 'Max requests per hour per OAuth client',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  clientRateLimitPerHour?: number;

  @ApiPropertyOptional({
    default: 30,
    description: 'Max requests per minute per user',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userRateLimitPerMinute?: number;

  @ApiPropertyOptional({
    default: 500,
    description: 'Max requests per hour per user',
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
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}
