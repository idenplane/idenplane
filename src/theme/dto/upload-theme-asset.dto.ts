import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ThemeAssetFileDto {
  @ApiProperty({
    example: 'base64encodedstring',
    description: 'Base64 encoded file data',
  })
  @IsString()
  data!: string;

  @ApiProperty({ example: 'logo.png', description: 'Original filename' })
  @IsString()
  filename!: string;

  @ApiProperty({ example: 'image/png', description: 'MIME type of the file' })
  @IsString()
  mimeType!: string;

  @ApiPropertyOptional({ example: 102400, description: 'File size in bytes' })
  @IsOptional()
  size?: number;
}

export class UploadThemeAssetDto {
  @ApiProperty({
    type: [ThemeAssetFileDto],
    description: 'Array of files to upload',
  })
  @IsArray()
  @ValidateNested({ each: true })
  // Without it the items stay plain objects, and the whitelisting
  // ValidationPipe rejected every one of their fields.
  @Type(() => ThemeAssetFileDto)
  files!: ThemeAssetFileDto[];

  @ApiPropertyOptional({ description: 'Theme ID to associate assets with' })
  @IsOptional()
  @IsString()
  themeId?: string;
}
