import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

/**
 * Identity provider rows stored before 0.12.0 may carry a supported type in
 * another case (`OIDC`), which the 0.13.0 migration lower-cases, or a type
 * the broker does not sign in with (`SAML`, anything else), which
 * GET /admin/upgrade/health reports for review.
 */
describe('Identity provider types from before 0.12.0 (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-idp-types';
  const MIGRATION = join(
    process.cwd(),
    'prisma/migrations/20261117130000_identity_provider_type_case/migration.sql',
  );

  const store = (alias: string, providerType: string, enabled = true) =>
    ctx.prisma.identityProvider.create({
      data: {
        realmId: seeded.realm.id,
        alias,
        providerType,
        enabled,
        clientId: 'client',
        clientSecret: 'secret',
        authorizationUrl: 'https://idp.example.com/authorize',
        tokenUrl: 'https://idp.example.com/token',
      },
    });

  const typeOf = async (alias: string) =>
    (
      await ctx.prisma.identityProvider.findUniqueOrThrow({
        where: { realmId_alias: { realmId: seeded.realm.id, alias } },
      })
    ).providerType;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    seeded = await ctx.seedTestRealm(REALM);
    await store('upper-oidc', 'OIDC');
    await store('mixed-oauth2', ' OAuth2 ');
    await store('canonical', 'oidc');
    await store('corp-saml', 'SAML');
    await store('old-adfs', 'adfs', false);
    await store('directory', 'ldap');
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM } })
      .catch(() => undefined);
    await ctx.cleanup();
  });

  it('the migration lower-cases supported types and leaves the rest alone', async () => {
    // Re-run the migration's statement over rows written the old way.
    const sql = readFileSync(MIGRATION, 'utf-8')
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
      .trim();
    await ctx.prisma.$executeRawUnsafe(sql);

    expect(await typeOf('upper-oidc')).toBe('oidc');
    expect(await typeOf('mixed-oauth2')).toBe('oauth2');
    expect(await typeOf('canonical')).toBe('oidc');
    expect(await typeOf('corp-saml')).toBe('SAML');
    expect(await typeOf('old-adfs')).toBe('adfs');
    expect(await typeOf('directory')).toBe('ldap');
  });

  it('the upgrade health check reports SAML rows for review and other types as unsupported', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/upgrade/health')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(200);
    const check = (
      res.body.checks as Array<{
        name: string;
        status: string;
        message: string;
        details?: string;
      }>
    ).find((c) => c.name === 'identity_provider_types');

    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('need configuration review');
    // Other suites' realms may be listed too; look at this realm's rows.
    const [review, unsupported] = (check?.details ?? '').split('; ');
    expect(review).toMatch(/^Needs configuration review: /);
    expect(review).toContain(`${REALM}/corp-saml (SAML, enabled)`);
    expect(review).toContain(`${REALM}/old-adfs (adfs, disabled)`);
    expect(review).not.toContain(`${REALM}/directory`);
    expect(unsupported).toMatch(/^Unsupported type: /);
    expect(unsupported).toContain(`${REALM}/directory (ldap, enabled)`);
    expect(check?.details).not.toContain(`${REALM}/upper-oidc`);
    expect(check?.details).not.toContain(`${REALM}/canonical`);
  });
});
