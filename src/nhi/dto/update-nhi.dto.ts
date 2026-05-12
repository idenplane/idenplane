import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NhiIdentityType, NhiLifecycleStatus } from '@prisma/client';

export class UpdateNhiIdentityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: NhiIdentityType })
  @IsOptional()
  @IsEnum(NhiIdentityType)
  identityType?: NhiIdentityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: NhiLifecycleStatus })
  @IsOptional()
  @IsEnum(NhiLifecycleStatus)
  lifecycleStatus?: NhiLifecycleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentPurpose?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionScopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
