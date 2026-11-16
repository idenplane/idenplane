import { Controller, Delete, Get, Post } from '@nestjs/common';
import {
  AdminMfaExempt,
  AdminRealmParam,
  AdminScope,
  AdminSensitiveRead,
  RequireRecentAdminMfa,
} from '../common/decorators/admin-access.decorator.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';
import {
  fullRoutePaths,
  resolveAdminRoutePolicy,
  routeParamNames,
} from './admin-route-policy.js';

@Controller('admin/realms/:realmName/things')
class RealmThings {
  @Get()
  list() {}

  @Get(':id/secret')
  @AdminSensitiveRead()
  secret() {}

  @Delete(':id')
  @RequireAdminRoles(['super-admin'])
  remove() {}

  @Get('server')
  @AdminScope('global')
  server() {}
}

@Controller('admin/realms/:realm/flows')
@AdminRealmParam('realm', 'id-or-name')
class Flows {
  @Get()
  list() {}
}

@Controller('admin/plugins')
class Plugins {
  @Get(':name')
  one() {}
}

@Controller('admin/plugins')
@AdminScope('global')
class MarkedPlugins {
  @Get(':name')
  one() {}

  @Get('mine')
  @AdminScope('self')
  mine() {}
}

@Controller('admin/odd')
class Odd {
  @Post(':realmName/x/:realm')
  both() {}

  @Get(':tenant')
  @AdminRealmParam('missing')
  missing() {}

  @Get(':tenant/y')
  @AdminRealmParam('tenant')
  tenant() {}
}

@Controller('admin/auth/mfa')
@AdminScope('self')
class OwnMfa {
  @Get()
  @AdminMfaExempt('always')
  status() {}

  @Post('totp')
  @AdminMfaExempt('first-factor')
  enrol() {}

  @Delete('totp')
  @RequireRecentAdminMfa()
  remove() {}
}

@Controller('admin/realms/:realmName/mfa-things')
class MisplacedExemption {
  @Get()
  @AdminMfaExempt('always')
  list() {}

  @Post()
  @AdminScope('self')
  @AdminMfaExempt('bogus' as never)
  bogus() {}
}

@Controller(['admin/a/:realmName', 'admin/b'])
class TwoPaths {
  @Get()
  get() {}
}

const policy = (c: object, name: string) =>
  resolveAdminRoutePolicy(
    c,
    (c as { prototype: Record<string, object> }).prototype[name],
  );

describe('resolveAdminRoutePolicy', () => {
  it('reads :realmName as a realm by name', () => {
    expect(policy(RealmThings, 'list')).toEqual({
      scope: { kind: 'realm', param: 'realmName', lookup: 'name' },
      sensitiveRead: false,
      requiredRoles: [],
      mfaExempt: null,
      recentMfa: false,
    });
  });

  it('marks secret-revealing reads', () => {
    expect(policy(RealmThings, 'secret').sensitiveRead).toBe(true);
  });

  it('collects @RequireAdminRoles', () => {
    expect(policy(RealmThings, 'remove').requiredRoles).toEqual([
      { roles: ['super-admin'], requireAll: false },
    ]);
  });

  it('lets @AdminScope on a handler win over a realm parameter', () => {
    expect(policy(RealmThings, 'server').scope).toEqual({ kind: 'global' });
  });

  it('uses @AdminRealmParam with its lookup', () => {
    expect(policy(Flows, 'list').scope).toEqual({
      kind: 'realm',
      param: 'realm',
      lookup: 'id-or-name',
    });
    expect(policy(Odd, 'tenant').scope).toEqual({
      kind: 'realm',
      param: 'tenant',
      lookup: 'name',
    });
  });

  it('fails closed on a route with no realm parameter', () => {
    const p = policy(Plugins, 'one');
    expect(p.scope).toEqual({ kind: 'global' });
    expect(p.problem).toContain('no realm parameter');
  });

  it('accepts an explicit global or self scope without a problem', () => {
    expect(policy(MarkedPlugins, 'one')).toMatchObject({
      scope: { kind: 'global' },
    });
    expect(policy(MarkedPlugins, 'one').problem).toBeUndefined();
    expect(policy(MarkedPlugins, 'mine').scope).toEqual({ kind: 'self' });
  });

  it('fails closed on two realm parameters', () => {
    const p = policy(Odd, 'both');
    expect(p.scope).toEqual({ kind: 'global' });
    expect(p.problem).toContain('more than one');
  });

  it('fails closed when @AdminRealmParam names a missing parameter', () => {
    const p = policy(Odd, 'missing');
    expect(p.scope).toEqual({ kind: 'global' });
    expect(p.problem).toContain('missing');
  });

  it('fails closed when one of several paths has no realm', () => {
    const p = policy(TwoPaths, 'get');
    expect(p.scope).toEqual({ kind: 'global' });
    expect(p.problem).toBeDefined();
  });
});

describe('route path helpers', () => {
  it('reads parameter names without their modifiers', () => {
    expect(routeParamNames('/admin/realms/:realmName/x/:id?/:rest*')).toEqual([
      'realmName',
      'id',
      'rest',
    ]);
    expect(routeParamNames('/a/:v(\\d+)')).toEqual(['v']);
    expect(routeParamNames('/a/b')).toEqual([]);
  });

  it('joins controller and handler paths', () => {
    expect(fullRoutePaths(RealmThings, RealmThings.prototype.list)).toEqual([
      '/admin/realms/:realmName/things',
    ]);
    expect(fullRoutePaths(TwoPaths, TwoPaths.prototype.get)).toEqual([
      '/admin/a/:realmName',
      '/admin/b',
    ]);
  });

  it('reads the admin MFA exemptions and the recent-MFA requirement', () => {
    expect(policy(OwnMfa, 'status')).toMatchObject({
      scope: { kind: 'self' },
      mfaExempt: 'always',
      recentMfa: false,
    });
    expect(policy(OwnMfa, 'enrol').mfaExempt).toBe('first-factor');
    expect(policy(OwnMfa, 'remove')).toMatchObject({
      mfaExempt: null,
      recentMfa: true,
    });
    expect(policy(OwnMfa, 'status').problem).toBeUndefined();
  });

  it('refuses an MFA exemption off an own-account route, or an unknown one', () => {
    for (const name of ['list', 'bogus']) {
      const p = policy(MisplacedExemption, name);
      expect(p.scope).toEqual({ kind: 'global' });
      expect(p.mfaExempt).toBeNull();
      expect(p.problem).toMatch(/AdminMfaExempt/);
    }
  });
});
