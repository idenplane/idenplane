import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The RFC 8705 §2.1.2 subject/SAN rule of a PKI certificate credential:
 * exactly one is set. Formats are checked by the service (the same checks
 * as a client's `tlsClientAuth*` fields).
 */
export class TlsClientAuthRuleFieldsDto {
  @ApiPropertyOptional({
    description:
      'PKI: the certificate subject as an RFC 4514 string, e.g. "CN=device-1,O=Example". Compared as parsed RDNs.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  tlsClientAuthSubjectDn?: string;

  @ApiPropertyOptional({
    description: 'PKI: a dNSName the certificate must carry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  tlsClientAuthSanDns?: string;

  @ApiPropertyOptional({
    description:
      'PKI: a uniformResourceIdentifier the certificate must carry, e.g. a SPIFFE ID.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  tlsClientAuthSanUri?: string;

  @ApiPropertyOptional({
    description: 'PKI: an iPAddress the certificate must carry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tlsClientAuthSanIp?: string;

  @ApiPropertyOptional({
    description: 'PKI: an rfc822Name the certificate must carry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  tlsClientAuthSanEmail?: string;
}
