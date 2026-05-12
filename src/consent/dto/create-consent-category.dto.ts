import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConsentCategoryDto {
  @ApiProperty({
    example: 'marketing_emails',
    description: 'Unique key within the realm',
  })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'Marketing', description: 'Human-readable name' })
  @IsString()
  displayName!: string;

  @ApiPropertyOptional({
    example: 'Receive marketing communications and newsletters',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Whether consent is mandatory',
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Whether user can toggle this consent',
  })
  @IsOptional()
  @IsBoolean()
  configurableByUser?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Show in account portal' })
  @IsOptional()
  @IsBoolean()
  showInAccountPortal?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Display ordering' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({ default: true, description: 'Enable this category' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
