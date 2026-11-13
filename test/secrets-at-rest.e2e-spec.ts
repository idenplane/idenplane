import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { Browser, useThemeViews } from './helpers/browser';
import { authorizeUrl, isCodeResponse } from './helpers/auth-flow';
import { CryptoService } from '../src/crypto/crypto.service';
import { AuditStreamsService } from '../src/events/audit-streams.service';
import { SECRET_PLACEHOLDER } from '../src/realms/secret-placeholder';
import {
  KEY_CHECK_ID,
  SecretsAtRestService,
  StoredSecretsKeyError,
} from '../src/secrets-at-rest/secrets-at-rest.service';

/** Every bind the (mocked) LDAP server receives: [dn, password]. */
const mockLdapBinds: Array<[string, string]> = [];
jest.mock('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: jest.fn((dn: string, password: string) => {
      mockLdapBinds.push([dn, password]);
      return Promise.resolve();
    }),
    unbind: jest.fn(() => Promise.resolve()),
    startTLS: jest.fn(() => Promise.resolve()),
    search: jest.fn(() => Promise.resolve({ searchEntries: [] })),
  })),
}));

type Row = Record<string, any>;

/**
 * Secrets encrypted at rest: identity provider client secrets, LDAP bind
 * credentials, audit stream headers, organization SSO secrets, signing keys
 * and TOTP seeds. The admin API stores ciphertext and shows the
 * placeholder, the code that uses each secret still works, and the start-up
 * sweep encrypts legacy plaintext rows once and refuses a wrong key.
 */
describe('Secrets at rest (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication<App>;
  let seeded: SeededRealm;
  const crypto = new CryptoService();
  const REALM = 'e2e-secrets-at-rest';
  const admin = (path: string) => `/admin/realms/${REALM}${path}`;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
  }, 30_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  // ─── Identity provider + broker ─────────────────────────────────────────

  describe('identity provider client secret', () => {
    const IDP = {
      alias: 'mockidp',
      displayName: 'Mock IdP',
      clientId: 'idenplane',
      clientSecret: 'idp-client-secret',
      authorizationUrl: 'https://idp.example.test/authorize',
      tokenUrl: 'https://idp.example.test/token',
      userinfoUrl: 'https://idp.example.test/userinfo',
      trustEmail: true,
    };

    it('is stored encrypted and shown as the placeholder', async () => {
      const created = await api()
        .post(admin('/identity-providers'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send(IDP)
        .expect(201);
      expect(created.body.clientSecret).toBe(SECRET_PLACEHOLDER);

      const row = await ctx.prisma.identityProvider.findFirstOrThrow({
        where: { realmId: seeded.realm.id, alias: 'mockidp' },
      });
      expect(row.clientSecret).not.toBe('idp-client-secret');
      expect(crypto.decrypt(row.clientSecret)).toBe('idp-client-secret');

      const got = await api()
        .get(admin('/identity-providers/mockidp'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(got.body.clientSecret).toBe(SECRET_PLACEHOLDER);
      expect(JSON.stringify(got.body)).not.toContain('idp-client-secret');
    });

    it('a form re-sending the whole object keeps the stored secret', async () => {
      const before = await ctx.prisma.identityProvider.findFirstOrThrow({
        where: { realmId: seeded.realm.id, alias: 'mockidp' },
      });
      const got = await api()
        .get(admin('/identity-providers/mockidp'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      // What the admin UI's detail page sends back.
      const body = {
        displayName: 'Mock IdP (renamed)',
        enabled: got.body.enabled,
        clientId: got.body.clientId,
        clientSecret: got.body.clientSecret,
        authorizationUrl: got.body.authorizationUrl,
        tokenUrl: got.body.tokenUrl,
        userinfoUrl: got.body.userinfoUrl,
        trustEmail: got.body.trustEmail,
      };
      const put = await api()
        .put(admin('/identity-providers/mockidp'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send(body)
        .expect(200);
      expect(put.body.clientSecret).toBe(SECRET_PLACEHOLDER);
      const after = await ctx.prisma.identityProvider.findFirstOrThrow({
        where: { realmId: seeded.realm.id, alias: 'mockidp' },
      });
      expect(after.clientSecret).toBe(before.clientSecret);
      expect(after.displayName).toBe('Mock IdP (renamed)');

      await api()
        .put(admin('/identity-providers/mockidp'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ clientSecret: `${SECRET_PLACEHOLDER}x` })
        .expect(400);
    });

    it('the broker still signs in through the mock IdP, sending the plaintext secret', async () => {
      const realFetch = global.fetch;
      const tokenBodies: string[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === 'https://idp.example.test/token') {
          tokenBodies.push(String(init?.body));
          return new Response(JSON.stringify({ access_token: 'at' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === 'https://idp.example.test/userinfo') {
          return new Response(
            JSON.stringify({
              sub: 'ext-secrets-at-rest',
              email: 'federated-secrets@example.test',
              email_verified: true,
              preferred_username: 'federated-secrets',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return realFetch(input, init);
      });
      try {
        const browser = new Browser(app);
        const auth = await browser.get(authorizeUrl(REALM, {}));
        const page = await browser.get(auth.headers['location'] as string);
        const button =
          /href="(\/realms\/[^"]+\/broker\/mockidp\/login[^"]*)"/.exec(
            page.text,
          );
        expect(button).not.toBeNull();
        const href = (button as RegExpExecArray)[1]
          .replaceAll('&#x3D;', '=')
          .replaceAll('&amp;', '&');
        const toIdp = await browser.get(href);
        const state = new URL(
          toIdp.headers['location'] as string,
        ).searchParams.get('state') as string;
        const back = await browser.get(
          `/realms/${REALM}/broker/mockidp/callback?code=c&state=${encodeURIComponent(state)}`,
        );
        expect(isCodeResponse(back.headers['location'])).toBe(true);
        expect(tokenBodies).toHaveLength(1);
        expect(new URLSearchParams(tokenBodies[0]).get('client_secret')).toBe(
          'idp-client-secret',
        );
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  // ─── LDAP ───────────────────────────────────────────────────────────────

  describe('LDAP bind credential', () => {
    let id: string;

    it('is stored encrypted, shown as the placeholder, and used to bind', async () => {
      const created = await api()
        .post(admin('/user-federation'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({
          name: 'corp-ldap',
          connectionUrl: 'ldap://ldap.example.test:389',
          bindDn: 'cn=admin,dc=example,dc=test',
          bindCredential: 'ldap-bind-password',
          usersDn: 'ou=users,dc=example,dc=test',
        })
        .expect(201);
      id = created.body.id;
      expect(created.body.bindCredential).toBe(SECRET_PLACEHOLDER);

      const row = await ctx.prisma.userFederation.findUniqueOrThrow({
        where: { id },
      });
      expect(row.bindCredential).not.toBe('ldap-bind-password');
      expect(crypto.decrypt(row.bindCredential)).toBe('ldap-bind-password');

      const list = await api()
        .get(admin('/user-federation'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('ldap-bind-password');
      expect(list.body[0].bindCredential).toBe(SECRET_PLACEHOLDER);

      mockLdapBinds.length = 0;
      const test = await api()
        .post(admin(`/user-federation/${id}/test-connection`))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY);
      expect(test.body).toEqual({ success: true });
      expect(mockLdapBinds).toEqual([
        ['cn=admin,dc=example,dc=test', 'ldap-bind-password'],
      ]);
    });

    it('a form re-sending the placeholder keeps the stored credential', async () => {
      const before = await ctx.prisma.userFederation.findUniqueOrThrow({
        where: { id },
      });
      const got = await api()
        .get(admin(`/user-federation/${id}`))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      await api()
        .put(admin(`/user-federation/${id}`))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({
          name: got.body.name,
          connectionUrl: got.body.connectionUrl,
          bindDn: got.body.bindDn,
          bindCredential: got.body.bindCredential,
          usersDn: got.body.usersDn,
          priority: 5,
        })
        .expect(200);
      const after = await ctx.prisma.userFederation.findUniqueOrThrow({
        where: { id },
      });
      expect(after.bindCredential).toBe(before.bindCredential);
      expect(after.priority).toBe(5);
    });
  });

  // ─── Audit stream headers ───────────────────────────────────────────────

  describe('audit stream headers', () => {
    it('are stored encrypted, shown as placeholders, merged by name, and sent in clear', async () => {
      const created = await api()
        .post(admin('/audit-streams'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({
          name: 'siem',
          streamType: 'http',
          url: 'https://logs.example.test/ingest',
          httpHeaders: { Authorization: 'Bearer siem-token' },
        })
        .expect(201);
      expect(created.body.httpHeaders).toEqual({
        Authorization: SECRET_PLACEHOLDER,
      });
      const id = created.body.id as string;
      const row = await ctx.prisma.auditLogStream.findUniqueOrThrow({
        where: { id },
      });
      const stored = (row.httpHeaders as Row).Authorization as string;
      expect(stored).not.toContain('siem-token');
      expect(crypto.decrypt(stored)).toBe('Bearer siem-token');

      await api()
        .put(admin(`/audit-streams/${id}`))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({
          httpHeaders: {
            Authorization: SECRET_PLACEHOLDER,
            'X-Tenant': 'acme',
          },
        })
        .expect(200);
      const after = await ctx.prisma.auditLogStream.findUniqueOrThrow({
        where: { id },
      });
      expect((after.httpHeaders as Row).Authorization).toBe(stored);
      expect(crypto.decrypt((after.httpHeaders as Row)['X-Tenant'])).toBe(
        'acme',
      );

      const sent: Array<Record<string, string>> = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
        sent.push(init?.headers as Record<string, string>);
        return new Response('', { status: 204 });
      });
      try {
        await (
          app.get(AuditStreamsService) as unknown as {
            doDispatch: (r: string, t: string, p: object) => Promise<void>;
          }
        ).doDispatch(seeded.realm.id, 'TEST', {});
      } finally {
        jest.restoreAllMocks();
      }
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer siem-token',
          'X-Tenant': 'acme',
        }),
      );
    });
  });

  // ─── Organization SSO ───────────────────────────────────────────────────

  describe('organization SSO connection config', () => {
    it('keeps its secrets encrypted and shows the rest', async () => {
      await api()
        .post(admin('/organizations'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ name: 'Acme', slug: 'acme' })
        .expect(201);
      const created = await api()
        .post(admin('/organizations/acme/sso-connections'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({
          type: 'oidc',
          name: 'Acme OIDC',
          config: {
            issuer: 'https://acme.example.test',
            clientId: 'acme',
            clientSecret: 'acme-sso-secret',
          },
        })
        .expect(201);
      expect(created.body.config).toEqual({
        issuer: 'https://acme.example.test',
        clientId: 'acme',
        clientSecret: SECRET_PLACEHOLDER,
      });
      const row = await ctx.prisma.organizationSsoConnection.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      const stored = (row.config as Row).clientSecret as string;
      expect(crypto.decrypt(stored)).toBe('acme-sso-secret');

      await api()
        .put(admin(`/organizations/acme/sso-connections/${created.body.id}`))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ config: { ...created.body.config, clientId: 'acme-2' } })
        .expect(200);
      const after =
        await ctx.prisma.organizationSsoConnection.findUniqueOrThrow({
          where: { id: created.body.id },
        });
      expect((after.config as Row).clientSecret).toBe(stored);
      expect((after.config as Row).clientId).toBe('acme-2');

      // The admin event trail does not keep the secret either.
      const events = await ctx.prisma.adminEvent.findMany({
        where: { realmId: seeded.realm.id },
      });
      expect(JSON.stringify(events)).not.toMatch(
        /acme-sso-secret|ldap-bind-password|siem-token|idp-client-secret/,
      );
    });
  });

  // ─── Start-up sweep ─────────────────────────────────────────────────────

  describe('start-up sweep of legacy plaintext', () => {
    const sweep = () => new SecretsAtRestService(ctx.prisma, crypto).run();

    /** Rows as an older version stored them, written straight to the db. */
    const seedLegacy = async () => {
      const realmId = seeded.realm.id;
      await ctx.prisma.identityProvider.create({
        data: {
          realmId,
          alias: 'legacy-idp',
          clientId: 'c',
          clientSecret: 'legacy-idp-secret',
          authorizationUrl: 'https://legacy.example.test/a',
          tokenUrl: 'https://legacy.example.test/t',
        },
      });
      await ctx.prisma.userFederation.create({
        data: {
          realmId,
          name: 'legacy-ldap',
          connectionUrl: 'ldap://legacy.example.test',
          bindDn: 'cn=x',
          bindCredential: 'legacy-bind',
          usersDn: 'ou=u',
        },
      });
      await ctx.prisma.auditLogStream.create({
        data: {
          realmId,
          name: 'legacy-stream',
          streamType: 'http',
          url: 'https://legacy.example.test/s',
          httpHeaders: { Authorization: 'Bearer legacy-header' },
        },
      });
      const org = await ctx.prisma.organization.create({
        data: { realmId, name: 'Legacy', slug: 'legacy-org' },
      });
      await ctx.prisma.organizationSsoConnection.create({
        data: {
          organizationId: org.id,
          type: 'oidc',
          name: 'legacy',
          config: { clientId: 'l', clientSecret: 'legacy-sso' },
        },
      });
      await ctx.prisma.userCredential.create({
        data: {
          userId: seeded.user.id,
          type: 'totp',
          secretKey: 'JBSWY3DPEHPK3PXP',
          verified: true,
        },
      });
      await ctx.prisma.realm.update({
        where: { id: realmId },
        data: { smtpPassword: 'legacy-smtp' },
      });
    };

    const readLegacy = async () => {
      const realmId = seeded.realm.id;
      const [idp, ldap, stream, sso, totp, key, realm] = await Promise.all([
        ctx.prisma.identityProvider.findFirstOrThrow({
          where: { realmId, alias: 'legacy-idp' },
        }),
        ctx.prisma.userFederation.findFirstOrThrow({
          where: { realmId, name: 'legacy-ldap' },
        }),
        ctx.prisma.auditLogStream.findFirstOrThrow({
          where: { realmId, name: 'legacy-stream' },
        }),
        ctx.prisma.organizationSsoConnection.findFirstOrThrow({
          where: { name: 'legacy', organization: { slug: 'legacy-org' } },
        }),
        ctx.prisma.userCredential.findFirstOrThrow({
          where: { userId: seeded.user.id, type: 'totp' },
        }),
        ctx.prisma.realmSigningKey.findFirstOrThrow({ where: { realmId } }),
        ctx.prisma.realm.findUniqueOrThrow({ where: { id: realmId } }),
      ]);
      return {
        idp: idp.clientSecret,
        ldap: ldap.bindCredential,
        header: (stream.httpHeaders as Row).Authorization as string,
        sso: (sso.config as Row).clientSecret as string,
        totp: totp.secretKey,
        signingKey: key.privateKey,
        smtp: realm.smtpPassword!,
      };
    };

    it('encrypts every legacy value once; a second run changes nothing', async () => {
      await seedLegacy();
      const legacy = await readLegacy();
      // test/setup.ts seeds the signing key in plaintext, like old rows.
      expect(legacy.signingKey).toContain('PRIVATE KEY');

      await sweep();
      const once = await readLegacy();
      expect(crypto.decrypt(once.idp)).toBe('legacy-idp-secret');
      expect(crypto.decrypt(once.ldap)).toBe('legacy-bind');
      expect(crypto.decrypt(once.header)).toBe('Bearer legacy-header');
      expect(crypto.decrypt(once.sso)).toBe('legacy-sso');
      expect(crypto.decrypt(once.totp)).toBe('JBSWY3DPEHPK3PXP');
      expect(crypto.decrypt(once.signingKey)).toBe(legacy.signingKey);
      expect(crypto.decrypt(once.smtp)).toBe('legacy-smtp');

      await sweep();
      expect(await readLegacy()).toEqual(once);
    });

    it('several processes sweeping at once agree, and every value stays readable', async () => {
      await ctx.prisma.identityProvider.updateMany({
        where: { realmId: seeded.realm.id, alias: 'legacy-idp' },
        data: { clientSecret: 'legacy-idp-secret-2' },
      });
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => sweep()),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const encrypted = results.map(
        (r) =>
          (r as PromiseFulfilledResult<{ encrypted: Row }>).value.encrypted[
            'identity_providers'
          ] ?? 0,
      );
      expect(encrypted.reduce((a: number, b: number) => a + b, 0)).toBe(1);
      expect(crypto.decrypt((await readLegacy()).idp)).toBe(
        'legacy-idp-secret-2',
      );
    });

    it('the admin API shows the placeholder for a row the sweep has not reached yet', async () => {
      await ctx.prisma.identityProvider.updateMany({
        where: { realmId: seeded.realm.id, alias: 'legacy-idp' },
        data: { clientSecret: 'still-plain' },
      });
      const got = await api()
        .get(admin('/identity-providers/legacy-idp'))
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(got.body.clientSecret).toBe(SECRET_PLACEHOLDER);
      await sweep();
    });

    describe('with the wrong key', () => {
      const withEnv = (env: Record<string, string | undefined>) => {
        const saved: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(env)) {
          saved[k] = process.env[k];
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        return () => {
          for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        };
      };

      it('refuses to start and rewrites nothing', async () => {
        await ctx.prisma.identityProvider.updateMany({
          where: { realmId: seeded.realm.id, alias: 'legacy-idp' },
          data: { clientSecret: 'plain-again' },
        });
        const before = await readLegacy();
        const restore = withEnv({ WEBHOOK_SECRET_KEY: 'a-different-key' });
        let wrong: CryptoService;
        try {
          wrong = new CryptoService();
        } finally {
          restore();
        }
        await expect(
          new SecretsAtRestService(ctx.prisma, wrong).run(),
        ).rejects.toThrow(StoredSecretsKeyError);
        expect(await readLegacy()).toEqual(before);
        await sweep();
      });

      it('on the very first run, refuses when no webhook secret decrypts', async () => {
        const check = await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
          where: { id: KEY_CHECK_ID },
        });
        const webhook = await ctx.prisma.webhook.create({
          data: {
            realmId: seeded.realm.id,
            url: 'https://hooks.example.test',
            secret: crypto.encrypt('hook'),
          },
        });
        await ctx.prisma.encryptionKeyCheck.delete({
          where: { id: KEY_CHECK_ID },
        });
        const restore = withEnv({ WEBHOOK_SECRET_KEY: 'a-different-key' });
        let wrong: CryptoService;
        try {
          wrong = new CryptoService();
        } finally {
          restore();
        }
        try {
          await expect(
            new SecretsAtRestService(ctx.prisma, wrong).run(),
          ).rejects.toThrow(StoredSecretsKeyError);
          expect(
            await ctx.prisma.encryptionKeyCheck.count({
              where: { id: KEY_CHECK_ID },
            }),
          ).toBe(0);
        } finally {
          await ctx.prisma.encryptionKeyCheck.upsert({
            where: { id: KEY_CHECK_ID },
            create: check,
            update: {},
          });
          await ctx.prisma.webhook.delete({ where: { id: webhook.id } });
        }
      });

      it('in production, refuses to run without a configured key', async () => {
        const restore = withEnv({
          NODE_ENV: 'production',
          WEBHOOK_SECRET_KEY: undefined,
        });
        try {
          await expect(sweep()).rejects.toThrow(/must be set/);
        } finally {
          restore();
        }
      });
    });
  });
});
