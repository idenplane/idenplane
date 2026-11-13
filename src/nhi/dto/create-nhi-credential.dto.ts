import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NhiCredentialType, NhiTlsAuthMode } from '@prisma/client';
import { TlsClientAuthRuleFieldsDto } from './tls-client-auth-rules.dto.js';

export class CreateNhiCredentialDto extends TlsClientAuthRuleFieldsDto {
  @ApiProperty({ example: 'Production API Key' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ enum: NhiCredentialType, example: 'API_KEY' })
  @IsOptional()
  @IsEnum(NhiCredentialType)
  credentialType?: NhiCredentialType;

  @ApiPropertyOptional({
    enum: NhiTlsAuthMode,
    description:
      "RFC 8705 client authentication for the identity's OAuth client. SELF_SIGNED: certificatePem is the device's certificate, matched by its x5t#S256 (self_signed_tls_client_auth). PKI: exactly one tlsClientAuth* rule; any certificate the realm's trust anchors issue that matches it authenticates (tls_client_auth). Omitted: the credential never authenticates a client. Implies credentialType CERTIFICATE when that is omitted.",
  })
  @IsOptional()
  @IsEnum(NhiTlsAuthMode)
  tlsAuthMode?: NhiTlsAuthMode;

  @ApiPropertyOptional({
    description:
      'One PEM certificate. For CERTIFICATE and MTLS credentials it must be exactly one certificate and no private key.',
  })
  @IsOptional()
  @IsString()
  certificatePem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificateChain?: string;

  @ApiPropertyOptional({
    description:
      'Refused for CERTIFICATE and MTLS credentials: the device keeps its private key.',
  })
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
