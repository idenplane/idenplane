import { IsObject, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RenderThemePreviewDto {
  @ApiPropertyOptional({
    description:
      'Theme styles including colors, typography, spacing, borders, shadows',
  })
  @IsOptional()
  @IsObject()
  styles?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Theme components configuration' })
  @IsOptional()
  @IsArray()
  components?: unknown[];

  @ApiPropertyOptional({
    description: 'Theme assets (logo, favicon, background images)',
  })
  @IsOptional()
  @IsObject()
  assets?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Theme settings (app title, description, feature toggles)',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, string>;
}
