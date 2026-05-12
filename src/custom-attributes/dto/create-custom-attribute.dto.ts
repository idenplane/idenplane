import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsArray,
  IsInt,
  Min,
  MinLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const ATTRIBUTE_TYPES = [
  'text',
  'number',
  'boolean',
  'select',
  'multi-select',
] as const;
const NO_HTML = /^[^<>]*$/;
const NO_HTML_MSG = 'must not contain HTML tags or angle brackets';

export class CreateCustomAttributeDto {
  @ApiProperty({ example: 'phone_number' })
  @IsString()
  @MinLength(1)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'name must start with a lowercase letter and contain only lowercase letters, digits, and underscores',
  })
  name!: string;

  @ApiProperty({ example: 'Phone Number' })
  @IsString()
  @MinLength(1)
  @Matches(NO_HTML, { message: `displayName ${NO_HTML_MSG}` })
  displayName!: string;

  @ApiPropertyOptional({ enum: ATTRIBUTE_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(ATTRIBUTE_TYPES)
  type?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  showOnRegistration?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showOnProfile?: boolean;

  @ApiPropertyOptional({
    description: 'Options for select/multi-select types',
    example: ['Option A', 'Option B'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({
    example: 'phone_number',
    description: 'OIDC claim name to map this attribute to',
  })
  @IsOptional()
  @IsString()
  @Matches(NO_HTML, { message: `mapToOidcClaim ${NO_HTML_MSG}` })
  mapToOidcClaim?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
