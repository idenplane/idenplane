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
import { RiskAssessmentService } from '../src/risk-assessment/risk-assessment.service.js';

/**
 * A fresh browser sign-in must honour the same policy as an SSO one: the
 * client's required ACR, prompt=consent, and the account gates even on the
 * risk step-up path. The SSO cookie must reach the provider from other sites,
 * and a passkey sign-in must use this browser's own challenge.
 */
describe('Login hardening (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-login-hardening';
  const REDIRECT_URI = 'http://localhost:3000/callback';
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
    readonly raw = new Map<string, string>();

    private header(): string {
      return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    private store(res: request.Response): request.Response {
      const cookies = res.headers['set-cookie'] as unknown as
        string[] | undefined;
      for (const cookie of cookies ?? []) {
        const [pair] = cookie.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = decodeURIComponent(pair.slice(eq + 1).trim());
        const cleared = !value || /expires=thu, 01 jan 1970/i.test(cookie);
        if (cleared) this.jar.delete(name);
        else {
          this.jar.set(name, value);
          this.raw.set(name, cookie);
        }
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

    async postJson(url: string, body: Record<string, unknown>) {
      return this.store(
        await request(app.getHttpServer())
          .post(url)
          .set('Cookie', this.header())
          .send(body),
      );
    }
  }

  const csrfFrom = (html: string) => {
    const match = /name="_csrf" value="([^"]+)"/.exec(html);
    if (!match) throw new Error('no CSRF token in page');
    return match[1];
  };

  /** Opens the login page as /auth would, then submits the form. */
  const signIn = async (
    browser: Browser,
    extra: Record<string, string> = {},
  ) => {
    const query = oauthQuery(extra);
    const page = await browser.get(
      `/realms/${REALM}/login?${new URLSearchParams(query).toString()}`,
    );
    expect(page.status).toBe(200);
    const form: Record<string, string> = {
      username: 'testuser',
      password: 'TestPassword123!',
      _csrf: csrfFrom(page.text),
    };
    // Exactly the hidden fields the page rendered, as a browser would send.
    for (const m of page.text.matchAll(
      /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
    )) {
      if (m[1] !== '_csrf') form[m[1]] = m[2].replaceAll('&amp;', '&');
    }
    return browser.post(`/realms/${REALM}/login`, form);
  };

  const setClient = (data: Record<string, unknown>) =>
    ctx.prisma.client.update({ where: { id: seeded.client.id }, data });

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

  afterEach(async () => {
    jest.restoreAllMocks();
    await setClient({ requiredAcr: null, requireConsent: false });
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adaptiveAuthEnabled: false, requireEmailVerification: false },
    });
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('sets the SSO cookie SameSite=Lax so other sites reach the session', async () => {
    const browser = new Browser();
    const res = await signIn(browser);

    expect(res.status).toBe(302);
    expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/SameSite=Lax/i);
  });

  it('enrols MFA before issuing a code to a client that requires it', async () => {
    await setClient({ requiredAcr: 'urn:idenplane:acr:mfa' });

    const res = await signIn(new Browser());

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(
      `/realms/${REALM}/account/totp-setup`,
    );
    expect(res.headers['location']).not.toContain('code=');
  });

  it('refuses a password sign-in for a client that requires a passkey', async () => {
    await setClient({ requiredAcr: 'urn:idenplane:acr:webauthn' });

    const res = await signIn(new Browser());

    const url = new URL(res.headers['location'] as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('code')).toBeNull();
    expect(url.searchParams.get('state')).toBe('xyz');
  });

  it('asks for consent on a fresh sign-in with prompt=consent', async () => {
    const res = await signIn(new Browser(), { prompt: 'consent' });

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(`/realms/${REALM}/consent?req=`);
  });

  it('applies email verification before a risk step-up', async () => {
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adaptiveAuthEnabled: true, requireEmailVerification: true },
    });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { emailVerified: false },
    });
    jest.spyOn(app.get(RiskAssessmentService), 'assessRisk').mockResolvedValue({
      action: 'STEP_UP',
      riskScore: 70,
    } as never);

    const res = await signIn(new Browser());

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(`/realms/${REALM}/login?`);
    const location = new URL(res.headers['location'] as string, 'http://x');
    expect(location.searchParams.get('error')).toMatch(/verify your email/i);
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { emailVerified: true },
    });
  });

  it('binds a passkey sign-in challenge to the browser that asked for it', async () => {
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { webAuthnEnabled: true },
    });
    const browser = new Browser();
    const options = await browser.postJson(
      `/realms/${REALM}/webauthn/authenticate/options`,
      {},
    );
    expect(options.status).toBe(200);
    expect(browser.raw.get('IDENPLANE_WEBAUTHN_LOGIN')).toMatch(/HttpOnly/i);

    // Another browser has no handle, so it cannot use (or consume) it.
    const other = await new Browser().postJson(
      `/realms/${REALM}/webauthn/authenticate/verify`,
      { response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } },
    );
    expect(other.status).toBe(400);
  });
});
