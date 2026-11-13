import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  IsArray,
  IsIn,
  MinLength,
  registerDecorator,
  ValidationOptions,
  ValidationArguments as _ValidationArguments,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TOKEN_ENDPOINT_AUTH_METHODS,
  isValidSanDns,
  isValidSanEmail,
  isValidSanIp,
  isValidSanUri,
  isValidSubjectDn,
  type TokenEndpointAuthMethodValue,
} from '../client-auth-settings.js';

/** A string the predicate accepts. */
function Satisfies(
  predicate: (value: unknown) => boolean,
  description: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'satisfies',
      target: (
        object as { constructor: new (...args: unknown[]) => typeof object }
      ).constructor,
      propertyName,
      options: {
        message: `${propertyName} ${description}`,
        ...validationOptions,
      },
      validator: { validate: (value: unknown) => predicate(value) },
    });
  };
}

/**
 * Rejects arrays that contain the bare wildcard origin '*'.
 *
 * Allowing '*' in webOrigins would instruct the CORS middleware to echo back
 * an Allow-Origin header for every request origin, effectively disabling CORS
 * protection for the entire realm.  Concrete origins must always be specified.
 */
function IsNoWildcardOrigin(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNoWildcardOrigin',
      target: (
        object as { constructor: new (...args: unknown[]) => typeof object }
      ).constructor,
      propertyName,
      options: {
        message:
          'webOrigins must not contain the wildcard "*". Specify explicit origins instead.',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return true;
          return !(value as unknown[]).some((v) => v === '*');
        },
      },
    });
  };
}

/**
 * Optional, but not nullable: an absent field is skipped, while `null` is
 * validated, and refused by the type check that follows, instead of
 * reaching a non-nullable column as a 500. `@IsOptional()` would let `null`
 * through.
 */
function NotNullIfPresent(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

export class CreateClientDto {
  @ApiProperty({ example: 'my-frontend' })
  @IsString()
  @MinLength(2)
  clientId!: string;

  @ApiPropertyOptional({ example: 'My Frontend App' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: ['CONFIDENTIAL', 'PUBLIC'],
    default: 'CONFIDENTIAL',
  })
  @IsOptional()
  @IsEnum({ CONFIDENTIAL: 'CONFIDENTIAL', PUBLIC: 'PUBLIC' })
  clientType?: 'CONFIDENTIAL' | 'PUBLIC';

  /**
   * Convenience alias for `clientType: 'PUBLIC'`.
   * When `true` it is equivalent to sending `clientType: 'PUBLIC'`.
   * Ignored when `clientType` is also provided.
   */
  @ApiPropertyOptional({
    description:
      "Shorthand for clientType: 'PUBLIC'. Ignored when clientType is set.",
    example: true,
  })
  @NotNullIfPresent()
  @IsBoolean()
  publicClient?: boolean;

  @ApiPropertyOptional({ default: true })
  @NotNullIfPresent()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: ['http://localhost:3000/callback'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  redirectUris?: string[];

  @ApiPropertyOptional({
    description:
      'Allowed post_logout_redirect_uri values for RP-Initiated Logout. Falls back to redirectUris when empty.',
    example: ['http://localhost:3000/after-logout'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postLogoutRedirectUris?: string[];

  @ApiPropertyOptional({ example: ['http://localhost:3000'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNoWildcardOrigin()
  webOrigins?: string[];

  @ApiPropertyOptional({
    example: ['authorization_code', 'client_credentials'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grantTypes?: string[];

  @ApiPropertyOptional({ default: false })
  @NotNullIfPresent()
  @IsBoolean()
  requireConsent?: boolean;

  @ApiPropertyOptional({ example: 'https://example.com/backchannel-logout' })
  @IsOptional()
  @IsString()
  backchannelLogoutUri?: string;

  @ApiPropertyOptional({ default: true })
  @NotNullIfPresent()
  @IsBoolean()
  backchannelLogoutSessionRequired?: boolean;

  @ApiPropertyOptional({
    description:
      'Minimum Authentication Context Class Reference required before issuing a code for this client. When set, /authorize will redirect a session that does not satisfy it to the step-up challenge. Use `null` (or omit) for no enforcement.',
    example: 'urn:idenplane:acr:mfa',
  })
  @IsOptional()
  @IsString()
  requiredAcr?: string | null;

  @ApiPropertyOptional({
    description:
      'How long (seconds) a satisfied step-up ACR can be re-used before a fresh challenge is required.',
    example: 300,
  })
  @IsOptional()
  @IsInt()
  stepUpCacheDuration?: number;

  @ApiPropertyOptional({
    enum: TOKEN_ENDPOINT_AUTH_METHODS,
    nullable: true,
    description:
      'RFC 7591 token_endpoint_auth_method. null (default) infers it from clientType: client_secret_basic or client_secret_post for CONFIDENTIAL, none for PUBLIC. tls_client_auth and self_signed_tls_client_auth (RFC 8705) also need MTLS_ENABLED and the realm’s mtlsClientAuthEnabled.',
  })
  @IsOptional()
  @IsIn(TOKEN_ENDPOINT_AUTH_METHODS)
  tokenEndpointAuthMethod?: TokenEndpointAuthMethodValue | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'tls_client_auth: the certificate subject, as an RFC 4514 string (most specific RDN first), e.g. "CN=device-1,O=Example,C=US". Compared as parsed RDNs.',
  })
  @IsOptional()
  @Satisfies(isValidSubjectDn, 'must be an RFC 4514 distinguished name')
  tlsClientAuthSubjectDn?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'tls_client_auth: a dNSName the certificate must carry.',
  })
  @IsOptional()
  @Satisfies(isValidSanDns, 'must be a DNS name without wildcards')
  tlsClientAuthSanDns?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'tls_client_auth: a uniformResourceIdentifier the certificate must carry, e.g. a SPIFFE ID.',
  })
  @IsOptional()
  @Satisfies(isValidSanUri, 'must be an absolute URI')
  tlsClientAuthSanUri?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'tls_client_auth: an iPAddress the certificate must carry.',
  })
  @IsOptional()
  @Satisfies(isValidSanIp, 'must be an IPv4 or IPv6 address')
  tlsClientAuthSanIp?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'tls_client_auth: an rfc822Name the certificate must carry.',
  })
  @IsOptional()
  @Satisfies(isValidSanEmail, 'must be an email address')
  tlsClientAuthSanEmail?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'RFC 8705 §3 tls_client_certificate_bound_access_tokens: every access token issued to this client carries cnf.x5t#S256 of the certificate it presented at the token endpoint (any authentication method), and is accepted at userinfo and other resource endpoints only with that certificate. A token request without a certificate is invalid_client. For a PUBLIC client the refresh token is bound too. Needs MTLS_ENABLED and a certificate listener or trusted proxy.',
  })
  @NotNullIfPresent()
  @IsBoolean()
  tlsClientCertificateBoundAccessTokens?: boolean;
}
