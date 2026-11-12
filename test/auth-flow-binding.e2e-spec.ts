import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * Auth-flow binding model (admin API only — login does not read bindings yet).
 */
describe('Auth-flow bindings (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM = 'e2e-flow-binding';
  const OTHER_REALM = 'e2e-flow-binding-other';
  const base = `/admin/realms/${REALM}/auth-flows`;

  let clientPk: string;
  let otherClientPk: string;
  let otherFlowId: string;

  const api = () => request(app.getHttpServer());
  const key = (r: request.Test) => r.set('x-admin-api-key', TEST_ADMIN_API_KEY);

  const VALID_STEPS = [
    { id: 'pw', type: 'password', required: true, order: 1 },
    { id: 'otp', type: 'totp', required: true, order: 2 },
  ];

  async function cleanup() {
    for (const name of [REALM, OTHER_REALM]) {
      await ctx.prisma.realm.delete({ where: { name } }).catch(() => {});
    }
  }

  async function createFlow(name: string, steps: unknown = VALID_STEPS) {
    const res = await key(api().post(base).send({ name, steps })).expect(201);
    return res.body as { id: string; version: number };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanup();

    const realm = await ctx.prisma.realm.create({
      data: { name: REALM, adminEventsEnabled: true },
    });
    const other = await ctx.prisma.realm.create({
      data: { name: OTHER_REALM },
    });
    clientPk = (
      await ctx.prisma.client.create({
        data: {
          realmId: realm.id,
          clientId: 'web',
          redirectUris: [],
          webOrigins: [],
        },
      })
    ).id;
    otherClientPk = (
      await ctx.prisma.client.create({
        data: {
          realmId: other.id,
          clientId: 'foreign',
          redirectUris: [],
          webOrigins: [],
        },
      })
    ).id;
    otherFlowId = (
      await ctx.prisma.authenticationFlow.create({
        data: { realmId: other.id, name: 'Foreign', steps: VALID_STEPS },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await ctx.cleanup();
  });

  // ── create / update validation ─────────────────────────

  describe('validation on save', () => {
    it('rejects an invalid flow on create with {path, code, message} errors', async () => {
      const res = await key(
        api()
          .post(base)
          .send({
            name: 'Bad create',
            steps: [
              { id: 'otp', type: 'totp', required: true, order: 1 },
              { id: 'c', type: 'consent', required: true, order: 2 },
            ],
          }),
      ).expect(400);
      expect(res.body.message).toBe('Authentication flow is invalid');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'steps[0].type',
            code: 'first_step_not_identifying',
          }),
          expect.objectContaining({
            path: 'steps[1].type',
            code: 'unsupported_type',
          }),
        ]),
      );
      const stored = await ctx.prisma.authenticationFlow.findFirst({
        where: { name: 'Bad create' },
      });
      expect(stored).toBeNull();
    });

    it('rejects an invalid flow on update and keeps the stored flow and version', async () => {
      const flow = await createFlow('Update target');
      expect(flow.version).toBe(1);
      const res = await key(
        api()
          .put(`${base}/${flow.id}`)
          .send({
            steps: [
              {
                id: 'pw',
                type: 'password',
                required: true,
                order: 1,
                fallbackStepId: 'otp',
              },
              { id: 'otp', type: 'totp', required: true, order: 2 },
            ],
          }),
      ).expect(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'fallback_not_identifying' }),
      ]);
      const stored = await ctx.prisma.authenticationFlow.findUniqueOrThrow({
        where: { id: flow.id },
      });
      expect(stored.version).toBe(1);
      expect(stored.steps).toEqual(VALID_STEPS);
    });

    it('increments the version on every successful update', async () => {
      const flow = await createFlow('Versioned');
      const a = await key(
        api().put(`${base}/${flow.id}`).send({ description: 'one' }),
      ).expect(200);
      const b = await key(
        api().put(`${base}/${flow.id}`).send({ steps: VALID_STEPS }),
      ).expect(200);
      expect([a.body.version, b.body.version]).toEqual([2, 3]);
    });
  });

  // ── validate ───────────────────────────────────────────

  describe('POST :id/validate', () => {
    it('returns {valid:true, errors:[]} for a valid flow', async () => {
      const flow = await createFlow('Validate ok');
      const res = await key(api().post(`${base}/${flow.id}/validate`)).expect(
        200,
      );
      expect(res.body).toEqual({ valid: true, errors: [] });
    });

    it('reports errors for a flow stored before the strict rules', async () => {
      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
      });
      const legacy = await ctx.prisma.authenticationFlow.create({
        data: {
          realmId: realm.id,
          name: 'Legacy stored',
          steps: [{ id: 's', type: 'social', required: true, order: 1 }],
        },
      });
      const res = await key(api().post(`${base}/${legacy.id}/validate`)).expect(
        200,
      );
      expect(res.body.valid).toBe(false);
      expect(res.body.errors[0]).toMatchObject({
        path: 'steps[0].type',
        code: 'unsupported_type',
      });
    });

    it('404s for a flow of another realm', async () => {
      await key(api().post(`${base}/${otherFlowId}/validate`)).expect(404);
    });
  });

  // ── bindings ───────────────────────────────────────────

  describe('GET/PUT bindings', () => {
    it('GET returns the defaults, runtimeEnabled=false and every client', async () => {
      const res = await key(api().get(`${base}/bindings`)).expect(200);
      expect(res.body).toEqual({
        runtimeEnabled: false,
        authFlowsEnabled: false,
        browserFlowId: null,
        clients: [
          { id: clientPk, clientId: 'web', name: null, authFlowId: null },
        ],
      });
    });

    it('PUT binds the realm flow, a client override and enables the realm', async () => {
      const flow = await createFlow('Bound browser');
      const res = await key(
        api()
          .put(`${base}/bindings`)
          .send({
            browserFlowId: flow.id,
            authFlowsEnabled: true,
            clients: [{ clientId: 'web', authFlowId: flow.id }],
          }),
      ).expect(200);
      expect(res.body).toMatchObject({
        runtimeEnabled: false,
        authFlowsEnabled: true,
        browserFlowId: flow.id,
        clients: [{ clientId: 'web', authFlowId: flow.id }],
      });
      const again = await key(api().get(`${base}/bindings`)).expect(200);
      expect(again.body).toEqual(res.body);

      const events = await ctx.prisma.adminEvent.findMany({
        where: { realm: { name: REALM }, resourcePath: `${base}/bindings` },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        operationType: 'UPDATE',
        resourceType: 'AUTH_FLOW',
      });
    });

    it('PUT rejects an invalid flow and writes nothing', async () => {
      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
      });
      const bad = await ctx.prisma.authenticationFlow.create({
        data: {
          realmId: realm.id,
          name: 'Invalid for binding',
          steps: [{ id: 'otp', type: 'totp', required: true, order: 1 }],
        },
      });
      const before = await key(api().get(`${base}/bindings`)).expect(200);
      const res = await key(
        api().put(`${base}/bindings`).send({ browserFlowId: bad.id }),
      ).expect(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({
          path: 'browserFlowId',
          code: 'flow_invalid',
          flowId: bad.id,
        }),
      ]);
      const after = await key(api().get(`${base}/bindings`)).expect(200);
      expect(after.body).toEqual(before.body);
    });

    it('PUT rejects a flow of another realm and an unknown client', async () => {
      const res = await key(
        api()
          .put(`${base}/bindings`)
          .send({
            browserFlowId: otherFlowId,
            clients: [{ clientId: 'foreign', authFlowId: null }],
          }),
      ).expect(400);
      expect(
        res.body.errors.map((e: { code: string }) => e.code).sort(),
      ).toEqual(['client_not_found', 'flow_not_found']);
    });

    it('PUT rejects unknown properties (DTO whitelist)', async () => {
      await key(api().put(`${base}/bindings`).send({ isDefault: true })).expect(
        400,
      );
    });
  });

  // ── assign-client ──────────────────────────────────────

  describe('assign-client', () => {
    let flowId: string;
    beforeAll(async () => {
      flowId = (await createFlow('Assignable')).id;
    });

    it('rejects a client of another realm (404)', async () => {
      await key(
        api().put(`${base}/${flowId}/assign-client/${otherClientPk}`).send({}),
      ).expect(404);
      const foreign = await ctx.prisma.client.findUniqueOrThrow({
        where: { id: otherClientPk },
      });
      expect(foreign.authFlowId).toBeNull();
    });

    it('rejects a flow of another realm (404)', async () => {
      await key(
        api().put(`${base}/${otherFlowId}/assign-client/${clientPk}`).send({}),
      ).expect(404);
    });

    it('rejects a body that names a different flow (400)', async () => {
      const res = await key(
        api()
          .put(`${base}/${flowId}/assign-client/${clientPk}`)
          .send({ authFlowId: otherFlowId }),
      ).expect(400);
      expect(res.body.errors[0].code).toBe('flow_id_mismatch');
    });

    it('rejects an invalid flow (400)', async () => {
      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
      });
      const bad = await ctx.prisma.authenticationFlow.create({
        data: {
          realmId: realm.id,
          name: 'Invalid for assign',
          steps: [{ id: 'pw', type: 'password', required: false, order: 1 }],
        },
      });
      const res = await key(
        api().put(`${base}/${bad.id}/assign-client/${clientPk}`).send({}),
      ).expect(400);
      expect(res.body.errors[0].code).toBe('first_step_not_required');
    });

    it('assigns the path flow, then DELETE clears it', async () => {
      const res = await key(
        api().put(`${base}/${flowId}/assign-client/${clientPk}`).send({}),
      ).expect(200);
      expect(res.body).toEqual({
        id: clientPk,
        clientId: 'web',
        authFlowId: flowId,
      });
      await key(
        api().delete(`${base}/${flowId}/assign-client/${clientPk}`),
      ).expect(200);
      const c = await ctx.prisma.client.findUniqueOrThrow({
        where: { id: clientPk },
      });
      expect(c.authFlowId).toBeNull();
    });
  });

  // ── delete ─────────────────────────────────────────────

  describe('DELETE of a bound flow', () => {
    it('409s with the binding list while bound, 204 once unbound', async () => {
      const flow = await createFlow('Delete me');
      await key(
        api()
          .put(`${base}/bindings`)
          .send({
            browserFlowId: flow.id,
            clients: [{ clientId: 'web', authFlowId: flow.id }],
          }),
      ).expect(200);

      const res = await key(api().delete(`${base}/${flow.id}`)).expect(409);
      expect(res.body.bindings).toEqual([
        expect.objectContaining({ kind: 'realm', realmName: REALM }),
        expect.objectContaining({
          kind: 'client',
          id: clientPk,
          clientId: 'web',
        }),
      ]);

      await key(
        api()
          .put(`${base}/bindings`)
          .send({
            browserFlowId: null,
            clients: [{ clientId: 'web', authFlowId: null }],
          }),
      ).expect(200);
      await key(api().delete(`${base}/${flow.id}`)).expect(204);
    });

    it('deleting a realm with bound flows still cascades (NO ACTION, not RESTRICT)', async () => {
      const name = 'e2e-flow-binding-cascade';
      await ctx.prisma.realm.delete({ where: { name } }).catch(() => {});
      const realm = await ctx.prisma.realm.create({ data: { name } });
      const flow = await ctx.prisma.authenticationFlow.create({
        data: { realmId: realm.id, name: 'F', steps: VALID_STEPS },
      });
      await ctx.prisma.client.create({
        data: {
          realmId: realm.id,
          clientId: 'c',
          redirectUris: [],
          webOrigins: [],
          authFlowId: flow.id,
        },
      });
      await ctx.prisma.realm.update({
        where: { id: realm.id },
        data: { browserFlowId: flow.id },
      });

      await key(api().delete(`/admin/realms/${name}`)).expect((r) => {
        expect(r.status).toBeLessThan(300);
      });
      expect(
        await ctx.prisma.authenticationFlow.count({
          where: { realmId: realm.id },
        }),
      ).toBe(0);
    });
  });
});
