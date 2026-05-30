import {
  IsEmail,
  IsOptional,
  IsUrl,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MagicLinkRequestDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send the magic link to',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'my-client',
    description:
      'OAuth client_id whose registered redirect URIs allowlist `magicLinkUrl`. Required — the magic-link email points at an external callback, so the target must be allowlisted just like an OAuth redirect_uri (otherwise the email is a token-exfiltration phishing vector).',
  })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiPropertyOptional({
    example: 'https://example.com/auth/magic-link',
    description:
      "Callback URL embedded in the magic-link email. Must match one of the registered `redirectUris` of `clientId` (canonical match, same rule as OAuth `redirect_uri`). If omitted, the client's first registered redirect URI is used.",
  })
  @IsOptional()
  @IsUrl()
  magicLinkUrl?: string;
}

export class MagicLinkVerifyDto {
  @ApiProperty({ example: 'abc123def456', description: 'The magic link token' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
