import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  MinLength,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
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
      target: (object as { constructor: Function }).constructor,
      propertyName,
      options: {
        message:
          'webOrigins must not contain the wildcard "*". Specify explicit origins instead.',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments): boolean {
          if (!Array.isArray(value)) return true; // let @IsArray handle that
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
}
