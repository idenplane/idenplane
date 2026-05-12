import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'warehouse-sensor-001',
    description: 'Unique name/identifier for the device',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ example: 'Temperature sensor in warehouse A' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    example: { firmwareVersion: '2.1.0', hardwareModel: 'SensorV3' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: ['read:telemetry', 'write:sensor-data'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionScopes?: string[];
}
