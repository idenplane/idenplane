import { IsString, IsOptional, IsObject } from 'class-validator';

export class StartRegistrationDto {
  @IsOptional()
  @IsString()
  friendlyName?: string;
}

export class VerifyRegistrationDto {
  @IsObject()
  response: Record<string, any>;

  @IsOptional()
  @IsString()
  friendlyName?: string;
}

export class StartAuthenticationDto {
  @IsOptional()
  @IsString()
  username?: string;
}

export class VerifyAuthenticationDto {
  @IsObject()
  response: Record<string, any>;

  // OAuth params carried through the passkey login flow
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

  @IsOptional()
  @IsString()
  prompt?: string;
}
