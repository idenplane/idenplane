import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { registerHandlebarsHelpers } from '../src/theme/handlebars-helpers.js';
import {
  ProxyAuthService,
  PROXY_LOGIN_HEADER,
  PROXY_PKCE_COOKIE,
  PROXY_SESSION_COOKIE,
} from '../src/proxy-auth/proxy-auth.service.js';

/**
 * Forward auth end to end, through the real app, with the CONFIDENTIAL client
 * the guide tells people to create: the proxy's verify call, the hop into the
 * ordinary login page, the callback that redeems the code, and verify again
 * with the session. Each request carries the headers the proxy really sends.
 *
 * v0.5.0 shipped with this flow broken at three points that no unit test
 * could see: a relative redirect out of verify, a start hop to an authorize
 * path that doesn't exist, and a code exchange that presented the stored
 * secret hash as the secret. This spec is what keeps them fixed.
 */
describe('Forward auth (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let proxy: ProxyAuthService;

  const REALM = 'e2e-forward-auth';
  const SLUG = 'whoami';
  const CLIENT_ID = 'whoami-proxy';
  const APP_HOST = 'app.example.test';
  const ORIGINAL = `https://${APP_HOST}/dashboard?tab=a&page=2`;

  /** Auth cookies are `Secure`, so they are tracked by hand like a browser. */
  class Browser {
    readonly jar = new Map<string, string>();

    private header(): string {
      return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    private store(res: request.Response): request.Response {
      const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
      for (const cookie of raw ?? []) {
        const [pair] = cookie.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = decodeURIComponent(pair.slice(eq + 1).trim());
        const cleared = !value || /expires=thu, 01 jan 1970/i.test(cookie);
        if (cleared) this.jar.delete(name);
        else this.jar.set(name, value);
      }
      return res;
    }

    async get(url: string, headers: Record<string, string> = {}) {
      return this.store(
        await request(app.getHttpServer())
          .get(pathOf(url))
          .set({ Accept: 'text/html', ...headers, Cookie: this.header() }),
      );
    }

    async post(url: string, form: Record<string, string>) {
      return this.store(
        await request(app.getHttpServer())
          .post(pathOf(url))
          .set('Cookie', this.header())
          .type('form')
          .send(form),
      );
    }
  }

  /** Requests go to the app under test whatever host BASE_URL names. */
  const pathOf = (url: string) => {
    const u = new URL(url, 'http://placeholder');
    return `${u.pathname}${u.search}`;
  };

  /** What Traefik and Caddy send to verify for a browser navigation. */
  const traefikHeaders = (original: string) => {
    const u = new URL(original);
    return {
      'X-Forwarded-Proto': u.protocol.replace(':', ''),
      'X-Forwarded-Host': u.host,
      'X-Forwarded-Uri': `${u.pathname}${u.search}`,
      'X-Forwarded-Method': 'GET',
    };
  };

  const verifyPath = `/realms/${REALM}/proxy/${SLUG}/verify`;

  const hiddenFields = (html: string) => {
    const fields: Record<string, string> = {};
    for (const m of html.matchAll(
      /<input type="hidden" name="([^"]+)" value="([^"]*)"/g,
    )) {
      fields[m[1]] = m[2]
        .replace(/&amp;/g, '&')
        .replace(/&#x3D;/g, '=')
        .replace(/&#x2F;/g, '/');
    }
    return fields;
  };

  /**
   * verify → start → authorize → login page → submit credentials. Returns the
   * browser and the callback URL the login answered with, not yet visited.
   */
  const signInUpToCallback = async () => {
    const browser = new Browser();

    const denied = await browser.get(verifyPath, traefikHeaders(ORIGINAL));
    expect(denied.status).toBe(302);
    // Absolute and on Idenplane's own origin: the proxy hands it straight to
    // the browser, which can't reach the proxy's internal address for us.
    expect(denied.headers['location']).toBe(
      proxy.startUrl(REALM, SLUG, ORIGINAL),
    );

    const started = await browser.get(denied.headers['location']);
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers['location']);
    expect(authorize.pathname).toBe(
      `/realms/${REALM}/protocol/openid-connect/auth`,
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(browser.jar.has(PROXY_PKCE_COOKIE)).toBe(true);

    let res = await browser.get(started.headers['location']);
    for (let hops = 0; res.status === 302 && hops < 5; hops++) {
      res = await browser.get(res.headers['location']);
    }
    expect(res.status).toBe(200);
    const fields = hiddenFields(res.text);
    expect(fields['_csrf']).toBeDefined();

    const loggedIn = await browser.post(`/realms/${REALM}/login`, {
      ...fields,
      username: 'testuser',
      password: 'TestPassword123!',
    });
    expect(loggedIn.status).toBe(302);
    const callback = loggedIn.headers['location'];
    expect(pathOf(callback)).toMatch(
      new RegExp(`^/realms/${REALM}/proxy/${SLUG}/callback\\?code=`),
    );
    return { browser, callback };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    const express = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: string) => void;
    };
    express.set('views', join(process.cwd(), 'themes'));
    express.set('view engine', 'hbs');
    registerHandlebarsHelpers();
    proxy = app.get(ProxyAuthService);

    await ctx.seedTestRealm(REALM);
    const admin = (path: string) =>
      request(app.getHttpServer())
        .post(`/admin/realms/${REALM}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY);

    // The guide's two admin calls, as written there.
    await admin('/clients')
      .send({
        clientId: CLIENT_ID,
        clientType: 'CONFIDENTIAL',
        redirectUris: [proxy.callbackUrl(REALM, SLUG)],
      })
      .expect(201);
    await admin('/proxy-applications')
      .send({
        slug: SLUG,
        name: 'Whoami',
        clientId: CLIENT_ID,
        allowedRedirectUris: [`https://${APP_HOST}/*`],
        cookieDomain: '.example.test',
      })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('signs a browser in through verify, start, login and callback, then verify passes the identity', async () => {
    const { browser, callback } = await signInUpToCallback();

    const back = await browser.get(callback);
    expect(back.status).toBe(302);
    expect(back.headers['location']).toBe(ORIGINAL);
    expect(browser.jar.has(PROXY_SESSION_COOKIE)).toBe(true);
    expect(browser.jar.has(PROXY_PKCE_COOKIE)).toBe(false);

    const allowed = await browser.get(verifyPath, traefikHeaders(ORIGINAL));
    expect(allowed.status).toBe(200);
    expect(allowed.headers['x-forwarded-user']).toBe('testuser');
    expect(allowed.headers['x-forwarded-email']).toBe('testuser@example.com');
  });

  it('answers nginx auth_request with 401 and the full sign-in URL, never a redirect', async () => {
    const res = await new Browser().get(verifyPath, {
      'X-Original-URL': ORIGINAL,
    });
    expect(res.status).toBe(401);
    // The query string of the original URL survives intact (`&page=2` would
    // be cut off if nginx had to build this URL itself).
    expect(res.headers[PROXY_LOGIN_HEADER.toLowerCase()]).toBe(
      proxy.startUrl(REALM, SLUG, ORIGINAL),
    );
    const rd = new URL(res.headers[PROXY_LOGIN_HEADER.toLowerCase()])
      .searchParams.get('rd');
    expect(rd).toBe(ORIGINAL);
  });

  it('answers a background request with 401, not a login page', async () => {
    const res = await request(app.getHttpServer())
      .get(verifyPath)
      .set({ Accept: 'application/json', ...traefikHeaders(ORIGINAL) });
    expect(res.status).toBe(401);
  });

  it('refuses a callback link opened in another browser, and leaves the code for the one that started', async () => {
    const { browser, callback } = await signInUpToCallback();

    // Same code and state, no PKCE verifier: e.g. a link an attacker got the
    // victim to open, carrying a code for the attacker's own account.
    const elsewhere = await new Browser().get(callback);
    expect(elsewhere.status).toBe(400);

    const back = await browser.get(callback);
    expect(back.status).toBe(302);
    expect(back.headers['location']).toBe(ORIGINAL);
  });

  it('still requires the client secret for the same code at the public token endpoint', async () => {
    const { callback } = await signInUpToCallback();
    const code = new URL(callback, 'http://placeholder').searchParams.get(
      'code',
    ) as string;

    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: proxy.callbackUrl(REALM, SLUG),
      });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('invalid_client');
  });
});
