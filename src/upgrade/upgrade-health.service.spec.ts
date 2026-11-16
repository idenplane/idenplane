import { readFileSync } from 'fs';
import { join } from 'path';
import { CRITICAL_TABLES } from './upgrade-health.service.js';

/**
 * Guard for the class of bug that made the whole upgrade feature unusable
 * (idenplane#1150): `CRITICAL_TABLES` listed Prisma *model* names in the
 * singular ('realm', 'user', 'client', 'scope') while the check runs against
 * `pg_tables`, which only ever sees the physical `@@map(...)` names.
 *
 * Every entry was therefore reported missing, so `GET /admin/upgrade/health`
 * could only ever return healthy:false — which in turn made `POST /admin/upgrade`
 * fail at POST_HEALTH_CHECK *after* `prisma migrate deploy` had already run.
 *
 * This parses the real schema rather than restating the names, so a future
 * `@@map` rename fails here instead of silently breaking upgrades again.
 */
describe('CRITICAL_TABLES', () => {
  const schema = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );

  const mappedTables = new Set(
    [...schema.matchAll(/@@map\((?:name:\s*)?["']([^"']+)["']\)/g)].map(
      (m) => m[1],
    ),
  );

  it('parses a plausible number of @@map names from the schema', () => {
    // Guards the guard: if the regex ever stops matching, the assertions below
    // would vacuously pass against an empty set.
    expect(mappedTables.size).toBeGreaterThan(20);
  });

  it.each([...CRITICAL_TABLES])(
    'critical table %s exists in schema.prisma',
    (table) => {
      expect(mappedTables.has(table)).toBe(true);
    },
  );

  it('lists physical table names, not Prisma model names', () => {
    // The exact mistake that shipped: singular model names that no @@map emits.
    for (const modelName of ['realm', 'user', 'client', 'role', 'scope']) {
      expect(CRITICAL_TABLES as readonly string[]).not.toContain(modelName);
    }
  });
});

describe('UpgradeHealthService.checkBruteForceProtection', () => {
  // Imported lazily so the CRITICAL_TABLES block above stays schema-only.
  const build = async (findMany: jest.Mock) => {
    const { UpgradeHealthService } =
      await import('./upgrade-health.service.js');
    return new UpgradeHealthService({
      realm: { findMany },
    } as never);
  };

  it('passes when every realm has protection on', async () => {
    const svc = await build(jest.fn().mockResolvedValue([]));
    await expect(svc.checkBruteForceProtection()).resolves.toMatchObject({
      name: 'brute_force_protection',
      status: 'pass',
    });
  });

  it('warns and names the realms that have protection off', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ name: 'legacy-demo' }, { name: 'sample' }]);
    const svc = await build(findMany);
    await expect(svc.checkBruteForceProtection()).resolves.toEqual({
      name: 'brute_force_protection',
      status: 'warn',
      message: '2 realm(s) have brute-force protection off',
      details: 'legacy-demo, sample',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bruteForceEnabled: false } }),
    );
  });

  it('only warns, never fails, when the query errors', async () => {
    const svc = await build(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(svc.checkBruteForceProtection()).resolves.toMatchObject({
      status: 'warn',
    });
  });
});

describe('UpgradeHealthService.checkWildcardRedirectUris', () => {
  const build = async (queryRaw: jest.Mock) => {
    const { UpgradeHealthService } =
      await import('./upgrade-health.service.js');
    return new UpgradeHealthService({ $queryRaw: queryRaw } as never);
  };

  it('passes when no client has a wildcard redirect URI', async () => {
    const svc = await build(jest.fn().mockResolvedValue([]));
    await expect(svc.checkWildcardRedirectUris()).resolves.toMatchObject({
      name: 'wildcard_redirect_uris',
      status: 'pass',
    });
  });

  it('warns and names the clients, flagging a wildcard without the opt-in', async () => {
    const svc = await build(
      jest.fn().mockResolvedValue([
        { realm: 'demo', client_id: 'legacy-spa', opt_in: true },
        { realm: 'sample', client_id: 'imported', opt_in: false },
      ]),
    );
    const check = await svc.checkWildcardRedirectUris();
    expect(check.name).toBe('wildcard_redirect_uris');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('2 client(s)');
    expect(check.message).toContain('allowInsecureWildcardRedirectUris');
    expect(check.details).toBe(
      'demo/legacy-spa, sample/imported (opt-in off: the wildcard matches nothing)',
    );
  });

  it('only warns, never fails, when the query errors', async () => {
    const svc = await build(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(svc.checkWildcardRedirectUris()).resolves.toMatchObject({
      name: 'wildcard_redirect_uris',
      status: 'warn',
    });
  });
});

describe('UpgradeHealthService admin MFA checks', () => {
  const build = async (prisma: object) => {
    const { UpgradeHealthService } =
      await import('./upgrade-health.service.js');
    return new UpgradeHealthService(prisma as never);
  };
  afterEach(() => {
    delete process.env['ADMIN_MFA_REQUIRED'];
  });

  it('warns while MFA is not required (an upgraded install)', async () => {
    const svc = await build({
      adminSecurityPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ username: 'sample-admin' }]),
      },
    });
    await expect(svc.checkAdminMfa()).resolves.toEqual({
      name: 'admin_mfa',
      status: 'warn',
      message: 'A second factor is not required for admin console sign-in',
      details: 'No second factor: sample-admin',
    });
  });

  it('names the admins still to enrol when it is required', async () => {
    process.env['ADMIN_MFA_REQUIRED'] = 'true';
    const findUnique = jest.fn();
    const svc = await build({
      adminSecurityPolicy: { findUnique },
      user: { findMany: jest.fn().mockResolvedValue([{ username: 'a' }]) },
    });
    await expect(svc.checkAdminMfa()).resolves.toMatchObject({
      status: 'warn',
      message: '1 admin(s) must still enrol a second factor',
      details: 'a',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('passes when it is required and every admin has a factor', async () => {
    const svc = await build({
      adminSecurityPolicy: {
        findUnique: jest.fn().mockResolvedValue({ mfaRequired: true }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(svc.checkAdminMfa()).resolves.toMatchObject({
      status: 'pass',
    });
  });

  it('counts the users with pre-0.11.0 recovery codes', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);
    const svc = await build({ recoveryCode: { findMany } });
    await expect(svc.checkRecoveryCodes()).resolves.toMatchObject({
      name: 'recovery_codes',
      status: 'warn',
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      used: false,
      NOT: { codeHash: { startsWith: 'rc2$' } },
    });
  });
});
