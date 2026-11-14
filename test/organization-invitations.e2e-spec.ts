import request from 'supertest';
import { randomBytes } from 'crypto';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { CryptoService } from '../src/crypto/crypto.service';

/**
 * Organization invitations: only a SHA-256 of the token is stored, the raw
 * token is returned once by the create call, and accepting hashes the
 * presented token. Covers create → accept, a wrong token, a token used or
 * expired, a row as the previous schema stored it, and the SQL backfill
 * expression the migration uses for the oldest rows.
 */
describe('Organization invitations (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  const crypto = new CryptoService();
  const REALM = 'e2e-org-invitations';
  const ORG = 'invite-org';
  const base = `/admin/realms/${REALM}/organizations/${ORG}`;
  const api = () => request(ctx.app.getHttpServer());
  const admin = <T extends request.Test>(req: T) =>
    req.set('x-admin-api-key', TEST_ADMIN_API_KEY);

  const invite = async (email: string) => {
    const res = await admin(api().post(`${base}/invitations`))
      .send({ email, role: 'admin' })
      .expect(201);
    return res.body as { token: string; expiresAt: string };
  };
  const accept = (token: string) =>
    admin(api().post(`${base}/invitations/${token}/accept`)).send({});

  const verifiedUser = async (username: string) =>
    ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username,
        email: `${username}@example.test`,
        emailVerified: true,
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adminEventsEnabled: true },
    });
    await admin(api().post(`/admin/realms/${REALM}/organizations`))
      .send({ name: 'Invite Org', slug: ORG })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('stores only the hash; the raw token is returned once and accepted', async () => {
    const user = await verifiedUser('alice');
    const created = await invite('Alice@Example.test');
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    const row = await ctx.prisma.organizationInvitation.findFirstOrThrow({
      where: { email: 'alice@example.test' },
    });
    expect(row.tokenHash).toBe(crypto.sha256(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    // No admin listing returns the token or its hash.
    const list = await admin(api().get(`${base}/invitations`)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('token');
    expect(list.body[0]).not.toHaveProperty('tokenHash');
    expect(list.body[0]).toMatchObject({
      email: 'alice@example.test',
      role: 'admin',
      acceptedAt: null,
    });
    expect(JSON.stringify(list.body)).not.toContain(row.tokenHash);

    const accepted = await accept(created.token).expect(201);
    expect(accepted.body).toMatchObject({ userId: user.id, role: 'admin' });

    // The admin event of the accept call does not keep the token either
    // (it is recorded after the response).
    let events: Array<{ resourcePath: string }> = [];
    for (let i = 0; i < 50; i++) {
      events = await ctx.prisma.adminEvent.findMany({
        where: { realmId: seeded.realm.id },
      });
      if (events.some((e) => e.resourcePath.endsWith('/accept'))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(events.map((e) => e.resourcePath)).toContain(
      `${base}/invitations/[REDACTED]/accept`,
    );
    expect(JSON.stringify(events)).not.toContain(created.token);
  });

  it('refuses a wrong token, and the hash itself', async () => {
    await verifiedUser('bob');
    const created = await invite('bob@example.test');
    await accept(randomBytes(32).toString('hex')).expect(404);
    await accept(crypto.sha256(created.token)).expect(404);
    await accept('short').expect(404);
    await accept(created.token).expect(201);
  });

  it('a token works once', async () => {
    await verifiedUser('carol');
    const created = await invite('carol@example.test');
    await accept(created.token).expect(201);
    await accept(created.token).expect(410);
  });

  it('two concurrent accepts: one succeeds', async () => {
    await verifiedUser('erin');
    const created = await invite('erin@example.test');
    const results = await Promise.all([
      accept(created.token),
      accept(created.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
  });

  it('an expired token is refused', async () => {
    await verifiedUser('dave');
    const created = await invite('dave@example.test');
    await ctx.prisma.organizationInvitation.updateMany({
      where: { tokenHash: crypto.sha256(created.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await accept(created.token).expect(410);
  });

  it('an invitation stored before this version is still accepted', async () => {
    // Since 0.2.0 the column held sha256(token) already; the migration only
    // renamed it. Such a row, written straight to the table:
    await verifiedUser('frank');
    const raw = randomBytes(32).toString('hex');
    const org = await ctx.prisma.organization.findFirstOrThrow({
      where: { realmId: seeded.realm.id, slug: ORG },
    });
    await ctx.prisma.$executeRaw`
      INSERT INTO "organization_invitations"
        ("id", "organization_id", "email", "role", "token_hash", "expires_at")
      VALUES (gen_random_uuid()::text, ${org.id}, 'frank@example.test', 'member',
              ${crypto.sha256(raw)}, now() + interval '1 day')`;
    await accept(raw).expect(201);
  });

  it("the migration's SQL hash matches the application's", async () => {
    const raw = randomBytes(32).toString('hex');
    const [row] = await ctx.prisma.$queryRaw<Array<{ hash: string }>>`
      SELECT encode(sha256(convert_to(${raw}, 'UTF8')), 'hex') AS hash`;
    expect(row.hash).toBe(crypto.sha256(raw));
  });
});
