import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { UsageController } from './usage.controller.js';
import { UsageQueryDto } from './dto/usage-query.dto.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { resolveAdminRoutePolicy } from '../admin-rbac/admin-route-policy.js';
import {
  decideAdminAccess,
  REALM_ADMIN,
  SUPER_ADMIN,
  VIEW_ONLY,
  type AdminPrincipal,
  type AdminRole,
} from '../admin-rbac/admin-access-policy.js';

describe('UsageController', () => {
  const report = { version: '0.0.0' };
  let usageService: { getUsage: jest.Mock };
  let controller: UsageController;

  beforeEach(() => {
    usageService = { getUsage: jest.fn().mockResolvedValue(report) };
    controller = new UsageController(usageService as never);
  });

  it('passes the month through', async () => {
    await expect(controller.getUsage({ month: '2026-10' })).resolves.toBe(
      report,
    );
    expect(usageService.getUsage).toHaveBeenCalledWith('2026-10');
  });

  it('defaults to the current month', async () => {
    await controller.getUsage({});
    expect(usageService.getUsage).toHaveBeenCalledWith(undefined);
  });

  it('is behind the admin credentials guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      UsageController,
    ) as unknown[];
    expect(guards).toContain(AdminApiKeyGuard);
  });

  describe('authorization', () => {
    const policy = resolveAdminRoutePolicy(
      UsageController,
      UsageController.prototype.getUsage,
    );
    const principal = (
      kind: 'user' | 'api-key',
      role: AdminRole,
    ): AdminPrincipal => ({
      kind,
      userId: kind === 'api-key' ? 'api-key:admin' : `sample-${role}`,
      username: null,
      roles: [role],
      realmIds: new Set(['realm-a']),
    });
    const allowed = (p: AdminPrincipal) =>
      decideAdminAccess(p, policy, 'read', null).allowed;

    it('is server-wide', () => {
      expect(policy.scope).toEqual({ kind: 'global' });
      expect(policy.problem).toBeUndefined();
    });

    it('allows the admin API key and super-admins only', () => {
      expect(allowed(principal('api-key', SUPER_ADMIN))).toBe(true);
      expect(allowed(principal('user', SUPER_ADMIN))).toBe(true);
      expect(allowed(principal('user', REALM_ADMIN))).toBe(false);
      expect(allowed(principal('user', VIEW_ONLY))).toBe(false);
    });
  });

  describe('query validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const meta: ArgumentMetadata = { type: 'query', metatype: UsageQueryDto };

    it('accepts YYYY-MM and no month at all', async () => {
      await expect(pipe.transform({ month: '2026-10' }, meta)).resolves.toEqual(
        { month: '2026-10' },
      );
      await expect(pipe.transform({}, meta)).resolves.toEqual({});
    });

    it.each(['2026-13', '2026-1', 'october', '2026-10-01'])(
      'refuses month=%j',
      async (month) => {
        await expect(pipe.transform({ month }, meta)).rejects.toBeDefined();
      },
    );

    it('refuses unknown parameters', async () => {
      await expect(
        pipe.transform({ from: '2026-10-01' }, meta),
      ).rejects.toBeDefined();
    });
  });
});
