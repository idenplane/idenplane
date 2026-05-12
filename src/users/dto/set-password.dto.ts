import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    description: 'If true, the user must change the password on next login',
  })
  @IsOptional()
  @IsBoolean()
  temporary?: boolean;
}
