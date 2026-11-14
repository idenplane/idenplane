import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SetAdminRealmsDto {
  @ApiProperty({
    example: ['acme-demo', 'example-shop'],
    description:
      'Names of the realms this realm-admin manages. Replaces the current set. The master realm is not allowed.',
    type: [String],
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(255, { each: true })
  realms!: string[];
}
