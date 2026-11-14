import request from 'supertest';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * The registration controller is mounted at /realms/:realm/registration,
 * not under /admin. Its admin actions use @UseGuards(AdminApiKeyGuard),
 * which used to do nothing off /admin. They must refuse anonymous callers
 * while the public registration routes stay open.
 */
describe('Registration admin routes require admin auth (e2e)', () => {
  let ctx: TestContext;
  let realmId: string;
  const REALM = 'e2e-reg-admin-auth';
  const base = `/realms/${REALM}/registration`;
  const apiKey = { 'x-admin-api-key': TEST_ADMIN_API_KEY };

  const http = () => request(ctx.app.getHttpServer());

  const pendingUser = async (username: string) =>
    ctx.prisma.user.create({
      data: { realmId, username, enabled: false, emailVerified: true },
    });

  const field = async (name: string) =>
    ctx.prisma.registrationField.create({
      data: { realmId, name, displayName: name },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await ctx.seedTestRealm(REALM);
    realmId = seeded.realm.id;
  }, 60_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  describe('without credentials', () => {
    it('GET pending answers 401', async () => {
      await pendingUser('anon-pending-list');
      await http().get(`${base}/pending`).expect(401);
    });

    it('POST approve answers 401 and leaves the user disabled', async () => {
      const user = await pendingUser('anon-approve');
      await http().post(`${base}/approve/${user.id}`).send({}).expect(401);
      const after = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.enabled).toBe(false);
    });

    it('POST reject answers 401 and keeps the user', async () => {
      const user = await pendingUser('anon-reject');
      await http().post(`${base}/reject/${user.id}`).send({}).expect(401);
      expect(
        await ctx.prisma.user.findUnique({ where: { id: user.id } }),
      ).not.toBeNull();
    });

    it('GET admin/fields answers 401', async () => {
      await http().get(`${base}/admin/fields`).expect(401);
    });

    it('POST admin/fields answers 401 and creates nothing', async () => {
      await http()
        .post(`${base}/admin/fields`)
        .send({ name: 'anon_field', displayName: 'Anon' })
        .expect(401);
      expect(
        await ctx.prisma.registrationField.count({
          where: { realmId, name: 'anon_field' },
        }),
      ).toBe(0);
    });

    it('PUT admin/fields/:id answers 401 and changes nothing', async () => {
      const f = await field('anon_update');
      await http()
        .put(`${base}/admin/fields/${f.id}`)
        .send({ displayName: 'Changed' })
        .expect(401);
      const after = await ctx.prisma.registrationField.findUniqueOrThrow({
        where: { id: f.id },
      });
      expect(after.displayName).toBe('anon_update');
    });

    it('DELETE admin/fields/:id answers 401 and keeps the field', async () => {
      const f = await field('anon_delete');
      await http().delete(`${base}/admin/fields/${f.id}`).expect(401);
      expect(
        await ctx.prisma.registrationField.findUnique({ where: { id: f.id } }),
      ).not.toBeNull();
    });

    it('answers 401 with a wrong API key', async () => {
      await http()
        .get(`${base}/pending`)
        .set('x-admin-api-key', 'not-the-key')
        .expect(401);
    });

    it('answers 401 through a differently cased path', async () => {
      await http().get(`/REALMS/${REALM}/REGISTRATION/pending`).expect(401);
    });
  });

  describe('with the admin API key', () => {
    it('lists pending registrations', async () => {
      const user = await pendingUser('key-pending-list');
      const res = await http().get(`${base}/pending`).set(apiKey).expect(200);
      expect(JSON.stringify(res.body)).toContain(user.id);
    });

    it('approves a registration', async () => {
      const user = await pendingUser('key-approve');
      await http()
        .post(`${base}/approve/${user.id}`)
        .set(apiKey)
        .send({})
        .expect(200);
      const after = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.enabled).toBe(true);
    });

    it('rejects a registration', async () => {
      const user = await pendingUser('key-reject');
      await http()
        .post(`${base}/reject/${user.id}`)
        .set(apiKey)
        .send({})
        .expect(200);
      expect(
        await ctx.prisma.user.findUnique({ where: { id: user.id } }),
      ).toBeNull();
    });

    it('manages registration fields', async () => {
      const created = await http()
        .post(`${base}/admin/fields`)
        .set(apiKey)
        .send({ name: 'company_name', displayName: 'Company' })
        .expect(201);
      const id = created.body.id as string;

      const list = await http()
        .get(`${base}/admin/fields`)
        .set(apiKey)
        .expect(200);
      expect(JSON.stringify(list.body)).toContain('company_name');

      await http()
        .put(`${base}/admin/fields/${id}`)
        .set(apiKey)
        .send({ displayName: 'Company name' })
        .expect(200);
      await http()
        .delete(`${base}/admin/fields/${id}`)
        .set(apiKey)
        .expect(204);
    });
  });

  describe('public routes stay public', () => {
    it('serves the registration form fields anonymously', async () => {
      await http().get(`${base}/fields`).expect(200);
    });

    it('does not answer 401 to an anonymous registration attempt', async () => {
      const res = await http()
        .post(`${base}/register`)
        .send({ username: 'x', password: 'short', email: 'not-an-email' });
      expect(res.status).not.toBe(401);
    });
  });
});
