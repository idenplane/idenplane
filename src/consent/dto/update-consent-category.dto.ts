import { PartialType } from '@nestjs/swagger';
import { CreateConsentCategoryDto } from './create-consent-category.dto.js';

export class UpdateConsentCategoryDto extends PartialType(CreateConsentCategoryDto) {}
