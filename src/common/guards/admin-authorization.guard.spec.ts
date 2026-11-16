import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthorizationGuard } from './admin-authorization.guard.js';
import { Public } from '../decorators/public.decorator.js';
import {
  AdminMfaExempt,
  AdminScope,
  RequireRecentAdminMfa,
} from '../decorators/admin-access.decorator.js';
import type { AdminPrincipalService } from '../../admin-rbac/admin-principal.service.js';
import type { AdminPrincipal } from '../../admin-rbac/admin-access-policy.js';

@Controller('admin/realms/:realmName/things')
class Things {
  @Get()
  list() {}

  @Delete(':id')
  remove() {}

  @Get('open')
  @Public()
  open() {}
}

@Controller('admin/plugins')
class Plugins {
  @Get(':name')
  one() {}
}

@Controller('admin/auth')
class Me {
  @Get('me')
  @AdminScope('self')
  me() {}

  @Get('mfa')
  @AdminScope('self')
  @AdminMfaExempt('always')
  status() {}

  @Get('mfa/totp')
  @AdminScope('self')
  @AdminMfaExempt('first-factor')
  enrol() {}

  @Delete('mfa/totp')
  @AdminScope('self')
  @RequireRecentAdminMfa()
  removeTotp() {}
}

@Controller('realms/:realmName/account')
class EndUser {
  @Get()
  get() {}
}

const REALM_A = { id: 'id-a', name: 'realm-a' };

function principal(
  roles: AdminPrincipal['roles'],
  realmIds: string[] = [],
): AdminPrincipal {
  return {
    kind: 'user',
    userId: 'sample-user',
    username: 'sample',
    roles,
    realmIds: new Set(realmIds),
  };
}

describe('AdminAuthorizationGuard', () => {
  let load: jest.Mock;
  let resolveRealm: jest.Mock;
  let adminMfaPolicy: jest.Mock;
  let guard: AdminAuthorizationGuard;

  beforeEach(() => {
    load = jest.fn();
    resolveRealm = jest.fn().mockResolvedValue(REALM_A);
    adminMfaPolicy = jest
      .fn()
      .mockResolvedValue({ required: false, source: 'setting' });
    guard = new AdminAuthorizationGuard(new Reflector(), {
      load,
      resolveRealm,
      adminMfaPolicy,
    } as unknown as AdminPrincipalService);
  });

  function ctx(
    controller: object,
    handler: string,
    request: Record<string, unknown>,
    type = 'http',
  ): ExecutionContext {
    return {
      getType: () => type,
      getClass: () => controller,
      getHandler: () =>
        (controller as { prototype: Record<string, unknown> }).prototype[
          handler
        ],
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  const req = (method: string, path: string, params = {}) => ({
    method,
    path,
    params,
    adminUser: { userId: 'sample-user', roles: ['super-admin'] },
  });

  it('skips public routes and non-admin routes', async () => {
    await expect(
      guard.canActivate(ctx(Things, 'open', { method: 'GET', path: '/x' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx(EndUser, 'get', { method: 'GET', path: '/realms/a/account' }),
      ),
    ).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses an admin route that authentication did not mark', async () => {
    await expect(
      guard.canActivate(
        ctx(Things, 'list', { method: 'GET', path: '/admin/realms/a/things' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses non-HTTP contexts', async () => {
    await expect(
      guard.canActivate(ctx(Things, 'list', {}, 'graphql')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaces token roles with current roles and exposes the principal', async () => {
    const current = principal(['view-only']);
    load.mockResolvedValue(current);
    const request = req('GET', '/admin/realms/realm-a/things', {
      realmName: 'realm-a',
    });
    await expect(guard.canActivate(ctx(Things, 'list', request))).resolves.toBe(
      true,
    );
    expect(request.adminUser.roles).toEqual(['view-only']);
    expect((request as Record<string, unknown>)['adminPrincipal']).toBe(
      current,
    );
  });

  it('lets a realm-admin change its realm and not another', async () => {
    load.mockResolvedValue(principal(['realm-admin'], [REALM_A.id]));
    await expect(
      guard.canActivate(
        ctx(
          Things,
          'remove',
          req('DELETE', '/admin/realms/realm-a/things/1', {
            realmName: 'realm-a',
          }),
        ),
      ),
    ).resolves.toBe(true);
    expect(resolveRealm).toHaveBeenCalledWith('realm-a', 'name');

    resolveRealm.mockResolvedValue({ id: 'id-b', name: 'realm-b' });
    await expect(
      guard.canActivate(
        ctx(
          Things,
          'remove',
          req('DELETE', '/admin/realms/realm-b/things/1', {
            realmName: 'realm-b',
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses view-only changes before the handler runs', async () => {
    load.mockResolvedValue(principal(['view-only']));
    await expect(
      guard.canActivate(
        ctx(
          Things,
          'remove',
          req('DELETE', '/admin/realms/realm-a/things/1', {
            realmName: 'realm-a',
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('decides by the request method, so HEAD reads', async () => {
    load.mockResolvedValue(principal(['view-only']));
    await expect(
      guard.canActivate(
        ctx(
          Things,
          'list',
          req('HEAD', '/admin/realms/realm-a/things', {
            realmName: 'realm-a',
          }),
        ),
      ),
    ).resolves.toBe(true);
  });

  it('refuses an unknown realm to anyone but a super-admin', async () => {
    resolveRealm.mockResolvedValue({ id: null, name: null });
    load.mockResolvedValue(principal(['view-only']));
    const r = req('GET', '/admin/realms/nope/things', { realmName: 'nope' });
    await expect(
      guard.canActivate(ctx(Things, 'list', r)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    load.mockResolvedValue(principal(['super-admin']));
    resolveRealm.mockClear();
    await expect(guard.canActivate(ctx(Things, 'list', r))).resolves.toBe(true);
    expect(resolveRealm).not.toHaveBeenCalled();
  });

  it('refuses a missing realm parameter', async () => {
    load.mockResolvedValue(principal(['view-only']));
    await expect(
      guard.canActivate(
        ctx(Things, 'list', req('GET', '/admin/realms//things', {})),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats a route without a realm parameter as server-wide', async () => {
    load.mockResolvedValue(principal(['realm-admin'], [REALM_A.id]));
    const r = req('GET', '/admin/plugins/realm-a', { name: 'realm-a' });
    await expect(
      guard.canActivate(ctx(Plugins, 'one', r)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    load.mockResolvedValue(principal(['super-admin']));
    await expect(guard.canActivate(ctx(Plugins, 'one', r))).resolves.toBe(true);
  });

  it('opens own-account routes to every admin role, not to none', async () => {
    const r = req('GET', '/admin/auth/me');
    load.mockResolvedValue(principal(['view-only']));
    await expect(guard.canActivate(ctx(Me, 'me', r))).resolves.toBe(true);
    load.mockResolvedValue(principal([]));
    await expect(guard.canActivate(ctx(Me, 'me', r))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('admin console MFA', () => {
    const MFA = 'urn:idenplane:acr:mfa';
    const now = () => Math.floor(Date.now() / 1000);
    const as = (
      who: Partial<{ acr: string; authTime: number }>,
      method: string,
      path: string,
      params = {},
    ) => ({
      method,
      path,
      params,
      adminUser: { userId: 'sample-user', roles: ['super-admin'], ...who },
    });
    const code = async (p: Promise<boolean>) => {
      try {
        await p;
        return 'allowed';
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        return (err.getResponse() as { code?: string }).code ?? 'role';
      }
    };
    const realmList = (who: Partial<{ acr: string; authTime: number }>) =>
      guard.canActivate(
        ctx(
          Things,
          'list',
          as(who, 'GET', '/admin/realms/realm-a/things', {
            realmName: 'realm-a',
          }),
        ),
      );
    const self = (
      handler: string,
      who: Partial<{ acr: string; authTime: number }>,
    ) => guard.canActivate(ctx(Me, handler, as(who, 'GET', '/admin/auth/x')));

    it('leaves an admin without a factor alone while MFA is not required', async () => {
      load.mockResolvedValue(principal(['super-admin']));
      expect(await code(realmList({}))).toBe('allowed');
    });

    it('confines an admin without a factor to enrolment when MFA is required', async () => {
      load.mockResolvedValue(principal(['super-admin']));
      adminMfaPolicy.mockResolvedValue({ required: true, source: 'setting' });
      expect(await code(realmList({}))).toBe('admin_mfa_enrolment_required');
      // Even with an MFA token: a reset admin must enrol again.
      expect(await code(realmList({ acr: MFA, authTime: now() }))).toBe(
        'admin_mfa_enrolment_required',
      );
      expect(await code(self('me', {}))).toBe('admin_mfa_enrolment_required');
      expect(await code(self('status', {}))).toBe('allowed');
      expect(await code(self('enrol', {}))).toBe('allowed');
      expect(await code(self('removeTotp', {}))).toBe(
        'admin_mfa_enrolment_required',
      );
    });

    it('sends a password-only session of an enrolled admin to step-up', async () => {
      load.mockResolvedValue({
        ...principal(['super-admin']),
        mfaEnrolled: true,
      });
      expect(await code(realmList({}))).toBe('admin_mfa_step_up_required');
      expect(await code(self('status', {}))).toBe('allowed');
      expect(await code(self('enrol', {}))).toBe('admin_mfa_step_up_required');
      expect(await code(realmList({ acr: MFA, authTime: now() - 3000 }))).toBe(
        'allowed',
      );
      // The policy is not read for an admin who has a factor.
      expect(adminMfaPolicy).not.toHaveBeenCalled();
    });

    it('asks for a recent check on sensitive routes and for a further factor', async () => {
      load.mockResolvedValue({
        ...principal(['super-admin']),
        mfaEnrolled: true,
      });
      const stale = { acr: MFA, authTime: now() - 16 * 60 };
      const fresh = { acr: MFA, authTime: now() - 60 };
      expect(await code(self('removeTotp', stale))).toBe(
        'admin_recent_mfa_required',
      );
      expect(await code(self('removeTotp', fresh))).toBe('allowed');
      expect(await code(self('enrol', stale))).toBe(
        'admin_recent_mfa_required',
      );
      expect(await code(self('enrol', fresh))).toBe('allowed');
    });

    it('never applies to the admin API key', async () => {
      load.mockResolvedValue({
        kind: 'api-key',
        userId: 'api-key:admin',
        username: null,
        roles: ['super-admin'],
        realmIds: new Set(),
      });
      adminMfaPolicy.mockResolvedValue({ required: true, source: 'setting' });
      expect(await code(realmList({}))).toBe('allowed');
      expect(await code(self('removeTotp', {}))).toBe('allowed');
    });

    it('still gives a disabled admin the role refusal', async () => {
      load.mockResolvedValue(principal([]));
      adminMfaPolicy.mockResolvedValue({ required: true, source: 'setting' });
      expect(await code(realmList({}))).toBe('role');
    });
  });
});
