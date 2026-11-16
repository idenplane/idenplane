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
 * Authorization policies fail closed (0.11.0): a condition the engine cannot
 * evaluate is refused when a policy is saved, and a stored one (saved by an
 * older version) makes a DENY deny. Client-scoped policies apply to their
 * own client only.
 */
describe('Authorization policies (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  const REALM = 'e2e-authz-fail-closed';
  const base = `/admin/realms/${REALM}/policies`;

  const api = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set('x-admin-api-key', TEST_ADMIN_API_KEY);

  const evaluate = (body: Record<string, unknown> = {}) =>
    withKey(api().post(`${base}/evaluate`)).send({
      subject: { userId: 'u1', roles: ['contractor'] },
      resource: { type: 'report' },
      action: 'read',
      environment: { ip: '::ffff:10.1.2.3' },
      ...body,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    seeded = await ctx.seedTestRealm(REALM);
    await withKey(api().post(base))
      .send({ name: 'allow-all', effect: 'ALLOW' })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('refuses an unknown operator with a 400 that names the condition', async () => {
    const res = await withKey(api().post(base)).send({
      name: 'typo',
      effect: 'DENY',
      subjectConditions: [
        { field: 'subject.roles', operator: 'contain', value: 'contractor' },
      ],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(
      'subjectConditions[0]: unknown operator \\"contain\\"',
    );
  });

  it('refuses an invalid CIDR on update too', async () => {
    const created = await withKey(api().post(base))
      .send({ name: 'office', effect: 'ALLOW', enabled: false })
      .expect(201);
    await withKey(api().put(`${base}/${created.body.id}`))
      .send({
        environmentConditions: [
          {
            field: 'environment.ip',
            operator: 'ipInRange',
            value: '10.0.0.0/33',
          },
        ],
      })
      .expect(400);
  });

  it('an IPv4 DENY range matches the IPv4-mapped address a dual-stack socket reports', async () => {
    const created = await withKey(api().post(base))
      .send({
        name: 'block-internal',
        effect: 'DENY',
        environmentConditions: [
          {
            field: 'environment.ip',
            operator: 'ipInRange',
            value: '10.0.0.0/8',
          },
        ],
      })
      .expect(201);
    const res = await evaluate().expect(201);
    expect(res.body.decision).toBe('DENY');
    expect(res.body.reason).toContain('block-internal');
    const v6 = await evaluate({ environment: { ip: '2001:db8::1' } }).expect(
      201,
    );
    expect(v6.body.decision).toBe('ALLOW');
    await withKey(api().delete(`${base}/${created.body.id}`));
  });

  it('a stored DENY with an unknown operator denies (fail closed)', async () => {
    // As an older version would have stored it.
    const stored = await ctx.prisma.policy.create({
      data: {
        realmId: seeded.realm.id,
        name: 'legacy-typo',
        effect: 'DENY',
        logic: 'AND',
        subjectConditions: [
          { field: 'subject.roles', operator: 'contain', value: 'nobody' },
        ],
      },
    });
    // The policy list is cached; a write through the API invalidates it.
    await withKey(api().post(base)).send({ name: 'cache-bust' }).expect(201);

    const res = await evaluate().expect(201);
    expect(res.body.decision).toBe('DENY');
    expect(res.body.reason).toMatch(/legacy-typo.*fails closed/);

    const health = await withKey(api().get('/admin/upgrade/health')).expect(
      200,
    );
    const check = (
      health.body.checks as Array<{
        name: string;
        status: string;
        details?: string;
      }>
    ).find((c) => c.name === 'invalid_authorization_policies');
    expect(check?.status).toBe('warn');
    expect(check?.details).toContain(`${REALM}/legacy-typo (DENY)`);

    await ctx.prisma.policy.delete({ where: { id: stored.id } });
  });

  it('a client-scoped policy applies to its client only', async () => {
    await withKey(api().post(base))
      .send({ name: 'deny-app-a', effect: 'DENY', clientId: 'app-a' })
      .expect(201);
    expect(
      (await evaluate({ clientId: 'app-a' }).expect(201)).body.decision,
    ).toBe('DENY');
    expect(
      (await evaluate({ clientId: 'app-b' }).expect(201)).body.decision,
    ).toBe('ALLOW');
    // Without clientId only the global policies apply.
    expect((await evaluate().expect(201)).body.decision).toBe('ALLOW');
  });
});
