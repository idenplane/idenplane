import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsInt,
  IsUrl,
  Min,
  Max,
  ValidateIf,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAuditStreamDto {
  @ApiProperty({
    example: 'My Syslog Stream',
    description: 'Human-readable name for the stream',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    enum: ['syslog', 'http'],
    description: 'Type of stream destination',
  })
  @IsIn(['syslog', 'http'])
  streamType!: 'syslog' | 'http';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // ── HTTP fields ────────────────────────────────────────

  @ApiPropertyOptional({ example: 'https://logs.example.com/ingest' })
  @ValidateIf((o: CreateAuditStreamDto) => o.streamType === 'http')
  @IsUrl({ require_tld: false }, { message: 'url must be a valid URL' })
  url?: string;

  @ApiPropertyOptional({
    example: { Authorization: 'Bearer token123' },
    description: 'Extra HTTP headers to include in each delivery',
  })
  @IsOptional()
  @IsObject()
  httpHeaders?: Record<string, string>;

  // ── Syslog fields ──────────────────────────────────────

  @ApiPropertyOptional({ example: 'syslog.corp.example.com' })
  @ValidateIf((o: CreateAuditStreamDto) => o.streamType === 'syslog')
  @IsString()
  syslogHost?: string;

  @ApiPropertyOptional({ example: 514 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  syslogPort?: number;

  @ApiPropertyOptional({ enum: ['udp', 'tcp'], default: 'udp' })
  @IsOptional()
  @IsIn(['udp', 'tcp'])
  syslogProtocol?: 'udp' | 'tcp';

  @ApiPropertyOptional({
    description: 'Syslog facility code (0–23)',
    default: 16,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  syslogFacility?: number;
}

export class UpdateAuditStreamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'url must be a valid URL' })
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  httpHeaders?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  syslogHost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  syslogPort?: number;

  @ApiPropertyOptional({ enum: ['udp', 'tcp'] })
  @IsOptional()
  @IsIn(['udp', 'tcp'])
  syslogProtocol?: 'udp' | 'tcp';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  syslogFacility?: number;
}
