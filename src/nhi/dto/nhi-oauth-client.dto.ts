import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const NHI_CLIENT_AUTH_METHODS = [
  'self_signed_tls_client_auth',
  'tls_client_auth',
] as const;

/** POST /admin/realms/:realm/nhi/:id/oauth-client */
export class NhiOAuthClientDto {
  @ApiPropertyOptional({
    enum: NHI_CLIENT_AUTH_METHODS,
    description:
      "How the identity authenticates: self_signed_tls_client_auth against its SELF_SIGNED credentials, or tls_client_auth against its PKI credentials. Default: the mode of the identity's live certificate credentials (400 if they have none or both).",
  })
  @IsOptional()
  @IsIn(NHI_CLIENT_AUTH_METHODS)
  tokenEndpointAuthMethod?: (typeof NHI_CLIENT_AUTH_METHODS)[number];

  @ApiPropertyOptional({
    description: 'The client_id. Default: "nhi-<identity id>".',
    example: 'nhi-sensor-0042',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  // One character class with a bounded repeat: linear, no backtracking.
  @Matches(/^[A-Za-z0-9._:-]{1,255}$/, {
    message: 'clientId may contain letters, digits, ".", "_", ":" and "-"',
  })
  clientId?: string;

  @ApiPropertyOptional({
    description: "Display name. Default: the identity's name.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
