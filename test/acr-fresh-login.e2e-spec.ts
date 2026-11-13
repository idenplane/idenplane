import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  ACR,
  PASSWORD,
  PASSWORD_ONLY,
  REDIRECT_URI,
  authorizeUrl,
  bindRealm,
  codeFrom,
  createFlow,
  createUser,
  enrolTotp,
  idTokenClaims,
  withRuntimeEnv,
} from './helpers/auth-flow';

const ENFORCE = 'ENFORCE_ACR_ON_FRESH_LOGIN';
const essential = (...values: string[]) =>
  JSON.stringify({ id_token: { acr: { essential: true, values } } });

/**
 * ENFORCE_ACR_ON_FRESH_LOGIN: off by default (a fresh sign-in ignores what
 * the request asks of acr); on, the login form carries acr_values and
 * claims, and an essential acr the sign-in cannot meet ends with
 * unmet_authentication_requirements instead of a weaker code.
 */
describe('ENFORCE_ACR_ON_FRESH_LOGIN (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let userSeq = 0;
  const previous = process.env[ENFORCE];

  const REALM = 'e2e-acr-fresh-login';

  const setFlag = (value: string | undefined) => {
    if (value === undefined) delete process.env[ENFORCE];
    else process.env[ENFORCE] = value;
  };

  /** /auth → the login page → the form, with the hidden fields it renders. */
  const signIn = async (
    browser: Browser,
    username: string,
    params: Record<string, string>,
  ) => {
    const auth = await browser.get(authorizeUrl(REALM, params));
    expect(auth.status).toBe(302);
    const page = await browser.get(auth.headers['location'] as string);
    expect(page.status).toBe(200);
    const form: Record<string, string> = {
      username,
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    };
    for (const m of page.text.matchAll(
      /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
    )) {
      if (m[1] !== '_csrf') {
        form[m[1]] = m[2]
          .replaceAll('&quot;', '"')
          .replaceAll('&#x3D;', '=')
          .replaceAll('&amp;', '&');
      }
    }
    return { page, res: await browser.post(`/realms/${REALM}/login`, form) };
  };

  const errorOf = (location: string | undefined) => {
    const url = new URL(location as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code')).toBeNull();
    expect(url.searchParams.get('state')).toBe('xyz');
    return url.searchParams.get('error');
  };

  const newUser = () =>
    createUser(ctx.prisma, seeded.realm.id, `acr-user-${++userSeq}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.identityProvider.create({
      data: {
        realmId: seeded.realm.id,
        alias: 'mockidp',
        displayName: 'Mock IdP',
        clientId: 'idenplane',
        clientSecret: 'idp-secret',
        authorizationUrl: 'https://idp.example.test/authorize',
        tokenUrl: 'https://idp.example.test/token',
        userinfoUrl: 'https://idp.example.test/userinfo',
        trustEmail: true,
      },
    });
  }, 30_000);

  afterEach(() => {
    jest.restoreAllMocks();
    setFlag(previous);
  });

  afterAll(async () => {
    setFlag(previous);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('off (default): an essential acr does not change a fresh sign-in', async () => {
    setFlag(undefined);
    const user = await newUser();
    const { page, res } = await signIn(new Browser(app), user.username, {
      claims: essential(ACR.webauthn),
      acr_values: ACR.mfa,
    });
    expect(page.text).not.toContain('name="acr_values"');
    expect(page.text).not.toContain('name="claims"');
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.password);
  });

  it('on: an essential passkey level ends a password sign-in with unmet_authentication_requirements', async () => {
    setFlag('true');
    const user = await newUser();
    const { page, res } = await signIn(new Browser(app), user.username, {
      claims: essential(ACR.webauthn),
    });
    expect(page.text).toContain('name="claims"');
    expect(errorOf(res.headers['location'])).toBe(
      'unmet_authentication_requirements',
    );
  });

  it('on: an essential acr no level here knows cannot be met', async () => {
    setFlag('true');
    const user = await newUser();
    const { res } = await signIn(new Browser(app), user.username, {
      claims: essential('urn:example:gold'),
    });
    expect(errorOf(res.headers['location'])).toBe(
      'unmet_authentication_requirements',
    );
  });

  it('on: an essential MFA level asks a TOTP user for the code, then issues MFA', async () => {
    setFlag('true');
    const user = await newUser();
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );
    const browser = new Browser(app);
    const { res } = await signIn(browser, user.username, {
      claims: essential(ACR.mfa),
    });
    expect(res.headers['location']).toBe(`/realms/${REALM}/totp`);
    const page = await browser.get(`/realms/${REALM}/totp`);
    const answered = await browser.post(`/realms/${REALM}/totp`, {
      code: await totp.code(),
      _csrf: csrfFrom(page.text),
    });
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(answered.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.mfa);
  });

  it('on: an essential MFA level makes a user without a second factor enrol first', async () => {
    setFlag('true');
    const user = await newUser();
    const { res } = await signIn(new Browser(app), user.username, {
      claims: essential(ACR.mfa),
    });
    expect(res.headers['location']).toContain(
      `/realms/${REALM}/account/totp-setup`,
    );
  });

  it('on: acr_values stays voluntary (a password-level code)', async () => {
    setFlag('true');
    const user = await newUser();
    const { page, res } = await signIn(new Browser(app), user.username, {
      acr_values: ACR.webauthn,
    });
    expect(page.text).toContain(`name="acr_values" value="${ACR.webauthn}"`);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.password);
  });

  it('on: a password session cannot silently answer an essential MFA request', async () => {
    setFlag('true');
    const user = await newUser();
    const browser = new Browser(app);
    codeFrom(
      (await signIn(browser, user.username, {})).res.headers['location'],
    );

    const silent = await browser.get(
      authorizeUrl(REALM, { prompt: 'none', claims: essential(ACR.mfa) }),
    );
    expect(errorOf(silent.headers['location'])).toBe('interaction_required');
  });

  it('on: a bound flow ends with unmet_authentication_requirements too', async () => {
    setFlag('true');
    const restore = withRuntimeEnv('true');
    try {
      const flow = await createFlow(
        ctx.prisma,
        seeded.realm.id,
        'acr-pw-only',
        PASSWORD_ONLY,
      );
      await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
      const user = await newUser();
      const browser = new Browser(app);
      const auth = await browser.get(
        authorizeUrl(REALM, { claims: essential(ACR.webauthn) }),
      );
      expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
      const page = await browser.get(`/realms/${REALM}/login`);
      const res = await browser.post(`/realms/${REALM}/login`, {
        username: user.username,
        password: PASSWORD,
        _csrf: csrfFrom(page.text),
      });
      expect(errorOf(res.headers['location'])).toBe(
        'unmet_authentication_requirements',
      );
    } finally {
      await bindRealm(ctx.prisma, seeded.realm.id, null, false);
      restore();
    }
  });

  it('on: a federated sign-in is held to an essential acr too', async () => {
    setFlag('true');
    const user = await newUser();
    const realFetch = global.fetch;
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://idp.example.test/token') {
        return new Response(JSON.stringify({ access_token: 'at' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'https://idp.example.test/userinfo') {
        return new Response(
          JSON.stringify({
            sub: `ext-${user.id}`,
            email: user.email,
            email_verified: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return realFetch(input, init);
    });
    const browser = new Browser(app);
    const auth = await browser.get(
      authorizeUrl(REALM, { claims: essential(ACR.webauthn) }),
    );
    const page = await browser.get(auth.headers['location'] as string);
    const button = /href="(\/realms\/[^"]+\/broker\/mockidp\/login[^"]*)"/.exec(
      page.text,
    );
    expect(button).not.toBeNull();
    const href = (button as RegExpExecArray)[1]
      .replaceAll('&amp;', '&')
      .replaceAll('&#x3D;', '=');
    expect(href).toContain('claims=');
    const toIdp = await browser.get(href);
    const state = new URL(toIdp.headers['location'] as string).searchParams.get(
      'state',
    ) as string;

    const back = await browser.get(
      `/realms/${REALM}/broker/mockidp/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    expect(errorOf(back.headers['location'])).toBe(
      'unmet_authentication_requirements',
    );
  });
});
