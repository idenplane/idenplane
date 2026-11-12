import { IsString, IsOptional, Matches } from 'class-validator';

const NO_HTML = /^[^<>]*$/;
const NO_HTML_MSG = 'must not contain HTML tags';

// NestJS ValidationPipe with forbidNonWhitelisted:true rejects any body
// property that is not explicitly decorated — TypeScript index signatures
// ([key: string]: unknown) are not visible to class-validator and therefore
// do NOT count as a whitelist entry.  Every field the HTML form submits
// must be declared here with @IsOptional() so the pipe accepts it.

export class LoginDto {
  @IsString()
  @Matches(NO_HTML, { message: `username ${NO_HTML_MSG}` })
  username!: string;

  @IsString()
  password!: string;

  // CSRF — the form submits _csrf (double-submit cookie pattern).
  // csrf_token kept for any legacy callers.
  @IsOptional()
  @IsString()
  _csrf?: string;

  @IsOptional()
  @IsString()
  csrf_token?: string;

  // OAuth / OIDC context preserved as hidden form fields so the server can
  // complete the authorization-code flow after successful authentication.
  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  response_type?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  code_challenge?: string;

  @IsOptional()
  @IsString()
  code_challenge_method?: string;

  // OIDC prompt, carried through the form so a fresh sign-in honours
  // prompt=consent.
  @IsOptional()
  @IsString()
  prompt?: string;

  // Risk-assessment device fingerprint (injected by browser-side JS).
  @IsOptional()
  @IsString()
  device_fingerprint?: string;

  // Remember-me checkbox — present as "true" when checked, absent otherwise.
  @IsOptional()
  @IsString()
  rememberMe?: string;
}

// All login-flow forms (TOTP, change-password, etc.) include the same
// OAuth context as hidden inputs so state is preserved across steps.
export class OAuthContextDto {
  @IsOptional()
  @IsString()
  _csrf?: string;

  @IsOptional()
  @IsString()
  csrf_token?: string;

  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  response_type?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  code_challenge?: string;

  @IsOptional()
  @IsString()
  code_challenge_method?: string;

  // OIDC prompt, carried through the form so a fresh sign-in honours
  // prompt=consent.
  @IsOptional()
  @IsString()
  prompt?: string;
}

// Field names match the totp.hbs form: name="code" and name="recoveryCode".
// Either code or recoveryCode must be present; both are optional here because
// the controller decides which path to take at runtime.
export class TotpDto extends OAuthContextDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'OTP code must be 6-8 digits' })
  code?: string;

  @IsOptional()
  @IsString()
  recoveryCode?: string;

  /** A code received by text message. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,10}$/, { message: 'SMS code must be 6-10 digits' })
  smsCode?: string;

  @IsOptional()
  @IsString()
  session_id?: string;
}

// Field names match change-password.hbs: currentPassword, newPassword, confirmPassword.
export class ChangePasswordDto extends OAuthContextDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;
}

export class ForgotPasswordDto extends OAuthContextDto {
  @IsString()
  @Matches(NO_HTML, { message: `email ${NO_HTML_MSG}` })
  email!: string;
}

// Field names match reset-password.hbs: token, password, confirmPassword.
export class ResetPasswordDto extends OAuthContextDto {
  @IsString()
  token!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;
}
