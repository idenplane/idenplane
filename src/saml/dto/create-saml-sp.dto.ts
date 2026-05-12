import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsUrl,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSamlSpDto {
  @ApiProperty({ example: 'https://sp.example.com/metadata' })
  @IsString()
  @MinLength(1)
  entityId!: string;

  @ApiProperty({ example: 'My Service Provider' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'https://sp.example.com/acs' })
  @IsUrl({ require_tld: false })
  acsUrl!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'https://sp.example.com/slo' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  sloUrl?: string;

  @ApiPropertyOptional({
    description: 'SP X.509 certificate for request verification',
  })
  @IsOptional()
  @IsString()
  certificate?: string;

  @ApiPropertyOptional({
    example: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    default: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  })
  @IsOptional()
  @IsString()
  nameIdFormat?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  signAssertions?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  signResponses?: boolean;

  @ApiPropertyOptional({ example: ['https://sp.example.com/*'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  validRedirectUris?: string[];
}
