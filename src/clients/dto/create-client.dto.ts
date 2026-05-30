import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  IsArray,
  MinLength,
  registerDecorator,
  ValidationOptions,
  ValidationArguments as _ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @IsOptional()
  @IsBoolean()
  publicClient?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
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
  @IsOptional()
  @IsBoolean()
  requireConsent?: boolean;

  @ApiPropertyOptional({ example: 'https://example.com/backchannel-logout' })
  @IsOptional()
  @IsString()
  backchannelLogoutUri?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
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
}
