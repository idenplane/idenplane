import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateIdentityProviderDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'alias must be lowercase alphanumeric with hyphens',
  })
  alias!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, default: 'oidc' })
  @IsOptional()
  @IsString()
  providerType?: string;

  @ApiProperty()
  @IsString()
  clientId!: string;

  @ApiProperty()
  @IsString()
  clientSecret!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  authorizationUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  tokenUrl!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  userinfoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  jwksUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiProperty({ required: false, default: 'openid email profile' })
  @IsOptional()
  @IsString()
  defaultScopes?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  trustEmail?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  linkOnly?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  syncUserProfile?: boolean;
}
