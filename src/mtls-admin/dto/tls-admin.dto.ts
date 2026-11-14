import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UploadCertificateDto {
  @ApiProperty({
    description:
      'One PEM CERTIFICATE block. A private key, several certificates or any other content is refused.',
    example: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
  })
  @IsString()
  @MaxLength(64 * 1024)
  certificatePem!: string;
}

export class CreateRevokedCertificateDto {
  @ApiPropertyOptional({
    description:
      'The certificate itself. Its x5t#S256, issuer and serial number are all listed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64 * 1024)
  certificatePem?: string;

  @ApiPropertyOptional({
    description: 'RFC 8705 x5t#S256: base64url SHA-256 of the DER, no padding.',
    example: 'A4DtL2JmUMhAsvJj5tKyn64SqzmuXbMrJa0n761y5v0',
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'x5tS256 must be a base64url SHA-256 thumbprint (43 characters)',
  })
  x5tS256?: string;

  @ApiPropertyOptional({
    description: 'Issuer DN as an RFC 4514 string; requires serialNumber.',
    example: 'CN=Example Issuing CA,O=Example',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  issuerDn?: string;

  @ApiPropertyOptional({
    description: 'Serial number in hex (colons allowed); requires issuerDn.',
    example: '01:a2:ff',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  serialNumber?: string;

  @ApiPropertyOptional({ example: 'key compromise' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
