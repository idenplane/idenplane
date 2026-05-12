import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateThemeDto {
  @ApiProperty({ example: 'my-custom-theme' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'My Custom Theme' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'A custom theme for my organization' })
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
}
