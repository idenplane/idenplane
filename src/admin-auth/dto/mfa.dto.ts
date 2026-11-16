import { IsIn, IsObject, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** A TOTP or recovery code. */
export class AdminMfaCodeDto {
  @ApiProperty({ enum: ['totp', 'recovery'] })
  @IsIn(['totp', 'recovery'])
  method!: 'totp' | 'recovery';

  @ApiProperty({
    description: 'The code from the authenticator app, or a recovery code',
  })
  @IsString()
  @MaxLength(64)
  code!: string;
}

/** The handle the first step of a sign-in returned. */
export class AdminMfaTokenDto {
  @ApiProperty({ description: 'The mfa_token from POST /admin/auth/login' })
  @IsString()
  @MaxLength(256)
  mfa_token!: string;
}

/** Second step of a sign-in, with a code. */
export class AdminMfaLoginDto extends AdminMfaCodeDto {
  @ApiProperty({ description: 'The mfa_token from POST /admin/auth/login' })
  @IsString()
  @MaxLength(256)
  mfa_token!: string;
}

/** A passkey assertion (`navigator.credentials.get()` as JSON). */
export class AdminPasskeyAssertionDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  response!: Record<string, unknown>;
}

/** Second step of a sign-in, with a passkey. */
export class AdminMfaPasskeyLoginDto extends AdminPasskeyAssertionDto {
  @ApiProperty({ description: 'The mfa_token from POST /admin/auth/login' })
  @IsString()
  @MaxLength(256)
  mfa_token!: string;
}
