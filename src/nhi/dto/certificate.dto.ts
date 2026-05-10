import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsInt,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CertificateFormat {
  PEM = 'PEM',
  DER = 'DER',
  PKCS12 = 'PKCS12',
}

export enum CertificateKeyAlgorithm {
  RSA_2048 = 'RSA_2048',
  RSA_4096 = 'RSA_4096',
  ECDSA_P256 = 'ECDSA_P256',
  ECDSA_P384 = 'ECDSA_P384',
}

export class SetCertificateDto {
  @ApiProperty({ description: 'PEM-encoded certificate' })
  @IsString()
  @IsNotEmpty()
  certificatePem!: string;

  @ApiPropertyOptional({ description: 'PEM-encoded private key' })
  @IsOptional()
  @IsString()
  privateKeyPem?: string;

  @ApiPropertyOptional({ description: 'PEM-encoded certificate chain (intermediate + root CA)' })
  @IsOptional()
  @IsString()
  certificateChain?: string;
}

export class GenerateCertificateDto {
  @ApiProperty({ example: 'device-01.cert' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'My Device', description: 'Subject Common Name (CN)' })
  @IsOptional()
  @IsString()
  subjectCommonName?: string;

  @ApiPropertyOptional({ example: 'US', description: 'Subject Country' })
  @IsOptional()
  @IsString()
  subjectCountry?: string;

  @ApiPropertyOptional({ example: 'California', description: 'Subject State' })
  @IsOptional()
  @IsString()
  subjectState?: string;

  @ApiPropertyOptional({ example: 'San Francisco', description: 'Subject Locality' })
  @IsOptional()
  @IsString()
  subjectLocality?: string;

  @ApiPropertyOptional({ example: 'ACME Corp', description: 'Subject Organization' })
  @IsOptional()
  @IsString()
  subjectOrganization?: string;

  @ApiPropertyOptional({ example: 'Engineering', description: 'Subject Organizational Unit' })
  @IsOptional()
  @IsString()
  subjectOrganizationalUnit?: string;

  @ApiPropertyOptional({ enum: CertificateKeyAlgorithm, example: 'ECDSA_P256' })
  @IsOptional()
  @IsEnum(CertificateKeyAlgorithm)
  keyAlgorithm?: CertificateKeyAlgorithm;

  @ApiPropertyOptional({ example: 365, description: 'Certificate validity in days' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  validityDays?: number;

  @ApiPropertyOptional({ example: 'DNS:device.internal,IP:192.168.1.100', description: 'Subject Alternative Names' })
  @IsOptional()
  @IsString()
  subjectAlternativeNames?: string;

  @ApiPropertyOptional({ example: true, description: 'Include CA basic constraints' })
  @IsOptional()
  @IsBoolean()
  isCertificateAuthority?: boolean;

  @ApiPropertyOptional({ enum: CertificateFormat, example: 'PEM' })
  @IsOptional()
  @IsEnum(CertificateFormat)
  format?: CertificateFormat;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: '2027-05-10T00:00:00.000Z', description: 'Custom expiration date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CertificateInfoDto {
  @ApiProperty()
  @IsString()
  subject!: string;

  @ApiProperty()
  @IsString()
  issuer!: string;

  @ApiProperty()
  @IsDateString()
  notBefore!: string;

  @ApiProperty()
  @IsDateString()
  notAfter!: string;

  @ApiProperty()
  @IsString()
  fingerprint!: string;

  @ApiPropertyOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  publicKeyAlgorithm?: string;

  @ApiPropertyOptional()
  @IsInt()
  keyLength?: number;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  sans?: string[];

  @ApiPropertyOptional()
  @IsBoolean()
  isCA?: boolean;
}