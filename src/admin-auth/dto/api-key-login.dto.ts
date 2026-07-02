import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminApiKeyLoginDto {
  @ApiProperty({
    description: 'Admin API key',
  })
  @IsString()
  apiKey!: string;
}
