import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MagicLinkVerifyDto {
  @ApiProperty({
    description: 'The magic link token from the URL',
    example: 'abc123def456...',
  })
  @IsNotEmpty({ message: 'Token is required' })
  @IsString()
  token!: string;
}
