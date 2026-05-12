import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({
    example: 'admin',
    description: 'Admin username',
  })
  @IsString()
  username!: string;

  @ApiProperty({
    example: 'password123',
    description: 'Admin password',
  })
  @IsString()
  password!: string;
}