import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsObject,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NhiIdentityType, NhiLifecycleStatus } from '@prisma/client';

export class CreateNhiIdentityDto {
  @ApiProperty({
    example: 'device-sensor-001',
    description: 'Unique name for the NHI identity',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ example: 'IoT temperature sensor for warehouse A' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: NhiIdentityType, example: 'IOT_DEVICE' })
  @IsOptional()
  @IsEnum(NhiIdentityType)
  identityType?: NhiIdentityType;

  @ApiPropertyOptional({ enum: NhiLifecycleStatus, example: 'PROVISIONING' })
  @IsOptional()
  @IsEnum(NhiLifecycleStatus)
  lifecycleStatus?: NhiLifecycleStatus;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'temperature-monitoring' })
  @IsOptional()
  @IsString()
  agentPurpose?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionScopes?: string[];

  @ApiPropertyOptional({
    example: { location: 'warehouse-a', model: 'sensor-v2' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
