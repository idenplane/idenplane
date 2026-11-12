import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { registerHandlebarsHelpers } from '../src/theme/handlebars-helpers.js';
import {
  createThemeViewEngine,
  type ThemeViewEngine,
} from '../src/theme/theme-view-engine.js';

/**
 * Behaviour the OpenID conformance suite (oidcc-basic) checks, driven through
 * the real browser flow: POST to the authorization and UserInfo endpoints,
 * request objects, max_age with auth_time, offline_access and code replay.
 */
describe('OIDC conformance behaviour (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-oidc-conformance';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const SECRET = 'test-client-secret';
  const base = `/realms/${REALM}/protocol/openid-connect`;
  const oauthQuery = (extra: Record<string, string> = {}) => ({
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
    ...extra,
  });

  /** Auth cookies are `Secure`; track them by hand, as a browser would. */
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

    async get(url: string) {
      return this.store(
        await request(app.getHttpServer())
          .get(url)
          .set('Cookie', this.header()),
      );
    }

    async post(url: string, form: Record<string, string>) {
      return this.store(
        await request(app.getHttpServer())
          .post(url)
          .set('Cookie', this.header())
          .type('form')
          .send(form),
      );
    }
  }

  const csrfFrom = (html: string) => {
    const match = /name="_csrf" value="([^"]+)"/.exec(html);
    if (!match) throw new Error('no CSRF token in page');
    return match[1];
  };

  const redirectParams = (res: request.Response) => {
    expect(res.status).toBe(302);
    const url = new URL(res.headers['location'] as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    return url.searchParams;
  };

  /** Signs in through the login form and returns the authorization code. */
  const signIn = async (
    browser: Browser,
    extra: Record<string, string> = {},
  ) => {
    const query = oauthQuery(extra);
    const page = await browser.get(
      `/realms/${REALM}/login?${new URLSearchParams(query).toString()}`,
    );
    expect(page.status).toBe(200);
    const res = await browser.post(`/realms/${REALM}/login`, {
      ...query,
      username: 'testuser',
      password: 'TestPassword123!',
      _csrf: csrfFrom(page.text),
    });
    const code = redirectParams(res).get('code');
    expect(code).toBeTruthy();
    return code as string;
  };

  const exchange = (code: string) =>
    request(app.getHttpServer()).post(`${base}/token`).type('form').send({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: 'test-client',
      client_secret: SECRET,
    });

  const claims = (jwt: string) =>
    JSON.parse(
      Buffer.from(jwt.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;

  const introspect = (token: string) =>
    request(app.getHttpServer())
      .post(`${base}/token/introspect`)
      .type('form')
      .send({ token, client_id: 'test-client', client_secret: SECRET });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const express = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: string) => void;
      engine: (extension: string, engine: ThemeViewEngine) => void;
    };
    express.set('views', join(process.cwd(), 'themes'));
    express.engine('hbs', createThemeViewEngine(join(process.cwd(), 'themes')));
    express.set('view engine', 'hbs');
    registerHandlebarsHelpers();
    seeded = await ctx.seedTestRealm(REALM);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('serves UserInfo over POST with the token in the header or the body', async () => {
    const tokens = await exchange(await signIn(new Browser())).expect(200);
    const accessToken = tokens.body.access_token as string;

    const header = await request(app.getHttpServer())
      .post(`${base}/userinfo`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(header.body.sub).toBe(seeded.user.id);

    const body = await request(app.getHttpServer())
      .post(`${base}/userinfo`)
      .type('form')
      .send({ access_token: accessToken })
      .expect(200);
    expect(body.body.sub).toBe(seeded.user.id);

    await request(app.getHttpServer())
      .post(`${base}/userinfo`)
      .set('Authorization', `Bearer ${accessToken}`)
      .type('form')
      .send({ access_token: accessToken })
      .expect(400);
  });

  it('keeps the original auth_time in ID tokens issued by a refresh', async () => {
    const first = await exchange(await signIn(new Browser())).expect(200);
    const signedInAt = claims(first.body.id_token as string)['auth_time'];
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const refreshed = await request(app.getHttpServer())
      .post(`${base}/token`)
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: first.body.refresh_token as string,
        client_id: 'test-client',
        client_secret: SECRET,
      })
      .expect(200);

    expect(claims(refreshed.body.id_token as string)['auth_time']).toBe(
      signedInAt,
    );
  });

  it('accepts the authorization request as a form POST', async () => {
    const browser = new Browser();
    await signIn(browser);

    const res = await browser.post(`${base}/auth`, oauthQuery());

    expect(redirectParams(res).get('code')).toBeTruthy();
  });

  it('rejects request objects instead of ignoring them', async () => {
    const browser = new Browser();
    await signIn(browser);

    const params = redirectParams(
      await browser.get(
        `${base}/auth?${new URLSearchParams(oauthQuery({ request: 'eyJhbGciOiJub25lIn0.e30.' })).toString()}`,
      ),
    );

    expect(params.get('error')).toBe('request_not_supported');
    expect(params.get('state')).toBe('xyz');
  });

  it('reports the real sign-in time as auth_time and honours max_age', async () => {
    const browser = new Browser();
    const first = await exchange(await signIn(browser)).expect(200);
    const authTime = claims(first.body.id_token as string)['auth_time'];

    // An SSO code later still carries the original sign-in time.
    await ctx.prisma.loginSession.updateMany({
      where: { userId: seeded.user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const sso = redirectParams(
      await browser.get(
        `${base}/auth?${new URLSearchParams(oauthQuery()).toString()}`,
      ),
    );
    const second = await exchange(sso.get('code') as string).expect(200);
    expect(claims(second.body.id_token as string)['auth_time']).toBeLessThan(
      Math.floor(Date.now() / 1000) - 60,
    );
    expect(typeof authTime).toBe('number');

    // max_age shorter than the session's age forces a new sign-in...
    const stale = await browser.get(
      `${base}/auth?${new URLSearchParams(oauthQuery({ max_age: '60' })).toString()}`,
    );
    expect(stale.status).toBe(302);
    expect(stale.headers['location']).toContain(`/realms/${REALM}/login`);

    // ...and cannot be satisfied silently.
    const silent = redirectParams(
      await browser.get(
        `${base}/auth?${new URLSearchParams(oauthQuery({ max_age: '60', prompt: 'none' })).toString()}`,
      ),
    );
    expect(silent.get('error')).toBe('login_required');
  });

  it('grants offline_access only to a code flow of a client that has the scope', async () => {
    // Without the scope assigned, the request is honoured without offline access.
    const plain = await exchange(
      await signIn(new Browser(), { scope: 'openid offline_access' }),
    ).expect(200);
    expect(String(plain.body.scope).split(' ')).not.toContain('offline_access');

    const scope = await ctx.prisma.clientScope.upsert({
      where: {
        realmId_name: { realmId: seeded.realm.id, name: 'offline_access' },
      },
      update: {},
      create: { realmId: seeded.realm.id, name: 'offline_access' },
    });
    await ctx.prisma.clientOptionalScope.create({
      data: { clientId: seeded.client.id, clientScopeId: scope.id },
    });

    const offline = await exchange(
      await signIn(new Browser(), { scope: 'openid offline_access' }),
    ).expect(200);
    expect(String(offline.body.scope).split(' ')).toContain('offline_access');
    const stored = await ctx.prisma.refreshToken.findFirst({
      where: { session: { userId: seeded.user.id }, isOffline: true },
    });
    expect(stored).not.toBeNull();

    // The password grant never returns a code, so it never gets offline access.
    const password = await request(app.getHttpServer())
      .post(`${base}/token`)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: SECRET,
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid offline_access',
      })
      .expect(200);
    expect(String(password.body.scope).split(' ')).not.toContain(
      'offline_access',
    );
  });

  it('revokes the tokens issued from a code when the code is replayed', async () => {
    const code = await signIn(new Browser());
    const first = await exchange(code).expect(200);
    await introspect(first.body.access_token as string).expect((res) =>
      expect(res.body.active).toBe(true),
    );

    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');

    const after = await introspect(first.body.access_token as string);
    expect(after.body.active).toBe(false);
    await request(app.getHttpServer())
      .post(`${base}/token`)
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: first.body.refresh_token as string,
        client_id: 'test-client',
        client_secret: SECRET,
      })
      .expect(400);
  });
});
