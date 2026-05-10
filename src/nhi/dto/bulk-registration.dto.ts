import { IsString, IsOptional, IsBoolean, IsObject, IsArray, ValidateNested, IsInt, Min, MinLength, Max, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for a single device in bulk registration.
 */
export class BulkDeviceItemDto {
  @ApiProperty({ example: 'warehouse-sensor-001', description: 'Unique name/identifier for the device' })
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

  @ApiPropertyOptional({ example: { firmwareVersion: '2.1.0', hardwareModel: 'SensorV3' } })
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

  @ApiPropertyOptional({ example: 'production' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ description: 'Generate a certificate for this device during bulk registration' })
  @IsOptional()
  @IsBoolean()
  generateCertificate?: boolean;

  @ApiPropertyOptional({ description: 'Key algorithm for generated certificate (if generateCertificate is true)', example: 'ECDSA_P256' })
  @IsOptional()
  @IsString()
  certificateKeyAlgorithm?: string;

  @ApiPropertyOptional({ description: 'Validity in days for generated certificate', example: 365 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  certificateValidityDays?: number;
}

/**
 * Request DTO for bulk device registration.
 * Supports registering multiple devices at once for fleet management.
 */
export class BulkRegistrationDto {
  @ApiProperty({
    type: [BulkDeviceItemDto],
    description: 'Array of devices to register',
    example: [
      {
        name: 'warehouse-sensor-001',
        description: 'Temperature sensor in warehouse A',
        tags: ['warehouse-a', 'temperature'],
        permissionScopes: ['read:telemetry'],
      },
      {
        name: 'warehouse-sensor-002',
        description: 'Temperature sensor in warehouse B',
        tags: ['warehouse-b', 'temperature'],
        permissionScopes: ['read:telemetry'],
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkDeviceItemDto)
  devices!: BulkDeviceItemDto[];

  @ApiPropertyOptional({
    description: 'Number of successful registrations',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  maxItems?: number;
}

/**
 * Result item for a single device in bulk registration.
 */
export class BulkRegistrationResultItemDto {
  @ApiProperty({ example: 'device-sensor-001', description: 'Device name' })
  name!: string;

  @ApiProperty({ example: 'd290f1ee-6c54-4b01-90e6-d701748f0851', description: 'Device ID' })
  id!: string;

  @ApiPropertyOptional({ example: 'sk_live_abc123...', description: 'API key (only for API_KEY credentials)' })
  plainKey?: string;

  @ApiPropertyOptional({ example: { firmwareVersion: '2.1.0' } })
  metadata?: Record<string, unknown>;

  @ApiProperty({ example: true, description: 'Whether registration succeeded' })
  success!: boolean;

  @ApiPropertyOptional({ example: 'NHI identity already exists' })
  error?: string;

  @ApiPropertyOptional({ description: 'Generated certificate PEM (if generateCertificate was true)' })
  certificatePem?: string;

  @ApiPropertyOptional({ description: 'Private key PEM (if generateCertificate was true)' })
  privateKeyPem?: string;

  @ApiPropertyOptional({ description: 'Certificate info including subject, validity, fingerprint' })
  certificateInfo?: Record<string, unknown>;
}

/**
 * Response DTO for bulk device registration.
 */
export class BulkRegistrationResponseDto {
  @ApiProperty({
    description: 'Total number of devices in the request',
    example: 2,
  })
  total!: number;

  @ApiProperty({
    description: 'Number of successfully registered devices',
    example: 2,
  })
  successful!: number;

  @ApiProperty({
    description: 'Number of failed registrations',
    example: 0,
  })
  failed!: number;

  @ApiProperty({
    type: [BulkRegistrationResultItemDto],
    description: 'Results for each device',
  })
  results!: BulkRegistrationResultItemDto[];

  @ApiPropertyOptional({
    description: 'Warning message if some devices failed',
    example: '2 devices failed to register',
  })
  warning?: string;
}
