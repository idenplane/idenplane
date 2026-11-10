import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestContext } from './setup';
import { CacheBusService } from '../src/cache/cache-bus.service';

/**
 * What a token says about its user, cached in-process, against a real
 * database. Every change is made with raw SQL, past the application, so only
 * the database's own announcement (the user_claims_cache_triggers migration)
 * can make the next token or introspection see it.
 */
describe('User claims cache invalidation (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let bus: CacheBusService;
  let realmId: string;
  const REALM = 'e2e-user-claims-cache';
  const SA = 'e2e-claims-sa';
  const sql = (q: string) => ctx.prisma.$executeRawUnsafe(q);

  const eventually = async (check: () => Promise<void>, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        return await check();
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  const waitConnected = () =>
    eventually(async () => expect(bus.isConnected()).toBe(true), 10_000);

  const tokenFor = async (clientId = 'test-client') => {
    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: 'test-client-secret',
      })
      .expect(200);
    return (res.body as { access_token: string }).access_token;
  };
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      realm_access?: { roles: string[] };
      resource_access?: Record<string, { roles: string[] }>;
      [claim: string]: unknown;
    };
  const tokenClaims = async () => claimsOf(await tokenFor());
  const introspect = async (token: string) => {
    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token/introspect`)
      .type('form')
      .send({
        token,
        client_id: 'test-client',
        client_secret: 'test-client-secret',
      })
      .expect(200);
    return res.body as { active: boolean; username?: string };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    bus = app.get(CacheBusService);
    const seeded = await ctx.seedTestRealm(REALM);
    realmId = seeded.realm.id;
    // The test client gets a service account, as the admin API gives one
    // to every confidential client allowed client_credentials.
    await sql(
      `INSERT INTO users (id, realm_id, username, enabled, updated_at)
       VALUES ('${SA}', '${realmId}', 'service-account-test-client', true, now())`,
    );
    await sql(
      `UPDATE clients SET service_account_user_id = '${SA}' WHERE id = '${seeded.client.id}'`,
    );
    await waitConnected();
  }, 30_000);

  afterAll(async () => {
    await sql(`DELETE FROM realms WHERE name = '${REALM}'`);
    await ctx.cleanup();
  });

  it('puts a role granted directly into the very next token, and takes it out', async () => {
    expect((await tokenClaims()).realm_access?.roles).not.toContain('direct');
    await sql(
      `INSERT INTO roles (id, realm_id, name, updated_at)
       VALUES ('e2e-role-direct', '${realmId}', 'direct', now())`,
    );
    await sql(
      `INSERT INTO user_roles (id, user_id, role_id)
       VALUES ('e2e-ur-direct', '${SA}', 'e2e-role-direct')`,
    );
    await eventually(async () => {
      expect((await tokenClaims()).realm_access?.roles).toContain('direct');
    });
    await sql(`DELETE FROM user_roles WHERE id = 'e2e-ur-direct'`);
    await eventually(async () => {
      expect((await tokenClaims()).realm_access?.roles).not.toContain('direct');
    });
  });

  it('follows roles inherited through a group and its parent', async () => {
    await tokenClaims(); // cached
    await sql(
      `INSERT INTO roles (id, realm_id, name, updated_at) VALUES
       ('e2e-role-child', '${realmId}', 'from-child', now()),
       ('e2e-role-parent', '${realmId}', 'from-parent', now())`,
    );
    await sql(
      `INSERT INTO groups (id, realm_id, name, updated_at) VALUES
       ('e2e-group-parent', '${realmId}', 'parent', now())`,
    );
    await sql(
      `INSERT INTO groups (id, realm_id, name, parent_id, updated_at) VALUES
       ('e2e-group-child', '${realmId}', 'child', 'e2e-group-parent', now())`,
    );
    await sql(
      `INSERT INTO user_groups (id, user_id, group_id)
       VALUES ('e2e-ug', '${SA}', 'e2e-group-child')`,
    );
    await sql(
      `INSERT INTO group_roles (id, group_id, role_id) VALUES
       ('e2e-gr-child', 'e2e-group-child', 'e2e-role-child')`,
    );
    await eventually(async () => {
      expect((await tokenClaims()).realm_access?.roles).toContain('from-child');
    });

    // A role given to the parent group reaches the member of the child.
    await sql(
      `INSERT INTO group_roles (id, group_id, role_id) VALUES
       ('e2e-gr-parent', 'e2e-group-parent', 'e2e-role-parent')`,
    );
    await eventually(async () => {
      expect((await tokenClaims()).realm_access?.roles).toContain(
        'from-parent',
      );
    });

    // Renaming a role is seen too.
    await sql(`UPDATE roles SET name = 'renamed' WHERE id = 'e2e-role-parent'`);
    await eventually(async () => {
      const roles = (await tokenClaims()).realm_access?.roles;
      expect(roles).toContain('renamed');
      expect(roles).not.toContain('from-parent');
    });

    await sql(`DELETE FROM user_groups WHERE id = 'e2e-ug'`);
    await eventually(async () => {
      const roles = (await tokenClaims()).realm_access?.roles;
      expect(roles).not.toContain('from-child');
      expect(roles).not.toContain('renamed');
    });
  });

  it('names a client role under the client current client_id', async () => {
    await sql(
      `INSERT INTO clients (id, realm_id, client_id, client_type, name, enabled, redirect_uris, web_origins, grant_types, updated_at)
       VALUES ('e2e-api-client', '${realmId}', 'e2e-api', 'CONFIDENTIAL', 'API', true, '{}', '{}', '{}', now())`,
    );
    await sql(
      `INSERT INTO roles (id, realm_id, client_id, name, updated_at)
       VALUES ('e2e-role-api', '${realmId}', 'e2e-api-client', 'reader', now())`,
    );
    await sql(
      `INSERT INTO user_roles (id, user_id, role_id)
       VALUES ('e2e-ur-api', '${SA}', 'e2e-role-api')`,
    );
    await eventually(async () => {
      expect((await tokenClaims()).resource_access?.['e2e-api']?.roles).toEqual(
        ['reader'],
      );
    });
    await sql(
      `UPDATE clients SET client_id = 'e2e-api-v2' WHERE id = 'e2e-api-client'`,
    );
    await eventually(async () => {
      const access = (await tokenClaims()).resource_access ?? {};
      expect(access['e2e-api-v2']?.roles).toEqual(['reader']);
      expect(access['e2e-api']).toBeUndefined();
    });
  });

  it('carries a custom attribute claim as it changes', async () => {
    await sql(
      `INSERT INTO custom_attributes (id, realm_id, name, display_name, map_to_oidc_claim, updated_at)
       VALUES ('e2e-attr', '${realmId}', 'tier', 'Tier', 'tier', now())`,
    );
    await sql(
      `INSERT INTO user_attributes (id, user_id, attribute_id, value, updated_at)
       VALUES ('e2e-ua', '${SA}', 'e2e-attr', 'gold', now())`,
    );
    await eventually(async () => {
      expect((await tokenClaims())['tier']).toBe('gold');
    });
    await sql(
      `UPDATE user_attributes SET value = 'silver' WHERE id = 'e2e-ua'`,
    );
    await eventually(async () => {
      expect((await tokenClaims())['tier']).toBe('silver');
    });
    // The definition changes: the claim gets a new name.
    await sql(
      `UPDATE custom_attributes SET map_to_oidc_claim = 'plan' WHERE id = 'e2e-attr'`,
    );
    await eventually(async () => {
      const claims = await tokenClaims();
      expect(claims['plan']).toBe('silver');
      expect(claims['tier']).toBeUndefined();
    });
  });

  it('reports a token inactive as soon as its user is disabled', async () => {
    const token = await tokenFor();
    expect((await introspect(token)).active).toBe(true); // user now cached
    await sql(`UPDATE users SET enabled = false WHERE id = '${SA}'`);
    await eventually(async () => {
      expect((await introspect(token)).active).toBe(false);
    });
    await sql(`UPDATE users SET enabled = true WHERE id = '${SA}'`);
    await eventually(async () => {
      expect((await introspect(token)).active).toBe(true);
    });
  });

  it('shows a renamed user under the new name, and ignores sign-in bookkeeping', async () => {
    const token = await tokenFor();
    await introspect(token);
    await sql(
      `UPDATE users SET username = 'service-account-renamed' WHERE id = '${SA}'`,
    );
    await eventually(async () => {
      expect((await introspect(token)).username).toBe(
        'service-account-renamed',
      );
    });
    await sql(
      `UPDATE users SET username = 'service-account-test-client' WHERE id = '${SA}'`,
    );
    await eventually(async () => {
      expect((await introspect(token)).username).toBe(
        'service-account-test-client',
      );
    });
  });

  it('reports a token inactive as soon as its id is revoked', async () => {
    const token = await tokenFor();
    expect((await introspect(token)).active).toBe(true);
    const { jti, exp } = claimsOf(token) as unknown as {
      jti: string;
      exp: number;
    };
    await sql(
      `INSERT INTO revoked_tokens (jti, expires_at) VALUES ('${jti}', to_timestamp(${exp}))`,
    );
    await eventually(async () => {
      expect((await introspect(token)).active).toBe(false);
    });
  });

  it('reads the database while the announcement connection is down, and recovers', async () => {
    const token = await tokenFor();
    await introspect(token);
    await sql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE application_name = 'idenplane-cache-bus' AND pid <> pg_backend_pid()`,
    );
    await eventually(async () => expect(bus.isConnected()).toBe(false));

    // Never announced: nobody is listening. Still seen at once.
    await sql(
      `INSERT INTO roles (id, realm_id, name, updated_at)
       VALUES ('e2e-role-offline', '${realmId}', 'offline', now())`,
    );
    await sql(
      `INSERT INTO user_roles (id, user_id, role_id)
       VALUES ('e2e-ur-offline', '${SA}', 'e2e-role-offline')`,
    );
    expect((await tokenClaims()).realm_access?.roles).toContain('offline');
    const { jti, exp } = claimsOf(token) as unknown as {
      jti: string;
      exp: number;
    };
    await sql(
      `INSERT INTO revoked_tokens (jti, expires_at) VALUES ('${jti}', to_timestamp(${exp}))`,
    );
    expect((await introspect(token)).active).toBe(false);

    // Back: the caches start over from the database.
    await waitConnected();
    expect((await tokenClaims()).realm_access?.roles).toContain('offline');
    await eventually(async () => {
      expect((await introspect(token)).active).toBe(false);
    });
  }, 30_000);
});
