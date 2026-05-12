import {
  IsString,
  IsBoolean,
  IsOptional,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSsoConnectionDto {
  @ApiPropertyOptional({ example: 'Corporate OIDC' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Provider-specific configuration object',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
