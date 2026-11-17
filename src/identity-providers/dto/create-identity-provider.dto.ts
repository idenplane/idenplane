import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_IDP_PROVIDER_TYPES } from '../idp-provider-types.js';
import { IsSamlConfig, SamlConfigDto } from './saml-config.dto.js';

/** Whether a request names the `saml` type (case-insensitive). */
export const namesSaml = (o: { providerType?: unknown }): boolean =>
  typeof o.providerType === 'string' &&
  o.providerType.trim().toLowerCase() === 'saml';

/** OAuth fields are required for `oidc`/`oauth2` only (and checked when sent). */
const oauthField = (o: CreateIdentityProviderDto, value: unknown): boolean =>
  !namesSaml(o) || value !== undefined;

export class CreateIdentityProviderDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
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
      'OpenID Connect, OAuth 2.0 or SAML 2.0 (Idenplane as a SAML service ' +
      'provider; settings in samlConfig). Case-insensitive.',
  })
  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${SUPPORTED_IDP_PROVIDER_TYPES.join('|')})$`, 'i'), {
    message: `providerType must be one of: ${SUPPORTED_IDP_PROVIDER_TYPES.join(', ')}`,
  })
  providerType?: string;

  @ApiProperty({ description: 'Required for oidc/oauth2; unused for saml' })
  @ValidateIf((o: CreateIdentityProviderDto) => oauthField(o, o.clientId))
  @IsString()
  clientId!: string;

  @ApiProperty({
    description:
      'Required for oidc/oauth2; unused for saml. Stored encrypted and returned as "••••••"; sending that value back on update keeps the stored secret.',
  })
  @ValidateIf((o: CreateIdentityProviderDto) => oauthField(o, o.clientSecret))
  @IsString()
  clientSecret!: string;

  @ApiProperty({ description: 'Required for oidc/oauth2; unused for saml' })
  @ValidateIf((o: CreateIdentityProviderDto) =>
    oauthField(o, o.authorizationUrl),
  )
  @IsUrl({ require_tld: false })
  authorizationUrl!: string;

  @ApiProperty({ description: 'Required for oidc/oauth2; unused for saml' })
  @ValidateIf((o: CreateIdentityProviderDto) => oauthField(o, o.tokenUrl))
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

  @ApiProperty({
    required: false,
    type: SamlConfigDto,
    description:
      "Required for providerType 'saml'. Fill it from IdP metadata with POST …/identity-providers/saml-metadata.",
  })
  @ValidateIf(
    (o: CreateIdentityProviderDto) =>
      namesSaml(o) || o.samlConfig !== undefined,
  )
  @IsSamlConfig()
  samlConfig?: Record<string, unknown>;
}
