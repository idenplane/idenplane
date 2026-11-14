import request from 'supertest';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import {
  ADMIN_EVENT_PURGE_TASK,
  ADMIN_EVENT_PURGE_VERSION,
  AdminEventPurgeService,
} from '../src/secrets-at-rest/admin-event-purge.service';
import { REDACTED } from '../src/events/admin-event-redaction';
import { SECRET_PLACEHOLDER } from '../src/realms/secret-placeholder';

type Row = Record<string, any>;

/**
 * Admin events written before their redaction covered a secret keep it in
 * plaintext. The one-off purge (AdminEventPurgeService) masks those secrets
 * in place, leaves everything else as it was, and later runs do nothing.
 */
describe('Purge of secrets recorded by older admin events (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  const REALM = 'e2e-admin-event-purge';
  const purge = () => new AdminEventPurgeService(ctx.prisma).run();

  /** Representations as older versions recorded them, and as they must end. */
  const LEGACY: Array<{ before: Row; after: Row }> = [
    {
      before: {
        name: 'corp-ldap',
        connectionUrl: 'ldap://ldap.example.test',
        bindDn: 'cn=admin',
        bindCredential: 'ldap-bind-password',
      },
      after: {
        name: 'corp-ldap',
        connectionUrl: 'ldap://ldap.example.test',
        bindDn: 'cn=admin',
        bindCredential: REDACTED,
      },
    },
    {
      before: {
        name: 'siem',
        url: 'https://logs.example.test',
        httpHeaders: { Authorization: 'Bearer siem-token' },
      },
      after: {
        name: 'siem',
        url: 'https://logs.example.test',
        httpHeaders: REDACTED,
      },
    },
    {
      before: {
        type: 'oidc',
        name: 'Acme',
        config: { issuer: 'https://acme.test', clientSecret: 'sso-secret' },
      },
      after: {
        type: 'oidc',
        name: 'Acme',
        config: {
          issuer: 'https://acme.test',
          clientSecret: SECRET_PLACEHOLDER,
        },
      },
    },
    {
      before: {
        displayName: 'Realm',
        hcaptchaSecretKey: 'hcaptcha-secret',
        emailProviderConfig: { resend: { apiKey: 're_secret' } },
        smsProviderConfig: { twilioAuthToken: 'twilio-secret' },
      },
      after: {
        displayName: 'Realm',
        hcaptchaSecretKey: REDACTED,
        emailProviderConfig: REDACTED,
        smsProviderConfig: REDACTED,
      },
    },
    {
      before: {
        url: 'https://hooks.example.test',
        secret: 'dummy-webhook-signing-secret',
        eventTypes: ['user.login'],
      },
      after: {
        url: 'https://hooks.example.test',
        secret: REDACTED,
        eventTypes: ['user.login'],
      },
    },
    {
      before: { scimUser: { userName: 'ann', password: 'scim-password' } },
      after: { scimUser: { userName: 'ann', password: REDACTED } },
    },
    {
      before: {
        operations: [{ op: 'replace', path: 'password', value: 'patched' }],
      },
      after: {
        operations: [{ op: 'replace', path: 'password', value: REDACTED }],
      },
    },
  ];
  const CLEAN: Row = { name: 'no secrets here', enabled: true };
  const PLAINTEXT =
    /ldap-bind-password|siem-token|sso-secret|hcaptcha-secret|re_secret|twilio-secret|dummy-webhook-signing-secret|scim-password|patched/;

  let legacyIds: string[] = [];
  let cleanId: string;
  let nullId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    // Whatever the app's own start-up run is doing finishes first.
    await purge();

    const base = {
      realmId: seeded.realm.id,
      adminUserId: 'api-key',
      operationType: 'CREATE',
      resourceType: 'REALM',
      ipAddress: '10.0.0.1',
    };
    legacyIds = [];
    for (const [i, { before }] of LEGACY.entries()) {
      const row = await ctx.prisma.adminEvent.create({
        data: {
          ...base,
          resourcePath: `/admin/realms/${REALM}/legacy/${i}`,
          representation: before,
        },
      });
      legacyIds.push(row.id);
    }
    cleanId = (
      await ctx.prisma.adminEvent.create({
        data: { ...base, resourcePath: '/clean', representation: CLEAN },
      })
    ).id;
    nullId = (
      await ctx.prisma.adminEvent.create({
        data: { ...base, operationType: 'DELETE', resourcePath: '/deleted' },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  const rows = () =>
    ctx.prisma.adminEvent.findMany({
      where: { realmId: seeded.realm.id },
      orderBy: { id: 'asc' },
    });

  it('masks every recorded secret and leaves the rest of each row intact', async () => {
    const before = await rows();
    expect(JSON.stringify(before)).toMatch(PLAINTEXT);

    // As on the first start of this version.
    await ctx.prisma.maintenanceTask.deleteMany({
      where: { id: ADMIN_EVENT_PURGE_TASK },
    });
    const result = await purge();
    expect(result.redacted).toBeGreaterThanOrEqual(LEGACY.length);

    const after = await rows();
    expect(JSON.stringify(after)).not.toMatch(PLAINTEXT);
    for (const [i, id] of legacyIds.entries()) {
      const was = before.find((r) => r.id === id)!;
      const now = after.find((r) => r.id === id)!;
      expect(now.representation).toEqual(LEGACY[i].after);
      expect({ ...now, representation: null }).toEqual({
        ...was,
        representation: null,
      });
    }
    expect(after.find((r) => r.id === cleanId)).toEqual(
      before.find((r) => r.id === cleanId),
    );
    expect(after.find((r) => r.id === nullId)).toEqual(
      before.find((r) => r.id === nullId),
    );

    const task = await ctx.prisma.maintenanceTask.findUniqueOrThrow({
      where: { id: ADMIN_EVENT_PURGE_TASK },
    });
    expect(task).toMatchObject({
      completedVersion: ADMIN_EVENT_PURGE_VERSION,
      cursor: null,
    });
  });

  it('a second run reads nothing; a forced rescan writes nothing', async () => {
    const before = await rows();
    expect(await purge()).toEqual({
      scanned: 0,
      redacted: 0,
      alreadyDone: true,
    });
    await ctx.prisma.maintenanceTask.deleteMany({
      where: { id: ADMIN_EVENT_PURGE_TASK },
    });
    const rescan = await purge();
    expect(rescan.redacted).toBe(0);
    expect(rescan.scanned).toBeGreaterThanOrEqual(LEGACY.length + 1);
    expect(await rows()).toEqual(before);
  });

  it('concurrent runs share the walk', async () => {
    await ctx.prisma.adminEvent.update({
      where: { id: legacyIds[0] },
      data: { representation: LEGACY[0].before },
    });
    await ctx.prisma.maintenanceTask.deleteMany({
      where: { id: ADMIN_EVENT_PURGE_TASK },
    });
    const results = await Promise.all([purge(), purge(), purge()]);
    expect(results.reduce((n, r) => n + r.redacted, 0)).toBe(1);
    const row = await ctx.prisma.adminEvent.findUniqueOrThrow({
      where: { id: legacyIds[0] },
    });
    expect(row.representation).toEqual(LEGACY[0].after);
  });

  it('new admin events record neither a webhook secret nor a bind credential', async () => {
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adminEventsEnabled: true },
    });
    await request(ctx.app.getHttpServer())
      .post(`/admin/realms/${REALM}/webhooks`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        url: 'https://hooks.example.com/new',
        secret: 'dummy-new-signing-secret',
        eventTypes: ['user.login'],
      })
      .expect(201);
    // The event is recorded after the response.
    let events: Row[] = [];
    for (let i = 0; i < 50 && events.length === 0; i++) {
      events = await ctx.prisma.adminEvent.findMany({
        where: { realmId: seeded.realm.id, resourceType: 'WEBHOOK' },
      });
      if (events.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(events).toHaveLength(1);
    expect(events[0].representation).toMatchObject({ secret: REDACTED });
    expect(JSON.stringify(events)).not.toContain('dummy-new-signing-secret');
  });
});
