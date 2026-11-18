import { ApiProperty } from '@nestjs/swagger';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import {
  NAMEID_FORMATS,
  SAML_CONFIG_LIMITS,
  validateSamlConfig,
} from '../saml-config.js';

/**
 * Validates a `samlConfig` with the shared validator (validateSamlConfig),
 * so the admin API refuses exactly what the imports refuse, with the same
 * messages.
 */
export function IsSamlConfig(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSamlConfig',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return validateSamlConfig(value).ok;
        },
        defaultMessage(args: ValidationArguments): string {
          const result = validateSamlConfig(args.value);
          return result.ok ? '' : result.errors.join('; ');
        },
      },
    });
  };
}

class SamlAttributeMappingDto {
  @ApiProperty({ required: false, description: 'Attribute holding the email' })
  email?: string;
  @ApiProperty({ required: false })
  firstName?: string;
  @ApiProperty({ required: false })
  lastName?: string;
  @ApiProperty({
    required: false,
    description: "Read when usernameSource is 'attribute'",
  })
  username?: string;
}

/** The shape of `samlConfig`, for the API documentation. */
export class SamlConfigDto {
  @ApiProperty({ description: 'The IdP entity ID (the only Issuer accepted)' })
  entityId!: string;

  @ApiProperty({ description: 'The IdP single sign-on URL (https)' })
  ssoUrl!: string;

  @ApiProperty({
    required: false,
    enum: ['redirect', 'post'],
    default: 'redirect',
  })
  ssoBinding?: 'redirect' | 'post';

  @ApiProperty({
    type: [String],
    description: `IdP signing certificates (PEM or base64), RSA ≥ ${SAML_CONFIG_LIMITS.minRsaBits} bits; up to ${SAML_CONFIG_LIMITS.maxCertificates}, any of them verifies (rollover)`,
  })
  signingCertificates!: string[];

  @ApiProperty({
    required: false,
    default: NAMEID_FORMATS.persistent,
    enum: Object.values(NAMEID_FORMATS),
  })
  nameIdFormat?: string;

  @ApiProperty({ required: false, default: false })
  signAuthnRequests?: boolean;

  @ApiProperty({ required: false, default: true })
  wantAssertionsSigned?: boolean;

  @ApiProperty({ required: false, default: false })
  wantResponseSigned?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Accept RSA-SHA1 signatures and SHA-1 digests (not recommended)',
  })
  allowSha1?: boolean;

  @ApiProperty({
    required: false,
    description: 'Stored only; SAML logout is not supported',
  })
  sloUrl?: string;

  @ApiProperty({
    required: false,
    default: SAML_CONFIG_LIMITS.defaultClockSkewSeconds,
    maximum: SAML_CONFIG_LIMITS.maxClockSkewSeconds,
  })
  clockSkewSeconds?: number;

  @ApiProperty({
    required: false,
    description: 'Attribute identifying the user (default: the NameID)',
  })
  subjectAttribute?: string;

  @ApiProperty({
    required: false,
    enum: ['nameId', 'email', 'attribute'],
    default: 'email',
  })
  usernameSource?: 'nameId' | 'email' | 'attribute';

  @ApiProperty({ required: false, type: SamlAttributeMappingDto })
  attributes?: SamlAttributeMappingDto;
}
