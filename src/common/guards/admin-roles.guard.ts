import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  REQUIRED_ADMIN_ROLES_KEY,
  AdminRolesOptions,
} from '../decorators/require-admin-roles.decorator.js';
import { AdminAuthService } from '../../admin-auth/admin-auth.service.js';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<AdminRolesOptions>(
      REQUIRED_ADMIN_ROLES_KEY,
      context.getHandler(),
    );

    if (!options || options.roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & { adminUser?: { roles: string[] } }
    >();
    const adminUser = request.adminUser;

    if (!adminUser?.roles) {
      throw new ForbiddenException('No admin roles found');
    }

    const { roles, requireAll } = options;

    if (requireAll) {
      const hasAllRoles = roles.every((role) =>
        this.adminAuthService.hasRole(adminUser.roles, role),
      );
      if (!hasAllRoles) {
        throw new ForbiddenException(
          `Insufficient permissions. Required roles: ${roles.join(', ')}`,
        );
      }
    } else {
      const hasAnyRole = roles.some((role) =>
        this.adminAuthService.hasRole(adminUser.roles, role),
      );
      if (!hasAnyRole) {
        throw new ForbiddenException(
          `Insufficient permissions. Required at least one of: ${roles.join(', ')}`,
        );
      }
    }

    return true;
  }
}
