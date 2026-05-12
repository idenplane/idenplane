import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const FIELD_TYPES = [
  'text',
  'email',
  'password',
  'number',
  'select',
  'checkbox',
] as const;

export class CreateRegistrationFieldDto {
  @ApiProperty({
    example: 'company_name',
    description: 'Field name (unique per realm)',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    example: 'Company Name',
    description: 'Display label for the field',
  })
  @IsString()
  displayName!: string;

  @ApiPropertyOptional({ enum: FIELD_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(FIELD_TYPES)
  type?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Whether the field is required during registration',
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    description: 'Placeholder text shown in the input field',
  })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional({ description: 'Help text displayed below the field' })
  @IsOptional()
  @IsString()
  helpText?: string;

  @ApiPropertyOptional({
    description: 'Options for select-type fields',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ description: 'Validation regex pattern' })
  @IsOptional()
  @IsString()
  validationPattern?: string;

  @ApiPropertyOptional({ description: 'Default value for the field' })
  @IsOptional()
  @IsString()
  defaultValue?: string;

  @ApiPropertyOptional({ default: 0, description: 'Sort order for display' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Whether this field is enabled',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRegistrationFieldDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ enum: FIELD_TYPES })
  @IsOptional()
  @IsIn(FIELD_TYPES)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  helpText?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validationPattern?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
