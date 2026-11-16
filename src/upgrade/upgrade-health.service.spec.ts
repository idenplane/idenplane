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
