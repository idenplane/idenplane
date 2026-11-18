import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { AdminAuthService } from '../src/admin-auth/admin-auth.service.js';
import { ACR_MFA } from '../src/authn-core/acr.js';

/**
 * An admin's full MFA reset is account recovery: it must not leave a
 * passkey registered by whoever took the account over, since a passkey
 * signs in on its own. Passkeys are removed unless the admin keeps them.
 */
describe('Admin MFA reset and passkeys (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let adminToken: string;
  let mfaAdminId: string;

  const REALM = 'e2e-mfa-reset-passkeys';
  const base = () => `/admin/realms/${REALM}/users/${seeded.user.id}/mfa`;
  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('authorization', `Bearer ${adminToken}`);

  const addPasskey = (friendlyName: string) =>
    ctx.prisma.webAuthnCredential.create({
      data: {
        userId: seeded.user.id,
        realmId: seeded.realm.id,
        credentialId: randomBytes(16).toString('base64url'),
        publicKey: randomBytes(65),
        deviceType: 'multiDevice',
        backedUp: true,
        transports: ['internal'],
        friendlyName,
      },
    });

  const addTotp = () =>
    ctx.prisma.userCredential.upsert({
      where: { userId_type: { userId: seeded.user.id, type: 'totp' } },
      create: {
        userId: seeded.user.id,
        type: 'totp',
        secretKey: 'unused-in-this-test',
        verified: true,
      },
      update: { verified: true },
    });

  const passkeyCount = () =>
    ctx.prisma.webAuthnCredential.count({ where: { userId: seeded.user.id } });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    seeded = await ctx.seedTestRealm(REALM);

    // Resetting a user's MFA refuses the API key on purpose: an admin with a
    // recent MFA check.
    const master = await ctx.prisma.realm.findUniqueOrThrow({
      where: { name: 'master' },
      include: { roles: true },
    });
    const superAdmin = master.roles.find(
      (r) => r.name === 'super-admin' && !r.clientId,
    );
    const mfaAdmin = await ctx.prisma.user.create({
      data: {
        realmId: master.id,
        username: 'e2e-passkey-reset-admin',
        enabled: true,
        userRoles: { create: { roleId: superAdmin!.id } },
      },
    });
    mfaAdminId = mfaAdmin.id;
    ({ access_token: adminToken } = await app
      .get(AdminAuthService)
      .issueAdminToken(mfaAdmin, ['super-admin'], {
        amr: ['pwd', 'otp', 'mfa'],
        acr: ACR_MFA,
      }));
  }, 30_000);

  beforeEach(() =>
    ctx.prisma.webAuthnCredential.deleteMany({
      where: { userId: seeded.user.id },
    }),
  );

  afterAll(async () => {
    await ctx.prisma.user
      .delete({ where: { id: mfaAdminId } })
      .catch(() => undefined);
    await ctx.prisma.realm
      .delete({ where: { name: REALM } })
      .catch(() => undefined);
    await ctx.cleanup();
  });

  it('the status counts passkeys apart from the second factors', async () => {
    await addPasskey('Laptop');
    const res = await asAdmin(http().get(`${base()}/status`)).expect(200);
    expect(res.body).toMatchObject({ passkeys: 1 });
    expect(res.body.methods).not.toContain('webauthn');
  });

  it('a full reset removes the passkeys and the second factors', async () => {
    await addTotp();
    await addPasskey('Attacker key');
    await addPasskey('Phone');

    await asAdmin(http().delete(base())).expect(204);

    expect(await passkeyCount()).toBe(0);
    expect(
      await ctx.prisma.userCredential.count({
        where: { userId: seeded.user.id, type: 'totp' },
      }),
    ).toBe(0);
  });

  it('keepPasskeys=true keeps them', async () => {
    await addTotp();
    await addPasskey('Phone');

    await asAdmin(http().delete(`${base()}?keepPasskeys=true`)).expect(204);

    expect(await passkeyCount()).toBe(1);
    expect(
      await ctx.prisma.userCredential.count({
        where: { userId: seeded.user.id, type: 'totp' },
      }),
    ).toBe(0);
  });

  it('a malformed keepPasskeys is refused and changes nothing', async () => {
    await addPasskey('Phone');
    await asAdmin(http().delete(`${base()}?keepPasskeys=yes`)).expect(400);
    expect(await passkeyCount()).toBe(1);
  });

  it('an admin lists and removes a single passkey', async () => {
    const keep = await addPasskey('Phone');
    const drop = await addPasskey('Unknown laptop');

    const list = await asAdmin(http().get(`${base()}/passkeys`)).expect(200);
    expect(
      (list.body as Array<{ id: string; friendlyName: string }>).map(
        (p) => p.friendlyName,
      ),
    ).toEqual(['Phone', 'Unknown laptop']);
    expect(JSON.stringify(list.body)).not.toContain('publicKey');

    await asAdmin(http().delete(`${base()}/passkeys/${drop.id}`)).expect(204);
    const left = await ctx.prisma.webAuthnCredential.findMany({
      where: { userId: seeded.user.id },
    });
    expect(left.map((p) => p.id)).toEqual([keep.id]);

    // Another user's or an unknown id is a 404.
    await asAdmin(http().delete(`${base()}/passkeys/${drop.id}`)).expect(404);
  });

  it('the static API key cannot remove passkeys', async () => {
    const p = await addPasskey('Phone');
    await http()
      .delete(`${base()}/passkeys/${p.id}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(401);
    await http()
      .delete(base())
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(401);
    expect(await passkeyCount()).toBe(1);
  });
});
