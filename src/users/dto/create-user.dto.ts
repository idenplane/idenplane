import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEmail,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const NO_HTML = /^[^<>]*$/;
const NO_HTML_MSG = 'must not contain HTML tags or angle brackets';

export class CreateUserDto {
  @ApiProperty({ example: 'johndoe' })
  @IsString()
  @MinLength(2)
  @Matches(NO_HTML, { message: `username ${NO_HTML_MSG}` })
  username!: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  @Matches(NO_HTML, { message: `firstName ${NO_HTML_MSG}` })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @Matches(NO_HTML, { message: `lastName ${NO_HTML_MSG}` })
  lastName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
