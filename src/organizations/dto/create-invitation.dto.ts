import { IsEmail, IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: ['owner', 'admin', 'member'],
    default: 'member',
  })
  @IsOptional()
  @IsString()
  @IsIn(['owner', 'admin', 'member'])
  role?: string;
}
