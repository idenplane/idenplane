import { IsEmail, IsOptional, IsUrl, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MagicLinkRequestDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address to send the magic link to' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'https://example.com/auth/magic-link', description: 'Custom URL to include in the magic link email' })
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
