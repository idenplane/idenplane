import { readFileSync } from 'fs';
import { join } from 'path';
import * as argon2 from 'argon2';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';

/**
 * Client secrets against a real database: how a new one is stored, how one
 * stored by an older version is moved to the fast format on first use, and
 * how the migration repairs plaintext rows the wizard and importers wrote.
 */
describe('Client secrets (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  const crypto = new CryptoService();

  const REALM = 'e2e-client-secrets';
  const TOKEN_URL = `/realms/${REALM}/protocol/openid-connect/token`;
  const INTROSPECT_URL = `${TOKEN_URL}/introspect`;

  const clientCredentials = (clientId: string, secret: string) =>
    request(app.getHttpServer()).post(TOKEN_URL).type('form').send({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
    });

  const stored = async (clientId: string) =>
    (
      await ctx.prisma.client.findFirstOrThrow({
        where: { clientId, realm: { name: REALM } },
      })
    ).clientSecret;

  const setStored = (clientId: string, clientSecret: string) =>
    ctx.prisma.client.updateMany({
      where: { clientId, realm: { name: REALM } },
      data: { clientSecret },
    });

  /** A confidential client made through the admin API; returns its secret. */
  const createClient = async (clientId: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`/admin/realms/${REALM}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        clientId,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
      })
      .expect(201);
    return (res.body as { clientSecret: string }).clientSecret;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    await ctx.seedTestRealm(REALM);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('stores a new secret as a fast hash and authenticates with it', async () => {
    const secret = await createClient('fast-app');
    expect(await stored('fast-app')).toBe(`sha256$${crypto.sha256(secret)}`);

    await clientCredentials('fast-app', secret).expect(200);
    const wrong = await clientCredentials('fast-app', crypto.generateSecret());
    expect(wrong.status).toBe(401);
    expect((wrong.body as { error: string }).error).toBe('invalid_client');
  });

  it('authenticates introspection with the same secret', async () => {
    const secret = await createClient('introspecting-app');
    const token = (
      (await clientCredentials('introspecting-app', secret).expect(200))
        .body as { access_token: string }
    ).access_token;

    const res = await request(app.getHttpServer())
      .post(INTROSPECT_URL)
      .type('form')
      .send({
        token,
        client_id: 'introspecting-app',
        client_secret: secret,
      })
      .expect(200);
    expect((res.body as { active: boolean }).active).toBe(true);

    await request(app.getHttpServer())
      .post(INTROSPECT_URL)
      .type('form')
      .send({ token, client_id: 'introspecting-app', client_secret: 'nope' })
      .expect(401);
  });

  it('moves a secret stored as Argon2 by an older version to the fast hash on first use', async () => {
    const secret = await createClient('legacy-app');
    const legacy = await argon2.hash(secret, { type: argon2.argon2id });
    await setStored('legacy-app', legacy);

    // A wrong secret leaves the row alone.
    await clientCredentials('legacy-app', crypto.generateSecret()).expect(401);
    expect(await stored('legacy-app')).toBe(legacy);

    await clientCredentials('legacy-app', secret).expect(200);
    expect(await stored('legacy-app')).toBe(`sha256$${crypto.sha256(secret)}`);
    await clientCredentials('legacy-app', secret).expect(200);
  });

  it('answers 401, not 500, for a plaintext secret left in the column', async () => {
    const secret = await createClient('plaintext-app');
    await setStored('plaintext-app', secret);
    const res = await clientCredentials('plaintext-app', secret);
    expect(res.status).toBe(401);
  });

  it('the migration hashes plaintext rows so those clients authenticate', async () => {
    // What the setup wizard wrote before this fix, and what the Authentik
    // and Zitadel importers wrote for a secret chosen in those systems.
    const generated = await createClient('wizard-app');
    await setStored('wizard-app', generated);
    await createClient('imported-app');
    await setStored('imported-app', 'chosen-in-authentik');
    const untouched = await createClient('current-app');
    const currentHash = await stored('current-app');

    const sql = readFileSync(
      join(
        __dirname,
        '../prisma/migrations/20261108100000_hash_plaintext_client_secrets/migration.sql',
      ),
      'utf8',
    );
    // Comments first: they contain semicolons of their own.
    for (const statement of sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await ctx.prisma.$executeRawUnsafe(statement);
    }

    expect(await stored('wizard-app')).toBe(
      `sha256$${crypto.sha256(generated)}`,
    );
    expect(await stored('current-app')).toBe(currentHash);
    await clientCredentials('wizard-app', generated).expect(200);
    await clientCredentials('current-app', untouched).expect(200);

    // A chosen secret is fast-hashed by SQL, then moved to Argon2 on first use.
    await clientCredentials('imported-app', 'chosen-in-authentik').expect(200);
    expect((await stored('imported-app'))?.startsWith('$argon2id$')).toBe(true);
    await clientCredentials('imported-app', 'chosen-in-authentik').expect(200);
  });

  it('the seeded client with an Argon2 hash of a chosen secret keeps working', async () => {
    await clientCredentials('test-client', 'test-client-secret').expect(200);
    expect((await stored('test-client'))?.startsWith('$argon2')).toBe(true);
  });
});
