import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReadSamlMetadataDto {
  @ApiProperty({
    required: false,
    description: 'The IdP metadata XML (EntityDescriptor)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024 * 1024)
  xml?: string;

  @ApiProperty({
    required: false,
    description:
      'An https URL to fetch the metadata from (public addresses only)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}
