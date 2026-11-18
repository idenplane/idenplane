/**
 * Regressions for what the OWASP ZAP scans (.github/workflows/dast-zap.yml)
 * found, so they cannot come back between scans:
 *
 * - the API scan made ~30 endpoints answer 500: a request with no body
 *   crashed the handler (Express 5 leaves req.body undefined), a NUL
 *   character reached PostgreSQL (SQLSTATE 22021), and unparseable dates and
 *   numbers in query strings reached Prisma as Invalid Date / NaN;
 * - the baseline scan found the hosted pages without Permissions-Policy and
 *   Cross-Origin-Resource-Policy, cacheable by shared caches, and with a CSP
 *   allowing any inline <style> element.
 *
 * Each case asserts a client error (4xx), never a 5xx, and that no database
 * error text reaches the response.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { useThemeViews } from './helpers/browser';
import { prismaClientError } from '../src/common/filters/http-exception.filter';

const REALM = 'dast-regressions';

describe('DAST regressions (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  const http = () => request(app.getHttpServer());
  const admin = (r: request.Test) =>
    r.set('x-admin-api-key', TEST_ADMIN_API_KEY);

  function expectClientError(res: request.Response, label: string) {
    expect({ label, status: res.status }).toEqual({
      label,
      status: expect.any(Number),
    });
    if (res.status >= 500) {
      throw new Error(
        `${label} answered ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`,
      );
    }
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = JSON.stringify(res.body ?? res.text);
    expect(text).not.toMatch(
      /prisma|Invalid `|SQLSTATE|invalid byte sequence/i,
    );
  }

  describe('a request without a body is a client error, not a crash', () => {
    const cases: Array<[string, 'post' | 'patch', string, boolean]> = [
      [
        'revoke',
        'post',
        `/realms/${REALM}/protocol/openid-connect/revoke`,
        false,
      ],
      [
        'back-channel logout',
        'post',
        `/realms/${REALM}/protocol/openid-connect/logout/backchannel`,
        false,
      ],
      [
        'MFA SMS',
        'post',
        `/realms/${REALM}/protocol/openid-connect/mfa/sms`,
        false,
      ],
      ['step-up verify', 'post', `/realms/${REALM}/step-up/verify`, false],
      ['device verification', 'post', `/realms/${REALM}/device`, false],
      [
        'create risk policy',
        'post',
        `/admin/realms/${REALM}/risk-policies`,
        true,
      ],
      [
        'toggle risk policy',
        'patch',
        `/admin/realms/${REALM}/risk-policies/some-id/toggle`,
        true,
      ],
      [
        'reorder risk policy',
        'patch',
        `/admin/realms/${REALM}/risk-policies/some-id/priority`,
        true,
      ],
      [
        'add protocol mapper',
        'post',
        `/admin/realms/${REALM}/client-scopes/some-id/protocol-mappers`,
        true,
      ],
      [
        'SCIM attribute mapping',
        'post',
        `/admin/realms/${REALM}/scim/attribute-mappings`,
        true,
      ],
    ];
    it.each(cases)('%s', async (label, method, path, isAdmin) => {
      let r = http()[method](path);
      if (isAdmin) r = admin(r);
      expectClientError(await r, label);
    });

    it('also with a content type no parser handles', async () => {
      const res = await http()
        .post(`/realms/${REALM}/protocol/openid-connect/revoke`)
        .set('Content-Type', 'text/plain')
        .send('token=abc');
      expectClientError(res, 'revoke text/plain');
    });
  });

  describe('a NUL character is refused before it reaches the database', () => {
    it('in a JSON body field', async () => {
      const res = await admin(
        http().post(`/admin/realms/${REALM}/webhooks`),
      ).send({
        url: 'https://example.com/hook\u0000',
        events: ['user.created'],
      });
      expectClientError(res, 'webhook with NUL');
      expect(res.status).toBe(400);
    });

    it('in a JSON body key', async () => {
      const res = await admin(
        http().post(`/admin/realms/${REALM}/saml-service-providers`),
      ).send({
        ['entityId\u0000']: 'x',
      });
      expectClientError(res, 'NUL key');
    });

    it('in a query parameter', async () => {
      const res = await admin(
        http().get(`/admin/realms/${REALM}/users?lastName=%00`),
      );
      expectClientError(res, 'users ?lastName=%00');
      expect(res.status).toBe(400);
    });

    it('in a query parameter of a DELETE', async () => {
      const res = await admin(
        http().delete(
          `/admin/realms/${REALM}/nhi/audit-logs?nhiIdentityId=%00`,
        ),
      );
      expectClientError(res, 'nhi audit-logs NUL');
    });

    it('in a path parameter', async () => {
      const res = await admin(
        http().get(`/admin/realms/${REALM}/users/abc%00def`),
      );
      expectClientError(res, 'user id NUL');
      expect(res.status).toBe(400);
    });
  });

  describe('unparseable dates and numbers in query strings', () => {
    const cases: Array<[string, string]> = [
      [
        'login events',
        `/admin/realms/${REALM}/events?type=type&userId=userId&clientId=clientId&dateFrom=dateFrom&dateTo=dateTo&first=first&max=max`,
      ],
      [
        'admin events',
        `/admin/realms/${REALM}/admin-events?operationType=operationType&resourceType=resourceType&dateFrom=dateFrom&dateTo=dateTo&first=first&max=max`,
      ],
      [
        'admin events export',
        `/admin/realms/${REALM}/events/admin/export?format=json&dateFrom=dateFrom&dateTo=dateTo`,
      ],
      [
        'login events export',
        `/admin/realms/${REALM}/events/login/export?format=json&dateFrom=dateFrom&dateTo=dateTo`,
      ],
      [
        'NHI audit logs',
        `/admin/realms/${REALM}/nhi/audit-logs?nhiIdentityId=x&action=action&success=success&dateFrom=dateFrom&dateTo=dateTo&first=first&max=max`,
      ],
    ];
    it.each(cases)('%s', async (label, path) => {
      expectClientError(await admin(http().get(path)), label);
    });

    it('pending registrations with a fractional page size', async () => {
      const res = await admin(
        http().get(
          `/realms/${REALM}/registration/pending?skip=http%3A%2F%2Fwww.example.com%2F&take=1.2`,
        ),
      );
      expectClientError(res, 'registration pending');
    });
  });

  describe('database errors caused by input map to client errors', () => {
    it('an invalid text encoding (SQLSTATE 22021) is a 400', async () => {
      const err = await ctx.prisma.realm
        .findFirst({ where: { name: 'a\u0000b' } })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeTruthy();
      expect(prismaClientError(err)).toEqual({
        status: 400,
        message: expect.any(String),
      });
    });

    it('a value of the wrong type (PrismaClientValidationError) is a 400', async () => {
      const err = await ctx.prisma.realm
        .findMany({ take: 'many' as unknown as number })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect((err as Error).name).toBe('PrismaClientValidationError');
      expect(prismaClientError(err)?.status).toBe(400);
    });

    it('a duplicate unique key (P2002) is a 409', async () => {
      const err = await ctx.prisma.realm
        .create({ data: { name: REALM, displayName: 'dup', enabled: true } })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect((err as { code?: string }).code).toBe('P2002');
      expect(prismaClientError(err)?.status).toBe(409);
    });
  });

  describe('reflected OAuth parameters (ZAP 10031) are escaped', () => {
    it.each(['login', 'register'])('on the %s page', async (page) => {
      const evil = '"><script>alert(1)</script><x a="';
      const res = await http().get(
        `/realms/${REALM}/${page}?client_id=${seeded.client.clientId}&response_type=code&scope=openid&state=${encodeURIComponent(evil)}&login_hint=${encodeURIComponent(evil)}`,
      );
      expect(res.status).toBeLessThan(500);
      expect(res.text).not.toContain('<script>alert(1)</script>');
      expect(res.text).not.toContain('"><script>');
    });
  });

  describe('stored template probes stay literal JSON', () => {
    it('does not evaluate webhook event types, descriptions or exported secrets', async () => {
      const attack = 'zj{{11940|add:38450}}zj';
      // The alleged result of the first probe occurs inside the second,
      // unevaluated probe: this is the collision ZAP 90035 reported.
      const secret = 'zj{{86320|add:50390}}zj';
      const description = 'zj{{7*7}}zj';
      const created = await admin(
        http().post(`/admin/realms/${REALM}/webhooks`),
      ).send({
        url: 'https://example.com/hook',
        eventTypes: [attack],
        secret,
        description,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        eventTypes: [attack],
        secret,
        description,
      });

      const exported = await admin(
        http().get(
          `/admin/realms/${REALM}/export?includeUsers=true&includeSecrets=true`,
        ),
      );
      expect(exported.status).toBe(200);
      expect(exported.headers['content-type']).toMatch(/^application\/json/);
      expect(exported.headers['x-content-type-options']).toBe('nosniff');
      expect(exported.body.webhooks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventTypes: [attack],
            secret,
            description,
          }),
        ]),
      );
      expect(exported.text).not.toContain('zj50390zj');
      expect(exported.text).not.toContain('zj49zj');
    });
  });

  describe('security headers', () => {
    it('hosted pages: Permissions-Policy, CORP, no-store, nonce-only <style>', async () => {
      const res = await http().get(
        `/realms/${REALM}/login?client_id=${seeded.client.clientId}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&response_type=code&scope=openid`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers['permissions-policy']).toContain(
        'publickey-credentials-get=(self)',
      );
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['cache-control']).toBe('no-store');
      const csp = res.headers['content-security-policy'] as string;
      const nonce = /style-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(csp).not.toMatch(/style-src [^;]*'unsafe-inline'/);
      // Every <style> element on the page carries that nonce, or the
      // browser would drop it.
      const styles = res.text.match(/<style[^>]*>/g) ?? [];
      expect(styles.length).toBeGreaterThan(0);
      // Handlebars HTML-escapes the attribute ('=' as &#x3D;), which the
      // browser decodes before comparing it with the CSP.
      for (const tag of styles) {
        const attr = /nonce="([^"]*)"/.exec(tag)?.[1] ?? '';
        expect(attr.replaceAll('&#x3D;', '=').replaceAll('&#x2F;', '/')).toBe(
          nonce,
        );
      }
    });

    it('admin API responses are not cacheable', async () => {
      const res = await admin(http().get(`/admin/realms/${REALM}`));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('public metadata stays cacheable; theme assets are embeddable cross-origin', async () => {
      const jwks = await http().get(
        `/realms/${REALM}/protocol/openid-connect/certs`,
      );
      expect(jwks.headers['cache-control']).not.toBe('no-store');
      const theme = await http().get(
        '/themes/idenplane/login/resources/css/auth.css',
      );
      expect(theme.headers['cross-origin-resource-policy']).toBe(
        'cross-origin',
      );
    });
  });
});
