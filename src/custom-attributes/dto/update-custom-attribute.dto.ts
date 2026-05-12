import { PartialType } from '@nestjs/swagger';
import { CreateCustomAttributeDto } from './create-custom-attribute.dto.js';

export class UpdateCustomAttributeDto extends PartialType(
  CreateCustomAttributeDto,
) {}
