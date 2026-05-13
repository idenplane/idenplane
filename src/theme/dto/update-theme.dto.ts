import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateThemeDto {
  @ApiPropertyOptional({ example: 'Updated Theme Name' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'login',
    description: 'Type: login, account, email, or full',
  })
  @IsOptional()
  @IsString()
  themeType?: string;

  @ApiPropertyOptional({ description: 'CSS variables and styling' })
  @IsOptional()
  @IsObject()
  styles?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Component configurations' })
  @IsOptional()
  @IsObject()
  components?: unknown[];

  @ApiPropertyOptional({ description: 'Logo URLs, favicon, etc.' })
  @IsOptional()
  @IsObject()
  assets?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Custom settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'published' })
  @IsOptional()
  @IsString()
  status?: string;
}
