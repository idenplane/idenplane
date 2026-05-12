import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ADMIN_ROLES_KEY = 'requiredAdminRoles';

export interface AdminRolesOptions {
  roles: string[];
  requireAll?: boolean;
}

export const RequireAdminRoles = (roles: string[], requireAll = false) =>
  SetMetadata(REQUIRED_ADMIN_ROLES_KEY, {
    roles,
    requireAll,
  });
