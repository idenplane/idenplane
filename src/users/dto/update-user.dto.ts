import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEmail,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const NO_HTML = /^[^<>]*$/;
const NO_HTML_MSG = 'must not contain HTML tags or angle brackets';

export class UpdateUserDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;
}
