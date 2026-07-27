import { IsArray, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Represents a role entry in the Keycloak-style format.
 * Accepts both `{ name: string }` and `{ id: string, name: string }` shapes.
 */
class RoleEntry {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;
}

/**
 * DTO for assigning or removing roles.
 *
 * Accepts two equivalent formats:
 *   - `roleNames: string[]`  – simple string array (preferred)
 *   - `roles: { name: string }[]` – Keycloak-compatible object array (id is optional)
 *
 * Use `dto.effectiveNames` in controllers/services — it resolves names from
 * whichever format the caller used, without relying on @Transform which does not
 * fire for absent properties.
 */
export class AssignRolesDto {
  @ApiPropertyOptional({
    example: ['admin', 'user'],
    description: 'Role names to assign/remove (preferred format)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleNames?: string[];

  @ApiPropertyOptional({
    example: [{ name: 'admin' }, { id: 'abc', name: 'user' }],
    description: 'Keycloak-compatible role list (alternative to roleNames)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleEntry)
  roles?: RoleEntry[];

  /**
   * Resolves role names from whichever format the caller used.
   * Prefer this over `dto.roleNames` directly.
   */
  get effectiveNames(): string[] {
    if (this.roleNames && this.roleNames.length > 0) {
      return this.roleNames;
    }
    if (this.roles && this.roles.length > 0) {
      return this.roles
        .map((r) => r.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
    }
    return [];
  }
}
