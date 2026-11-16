import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivateAdminTotpDto {
  @ApiProperty({ description: 'The first code the authenticator app shows' })
  @IsString()
  @MaxLength(16)
  code!: string;
}

export class RegisterAdminPasskeyDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  response!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Laptop security key' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

export class SetAdminMfaPolicyDto {
  @ApiProperty({ description: 'Require a second factor for every admin' })
  @IsBoolean()
  required!: boolean;
}
