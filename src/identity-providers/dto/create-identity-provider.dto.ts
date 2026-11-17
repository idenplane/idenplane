import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_IDP_PROVIDER_TYPES } from '../idp-provider-types.js';

/** The alias rule: it is a path segment of the broker's callback URL. */
export const IDP_ALIAS_PATTERN = /^[a-z0-9-]+$/;

export class CreateIdentityProviderDto {
  @ApiProperty()
  @IsString()
  @Matches(IDP_ALIAS_PATTERN, {
    message: 'alias must be lowercase alphanumeric with hyphens',
  })
  alias!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    required: false,
    default: 'oidc',
    enum: SUPPORTED_IDP_PROVIDER_TYPES,
    description:
      'The broker signs users in over OpenID Connect or OAuth 2.0 only; ' +
      'SAML identity providers are not supported. Case-insensitive.',
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${SUPPORTED_IDP_PROVIDER_TYPES.join('|')})$`, 'i'), {
    message: `providerType must be one of: ${SUPPORTED_IDP_PROVIDER_TYPES.join(', ')}`,
  })
  providerType?: string;

  @ApiProperty()
  @IsString()
  clientId!: string;

  @ApiProperty({
    description:
      'Stored encrypted and returned as "••••••"; sending that value back on update keeps the stored secret.',
  })
  @IsString()
  clientSecret!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  authorizationUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  tokenUrl!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  userinfoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  jwksUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiProperty({ required: false, default: 'openid email profile' })
  @IsOptional()
  @IsString()
  defaultScopes?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  trustEmail?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  linkOnly?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  syncUserProfile?: boolean;
}
