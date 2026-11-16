import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  NEW_REALM_SECURITY_DEFAULTS,
  REALM_BRUTE_FORCE_DEFAULTS,
} from './realm-security-defaults.js';

const root = join(__dirname, '..', '..');
const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');

/** The `@default(...)` of one field of `model Realm`, as written. */
function realmColumnDefault(field: string): string | undefined {
  const start = schema.indexOf('model Realm {');
  const end = schema.indexOf('\n}', start);
  const body = schema.slice(start, end);
  for (const line of body.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== field) continue;
    const attr = parts.find((p) => p.startsWith('@default('));
    return attr?.slice('@default('.length, -1);
  }
  return undefined;
}

describe('new realm security defaults', () => {
  it('turns brute-force protection on, with a temporary lockout only', () => {
    expect(REALM_BRUTE_FORCE_DEFAULTS.bruteForceEnabled).toBe(true);
    // Permanent lockout disables the account: never a default.
    expect(REALM_BRUTE_FORCE_DEFAULTS.permanentLockoutAfter).toBe(0);
    expect(REALM_BRUTE_FORCE_DEFAULTS.maxLoginFailures).toBeGreaterThanOrEqual(
      5,
    );
    expect(REALM_BRUTE_FORCE_DEFAULTS.maxLoginFailures).toBeLessThanOrEqual(
      100,
    ); // NIST SP 800-63B 5.2.2
    // A short lock that ends by itself limits a lockout denial of service.
    expect(REALM_BRUTE_FORCE_DEFAULTS.lockoutDuration).toBeLessThanOrEqual(900);
    // The failure window outlives the lock, so a wrong guess right after the
    // lock ends relocks at once (progressive lockout).
    expect(REALM_BRUTE_FORCE_DEFAULTS.failureResetTime).toBeGreaterThan(
      REALM_BRUTE_FORCE_DEFAULTS.lockoutDuration,
    );
  });

  it.each(Object.entries(NEW_REALM_SECURITY_DEFAULTS))(
    'schema.prisma column default of %s matches (%s)',
    (field, value) => {
      expect(realmColumnDefault(field)).toBe(String(value));
    },
  );

  it('the migration that changed the defaults updates no existing realm', () => {
    const dir = join(root, 'prisma', 'migrations');
    const migration = readdirSync(dir).find((d) =>
      d.endsWith('_secure_realm_defaults'),
    );
    expect(migration).toBeDefined();
    const sql = readFileSync(join(dir, migration!, 'migration.sql'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^ALTER TABLE "realms" ALTER COLUMN "\w+" SET DEFAULT \w+$/,
      );
    }
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });
});
