import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NhiCredentialType } from '@prisma/client';

export class CreateNhiCredentialDto {
  @ApiProperty({ example: 'Production API Key' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ enum: NhiCredentialType, example: 'API_KEY' })
  @IsOptional()
  @IsEnum(NhiCredentialType)
  credentialType?: NhiCredentialType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificatePem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificateChain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  privateKeyPem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jwtSigningAlgorithm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jwtIssuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jwtAudience?: string;

  @ApiPropertyOptional({ example: '2027-05-10T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rotationRequired?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIpRanges?: string[];
}
