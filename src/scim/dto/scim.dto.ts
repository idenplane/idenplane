/**
 * SCIM DTOs for request/response types
 */

export class CreateScimTokenDto {
  name: string;
  description?: string;
  scopes?: string[];
  expiresAt?: Date;
}
