import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { adminAuthenticationRequired } from './admin-api-key.guard.js';
import {
  resolveAdminRoutePolicy,
  type AdminRoutePolicy,
} from '../../admin-rbac/admin-route-policy.js';
import {
  accessForMethod,
  decideAdminAccess,
  isSuperAdmin,
  type AdminPrincipal,
  type ResolvedRealm,
} from '../../admin-rbac/admin-access-policy.js';
import {
  AdminPrincipalService,
  type AuthenticatedAdmin,
} from '../../admin-rbac/admin-principal.service.js';

export type AuthorizedAdminRequest = Request & {
  adminUser?: AuthenticatedAdmin;
  adminPrincipal?: AdminPrincipal;
};

/**
 * Admin authorization: the second step after AdminApiKeyGuard
 * (authentication). Registered globally right after it, so it runs on every
 * route, on exactly the routes authentication enforces (the same four
 * conditions, through `adminAuthenticationRequired`).
 *
 * The default policy (see docs/admin-rbac):
 * - reads: any admin role; a realm-admin only in its realms;
 * - changes: super-admin, or a realm-admin in its realms;
 * - server-wide routes, and routes without a recognisable realm: super-admin;
 * - reads that reveal secrets (`@AdminSensitiveRead()`): as changes;
 * - `@AdminScope('self')`: every admin;
 * - every `@RequireAdminRoles` on the handler or controller must hold too.
 *
 * It puts the resolved principal on `request.adminPrincipal`, and the admin
 * roles from the database on `request.adminUser.roles`, so AdminRolesGuard
 * and handlers see current roles rather than the token's.
 */
@Injectable()
export class AdminAuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthorizationGuard.name);
  private readonly policies = new WeakMap<object, AdminRoutePolicy>();

  constructor(
    private readonly reflector: Reflector,
    private readonly principals: AdminPrincipalService,
  ) {}

  private policyFor(controller: object, handler: object): AdminRoutePolicy {
    let policy = this.policies.get(handler);
    if (!policy) {
      policy = resolveAdminRoutePolicy(controller, handler);
      this.policies.set(handler, policy);
    }
    return policy;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only HTTP admin routes exist. The GraphQL admin module (src/graphql)
    // is not mounted, and /ws/events is a raw WebSocket for end users, not a
    // Nest gateway. Anything else that ever reaches a guard is refused until
    // it gets an authorization design of its own.
    if (context.getType() !== 'http') {
      throw new ForbiddenException('Admin authorization covers HTTP only');
    }

    const handler = context.getHandler();
    const controller = context.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      controller,
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthorizedAdminRequest>();
    if (
      !adminAuthenticationRequired(
        handler,
        controller,
        request.path ?? '',
        this.reflector,
      )
    ) {
      return true;
    }

    // Authentication ran first and either set this or refused the request.
    // Anything else is a wiring fault: refuse.
    const admin = request.adminUser;
    if (!admin || typeof admin.userId !== 'string') {
      throw new UnauthorizedException('Invalid or missing admin credentials');
    }

    const principal = await this.principals.load(admin);
    request.adminPrincipal = principal;
    admin.roles = [...principal.roles];

    const policy = this.policyFor(controller, handler);
    // No method is not a read: fail closed.
    const access = accessForMethod(request.method ?? 'POST', policy);

    let realm: ResolvedRealm | null = null;
    if (policy.scope.kind === 'realm' && !isSuperAdmin(principal)) {
      const raw: unknown = request.params?.[policy.scope.param];
      const value = Array.isArray(raw) ? (raw[0] as unknown) : raw;
      realm =
        typeof value === 'string' && value.length > 0
          ? await this.principals.resolveRealm(value, policy.scope.lookup)
          : null;
    }

    const decision = decideAdminAccess(principal, policy, access, realm);
    if (!decision.allowed) {
      this.logger.warn(
        `Admin ${principal.userId} refused ${request.method} ${request.path}: ${decision.reason}`,
      );
      throw new ForbiddenException(
        'Your admin role does not allow this action',
      );
    }
    return true;
  }
}
