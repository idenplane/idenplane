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
