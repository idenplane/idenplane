import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TlsClientAuthRuleFieldsDto } from './tls-client-auth-rules.dto.js';

/**
 * Rotation input. An API key needs none of it. A SELF_SIGNED certificate
 * credential needs the new `certificatePem`; a PKI one takes a new rule, or
 * keeps the old one when none is given.
 */
export class RotateNhiCredentialDto extends TlsClientAuthRuleFieldsDto {
  @ApiPropertyOptional({
    description:
      'Name of the new credential. Default: "<old name> (rotated <time>)".',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description:
      'SELF_SIGNED: the new certificate (PEM, exactly one certificate, no private key).',
  })
  @IsOptional()
  @IsString()
  certificatePem?: string;

  @ApiPropertyOptional({
    description:
      "Seconds the old certificate keeps authenticating (0 to 30 days). Default: the applicable policy's rotationOverlapSeconds, else 86400.",
    minimum: 0,
    maximum: 2592000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2592000)
  overlapSeconds?: number;
}
