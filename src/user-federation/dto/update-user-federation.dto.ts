import { PartialType } from '@nestjs/swagger';
import { CreateUserFederationDto } from './create-user-federation.dto.js';

export class UpdateUserFederationDto extends PartialType(
  CreateUserFederationDto,
) {}
