import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokenRequestDto {
  @ApiProperty({
    description: 'OAuth2 grant type',
    enum: [
      'password',
      'client_credentials',
      'refresh_token',
      'authorization_code',
      'urn:ietf:params:oauth:grant-type:device_code',
    ],
    example: 'client_credentials',
  })
  grant_type!: string;

  @ApiPropertyOptional({
    description: 'Client identifier',
    example: 'my-app',
  })
  client_id?: string;

  @ApiPropertyOptional({
    description: 'Client secret',
    example: 'my-client-secret',
  })
  client_secret?: string;

  @ApiPropertyOptional({
    description: 'Username (for password grant)',
    example: 'john',
  })
  username?: string;

  @ApiPropertyOptional({
    description: 'Password (for password grant)',
    example: 'secret',
  })
  password?: string;

  @ApiPropertyOptional({
    description: 'Refresh token (for refresh_token grant)',
  })
  refresh_token?: string;

  @ApiPropertyOptional({
    description: 'Authorization code (for authorization_code grant)',
  })
  code?: string;

  @ApiPropertyOptional({
    description: 'Redirect URI (for authorization_code grant)',
    example: 'http://localhost:3000/callback',
  })
  redirect_uri?: string;

  @ApiPropertyOptional({
    description: 'PKCE code verifier (for authorization_code grant with PKCE)',
  })
  code_verifier?: string;

  @ApiPropertyOptional({
    description: 'Device code (for device_code grant)',
  })
  device_code?: string;

  @ApiPropertyOptional({
    description: 'Requested scopes (space-separated)',
    example: 'openid profile email',
  })
  scope?: string;

  @ApiPropertyOptional({
    description: 'TOTP code (when MFA is required)',
    example: '123456',
  })
  totp?: string;

  @ApiPropertyOptional({
    description:
      'MFA token (when MFA is required, returned from initial auth attempt)',
  })
  mfa_token?: string;
}
