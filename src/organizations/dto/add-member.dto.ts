import { IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({ example: 'user-uuid-here' })
  @IsString()
  userId!: string;

  @ApiPropertyOptional({
    enum: ['owner', 'admin', 'member'],
    default: 'member',
  })
  @IsOptional()
  @IsString()
  @IsIn(['owner', 'admin', 'member'])
  role?: string;
}
