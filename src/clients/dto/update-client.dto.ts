import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto.js';

// skipNullProperties: false, so the optional wrapper skips only absent
// fields. A field that accepts null keeps its own @IsOptional(); the
// non-nullable ones (the booleans) answer null with 400, not a 500.
export class UpdateClientDto extends PartialType(
  OmitType(CreateClientDto, ['clientId'] as const),
  { skipNullProperties: false },
) {}
