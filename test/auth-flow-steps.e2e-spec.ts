import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  ACR,
  PASSWORD,
  REDIRECT_URI,
  TXN_COOKIE,
  authorizeUrl,
  bindRealm,
  codeFrom,
  createFlow,
  createUser,
  idTokenClaims,
  type Steps,
  withRuntimeEnv,
} from './helpers/auth-flow';
import { EmailService } from '../src/email/email.service.js';
import { RiskAssessmentService } from '../src/risk-assessment/risk-assessment.service.js';

/**
 * The email_otp, magic_link and social flow steps: an emailed code after a
 * password, a sign-in link that only works in the browser that asked for it,
 * and a federated sign-in (a mock identity provider) that comes back into
 * the login transaction.
 */
describe('Auth-flow email, link and social steps (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let userSeq = 0;
  const mail: Array<{ to: string; subject: string; html: string }> = [];

  const REALM = 'e2e-auth-flow-steps';
  const IDP = 'mockidp';
  const IDP_BASE = 'https://idp.example.test';

  const newUser = () =>
    createUser(ctx.prisma, seeded.realm.id, `steps-user-${++userSeq}`);

  const bind = async (name: string, steps: Steps) => {
    const flow = await createFlow(ctx.prisma, seeded.realm.id, name, steps);
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    return flow;
  };

  /** /auth → the first step's page. Returns that page. */
  const start = async (
    browser: Browser,
    params: Record<string, string> = {},
  ) => {
    const auth = await browser.get(authorizeUrl(REALM, params));
    expect(auth.status).toBe(302);
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    expect(browser.jar.has(TXN_COOKIE)).toBe(true);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    return page;
  };

  const postPassword = (browser: Browser, csrf: string, username: string) =>
    browser.post(`/realms/${REALM}/login`, {
      username,
      password: PASSWORD,
      _csrf: csrf,
    });

  /** The last email sent to `to`. */
  const lastMailTo = (to: string) => {
    const found = [...mail].reverse().find((m) => m.to === to);
    expect(found).toBeDefined();
    return found as (typeof mail)[number];
  };
  const codeIn = (html: string) => {
    const match = /letter-spacing:0\.3rem;">(\d+)</.exec(html);
    expect(match).not.toBeNull();
    return (match as RegExpExecArray)[1];
  };
  /** The sign-in link of an email, as a path on this server. */
  const linkIn = (html: string) => {
    // Handlebars escapes `=` and `&` in attribute values.
    const decoded = html.replaceAll('&#x3D;', '=').replaceAll('&amp;', '&');
    const match = /href="([^"]+\/login\/magic-link\?token=[^"]+)"/.exec(
      decoded,
    );
    expect(match).not.toBeNull();
    const url = new URL((match as RegExpExecArray)[1]);
    return `${url.pathname}${url.search}`;
  };

  beforeAll(async () => {
    restoreEnv = withRuntimeEnv('true');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      // Email is "configured" (an SMTP host); sending is captured below.
      data: { smtpHost: 'smtp.example.test', smtpFrom: 'idp@example.test' },
    });
    await ctx.prisma.identityProvider.create({
      data: {
        realmId: seeded.realm.id,
        alias: IDP,
        displayName: 'Mock IdP',
        clientId: 'idenplane',
        clientSecret: 'idp-secret',
        authorizationUrl: `${IDP_BASE}/authorize`,
        tokenUrl: `${IDP_BASE}/token`,
        userinfoUrl: `${IDP_BASE}/userinfo`,
        trustEmail: true,
      },
    });
  }, 30_000);

  beforeEach(() => {
    mail.length = 0;
    jest
      .spyOn(app.get(EmailService), 'sendEmail')
      .mockImplementation(async (_realm, to, subject, html) => {
        mail.push({ to, subject, html });
      });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    restoreEnv();
    restoreEnv = withRuntimeEnv('true');
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adaptiveAuthEnabled: false, passwordMaxAgeDays: 0 },
    });
  });

  afterAll(async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
    restoreEnv();
  });

  // ─── email_otp ─────────────────────────────────────────────────────────

  const PASSWORD_EMAIL_OTP: Steps = [
    { id: 'pw', type: 'password', required: true, order: 1 },
    { id: 'mail', type: 'email_otp', required: true, order: 2 },
  ];

  /** Password, then the email-code page and a sent code. */
  const toEmailCode = async (browser: Browser, username: string) => {
    const login = await start(browser);
    const pw = await postPassword(browser, csrfFrom(login.text), username);
    expect(pw.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('/login/email-otp/send');
    const sent = await browser.post(`/realms/${REALM}/login/email-otp/send`, {
      _csrf: csrfFrom(page.text),
    });
    expect(sent.status).toBe(302);
    const location = new URL(sent.headers['location'] as string, 'http://x');
    expect(location.pathname).toBe(`/realms/${REALM}/login`);
    expect(location.searchParams.get('info')).toMatch(
      /We sent a code to s•••@/,
    );
    const form = await browser.get(`/realms/${REALM}/login`);
    return csrfFrom(form.text);
  };

  const postEmailCode = (browser: Browser, csrf: string, code: string) =>
    browser.post(`/realms/${REALM}/login/email-otp`, { code, _csrf: csrf });

  it('email_otp after a password: a wrong code, then the emailed code gives MFA', async () => {
    await bind('pw-email-otp', PASSWORD_EMAIL_OTP);
    const user = await newUser();
    const browser = new Browser(app);

    const csrf = await toEmailCode(browser, user.username);
    const sent = lastMailTo(user.email as string);
    const code = codeIn(sent.html);
    expect(sent.subject).toBe('Your sign-in code');

    // Only a keyed hash of the code is stored.
    const row = await ctx.prisma.otpAttempt.findFirst({
      where: { userId: user.id, purpose: 'email_login' },
    });
    expect(row?.codeHash).toBeTruthy();
    expect(row?.codeHash).not.toContain(code);

    const wrong = await postEmailCode(
      browser,
      csrf,
      code === '000000' ? '111111' : '000000',
    );
    const wrongAt = new URL(wrong.headers['location'] as string, 'http://x');
    expect(wrongAt.pathname).toBe(`/realms/${REALM}/login`);
    expect(wrongAt.searchParams.get('error')).toBe(
      'Invalid code. Please try again.',
    );

    const page = await browser.get(`/realms/${REALM}/login`);
    const done = await postEmailCode(browser, csrfFrom(page.text), code);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(done.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.mfa);
    expect(claims['amr']).toEqual(['pwd', 'otp']);
    // Single use: the code is gone once it is accepted.
    expect(
      await ctx.prisma.otpAttempt.count({
        where: { userId: user.id, purpose: 'email_login' },
      }),
    ).toBe(0);
  });

  it('email_otp refuses an immediate resend and ends the sign-in after five wrong codes', async () => {
    await bind('pw-email-otp-limits', PASSWORD_EMAIL_OTP);
    const user = await newUser();
    const browser = new Browser(app);

    const csrf = await toEmailCode(browser, user.username);
    const code = codeIn(lastMailTo(user.email as string).html);
    const resend = await browser.post(`/realms/${REALM}/login/email-otp/send`, {
      _csrf: csrf,
    });
    expect(
      new URL(
        resend.headers['location'] as string,
        'http://x',
      ).searchParams.get('error'),
    ).toMatch(/Please wait 30 seconds/);
    expect(mail).toHaveLength(1);

    const wrongCode = code === '000000' ? '111111' : '000000';
    let last: request.Response | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await browser.get(`/realms/${REALM}/login`);
      last = await postEmailCode(browser, csrfFrom(page.text), wrongCode);
    }
    // The fifth wrong code locks the code: the login starts over at /auth.
    expect(last?.headers['location']).toContain(
      `/realms/${REALM}/protocol/openid-connect/auth?`,
    );
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
  });

  it('email_otp cannot be submitted without a sign-in in progress', async () => {
    await bind('pw-email-otp-none', PASSWORD_EMAIL_OTP);
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/forgot-password`);
    const res = await postEmailCode(browser, csrfFrom(page.text), '123456');
    expect(res.status).toBe(400);
    expect(res.text).toContain('no sign-in in progress');
  });

  // ─── magic_link ────────────────────────────────────────────────────────

  const LINK_ONLY: Steps = [
    { id: 'link', type: 'magic_link', required: true, order: 1 },
  ];

  /** Asks for a link on the magic-link page; returns the redirect. */
  const requestLink = async (browser: Browser, email: string) => {
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.text).toContain('/login/magic-link/send');
    return browser.post(`/realms/${REALM}/login/magic-link/send`, {
      email,
      _csrf: csrfFrom(page.text),
    });
  };

  it('a magic link identifies the user only in the browser that asked for it', async () => {
    await bind('link-only', LINK_ONLY);
    const user = await newUser();
    const browser = new Browser(app);
    await start(browser, { nonce: 'n-link' });

    const asked = await requestLink(
      browser,
      (user.email as string).toUpperCase(),
    );
    const askedAt = new URL(asked.headers['location'] as string, 'http://x');
    expect(askedAt.searchParams.get('info')).toMatch(
      /If an account with that address exists/,
    );
    const link = linkIn(lastMailTo(user.email as string).html);

    // Another browser (no transaction): refused, and nothing is used up.
    const other = await new Browser(app).get(link);
    expect(other.status).toBe(400);
    expect(other.text).toContain('works only in the browser');

    // Another browser with its own sign-in in progress: refused, and that
    // sign-in is untouched.
    const second = new Browser(app);
    await start(second);
    const secondTxn = second.jar.get(TXN_COOKIE);
    const crossed = await second.get(link);
    expect(crossed.status).toBe(400);
    expect(second.jar.get(TXN_COOKIE)).toBe(secondTxn);
    expect((await second.get(`/realms/${REALM}/login`)).status).toBe(200);

    // The browser that asked: signed in, at the password level.
    const opened = await browser.get(link);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(opened.headers['location']),
    );
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.password);
    expect(claims['amr']).toEqual(['otp']);
    expect(claims['nonce']).toBe('n-link');

    // Used once: the same link does nothing more.
    const replay = await browser.get(link);
    expect(replay.status).toBe(400);
    // The standalone verification API never accepts a flow link.
    const token = new URL(link, 'http://x').searchParams.get('token') as string;
    const api = await request(app.getHttpServer()).get(
      `/realms/${REALM}/protocol/openid-connect/magic-link/verify?token=${token}`,
    );
    expect((api.body as { valid?: boolean }).valid).not.toBe(true);
  });

  it('a magic link answers the same for an unknown address and sends nothing', async () => {
    await bind('link-unknown', LINK_ONLY);
    const browser = new Browser(app);
    await start(browser);

    const asked = await requestLink(browser, 'nobody@example.test');
    expect(
      new URL(asked.headers['location'] as string, 'http://x').searchParams.get(
        'info',
      ),
    ).toMatch(/If an account with that address exists/);
    expect(mail).toHaveLength(0);
  });

  it('a magic link stops working once a newer one is sent', async () => {
    await bind('link-replaced', LINK_ONLY);
    const user = await newUser();
    const browser = new Browser(app);
    await start(browser);

    await requestLink(browser, user.email as string);
    const first = linkIn(lastMailTo(user.email as string).html);
    // Let the resend cooldown pass.
    const txn = await ctx.prisma.pendingAction.findFirst({
      where: {
        type: 'authn_txn',
        data: { path: ['realmId'], equals: seeded.realm.id },
      },
      orderBy: { createdAt: 'desc' },
    });
    await ctx.prisma.pendingAction.update({
      where: { id: (txn as { id: string }).id },
      data: {
        data: {
          ...((txn as { data: object }).data as object),
          magicLinkSentAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    });
    await requestLink(browser, user.email as string);
    const second = linkIn(lastMailTo(user.email as string).html);
    expect(second).not.toBe(first);

    expect((await browser.get(first)).status).toBe(400);
    codeFrom((await browser.get(second)).headers['location']);
  });

  // ─── social ────────────────────────────────────────────────────────────

  /** The mock provider: its token and userinfo endpoints answer `who`. */
  const mockProvider = (who: Record<string, unknown>) => {
    const realFetch = global.fetch;
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === `${IDP_BASE}/token`) {
          return new Response(JSON.stringify({ access_token: 'at-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === `${IDP_BASE}/userinfo`) {
          return new Response(JSON.stringify(who), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return realFetch(input, init);
      });
  };

  /** From the login page to the provider; returns the broker state. */
  const toProvider = async (browser: Browser, page: request.Response) => {
    const button = new RegExp(
      `href="(/realms/${REALM}/broker/${IDP}/login)"`,
    ).exec(page.text);
    expect(button).not.toBeNull();
    const redirect = await browser.get((button as RegExpExecArray)[1]);
    expect(redirect.status).toBe(302);
    const url = new URL(redirect.headers['location'] as string);
    expect(`${url.origin}${url.pathname}`).toBe(`${IDP_BASE}/authorize`);
    return url.searchParams.get('state') as string;
  };

  const callback = (browser: Browser, state: string, code = 'idp-code') =>
    browser.get(
      `/realms/${REALM}/broker/${IDP}/callback?code=${code}&state=${encodeURIComponent(state)}`,
    );

  const SOCIAL_ONLY: Steps = [
    {
      id: 'social',
      type: 'social',
      required: true,
      order: 1,
      config: { providerAlias: IDP },
    },
  ];

  it('social inside a flow: the provider callback comes back into the transaction', async () => {
    await bind('social-only', SOCIAL_ONLY);
    const user = await newUser();
    mockProvider({
      sub: `ext-${user.id}`,
      email: user.email,
      email_verified: true,
    });
    const browser = new Browser(app);
    const page = await start(browser, {
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    });
    // Only this step's provider is offered, and no password form.
    expect(page.text).toContain('Sign in with Mock IdP');
    expect(page.text).not.toContain('name="password"');

    const state = await toProvider(browser, page);

    // The callback in another browser does not finish this sign-in.
    const elsewhere = await callback(new Browser(app), state);
    expect(elsewhere.status).toBe(403);

    const back = await callback(browser, state);
    const location = back.headers['location'] as string;
    const code = codeFrom(location);
    // The client's PKCE challenge was kept by the transaction.
    const token = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        code_verifier: 'dBjftJeZ4CVP-mJ92K9-wrong-verifier-000000000',
      });
    expect(token.status).toBe(400);

    // The state is single use: the same callback again finds nothing.
    const replay = await callback(browser, state);
    expect(replay.status).toBe(403);
  });

  it('social signs in at the password level with no methods, linked by a trusted email', async () => {
    await bind('social-acr', SOCIAL_ONLY);
    const user = await newUser();
    mockProvider({
      sub: `ext2-${user.id}`,
      email: user.email,
      email_verified: true,
    });
    const browser = new Browser(app);
    const state = await toProvider(browser, await start(browser));
    const back = await callback(browser, state);

    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(back.headers['location']),
    );
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.password);
    // The sign-in records no methods (the provider's are unknown), so the
    // token carries no amr rather than a false ['pwd'].
    expect(claims).not.toHaveProperty('amr');
    const session = await ctx.prisma.loginSession.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(session?.amr).toEqual([]);
    expect(
      await ctx.prisma.federatedIdentity.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('social after a password: an external account of no one fails the step, and creates nothing', async () => {
    await bind('pw-social', [
      { id: 'pw', type: 'password', required: true, order: 1 },
      {
        id: 'social',
        type: 'social',
        required: true,
        order: 2,
        config: { providerAlias: IDP },
      },
    ]);
    const user = await newUser();
    // The user has a link to the provider, so the step applies.
    await ctx.prisma.federatedIdentity.create({
      data: {
        userId: user.id,
        identityProviderId: (
          await ctx.prisma.identityProvider.findFirstOrThrow({
            where: { realmId: seeded.realm.id, alias: IDP },
          })
        ).id,
        externalUserId: `linked-${user.id}`,
      },
    });
    const usersBefore = await ctx.prisma.user.count({
      where: { realmId: seeded.realm.id },
    });
    mockProvider({
      sub: 'stranger',
      email: 'stranger@example.test',
      email_verified: true,
    });
    const browser = new Browser(app);
    const login = await start(browser);
    const pw = await postPassword(browser, csrfFrom(login.text), user.username);
    expect(pw.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);
    const state = await toProvider(browser, page);

    const back = await callback(browser, state);
    const at = new URL(back.headers['location'] as string, 'http://x');
    expect(at.pathname).toBe(`/realms/${REALM}/login`);
    expect(at.searchParams.get('error')).toMatch(/not linked to your account/);
    expect(
      await ctx.prisma.user.count({ where: { realmId: seeded.realm.id } }),
    ).toBe(usersBefore);

    // The right external account passes the step. A password and a
    // federated sign-in both identify; neither is a second factor.
    jest.restoreAllMocks();
    jest
      .spyOn(app.get(EmailService), 'sendEmail')
      .mockImplementation(async () => undefined);
    mockProvider({ sub: `linked-${user.id}` });
    const again = await toProvider(
      browser,
      await browser.get(`/realms/${REALM}/login`),
    );
    const done = await callback(browser, again);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(done.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.password);
    expect(claims['amr']).toEqual(['pwd']);
  });

  it('refuses to save a social step whose provider the realm does not have', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/realms/${REALM}/auth-flows`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        name: 'social-unknown',
        steps: [
          {
            id: 's',
            type: 'social',
            required: true,
            order: 1,
            config: { providerAlias: 'nope' },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('provider_not_found');
  });

  it('a binding whose provider was disabled fails closed', async () => {
    await bind('social-disabled', SOCIAL_ONLY);
    await ctx.prisma.identityProvider.update({
      where: { realmId_alias: { realmId: seeded.realm.id, alias: IDP } },
      data: { enabled: false },
    });
    try {
      const res = await new Browser(app).get(authorizeUrl(REALM));
      expect(res.status).toBe(503);
    } finally {
      await ctx.prisma.identityProvider.update({
        where: { realmId_alias: { realmId: seeded.realm.id, alias: IDP } },
        data: { enabled: true },
      });
    }
  });

  // ─── Account gates in a bound flow ─────────────────────────────────────

  it('a bound flow applies password expiry before a risk step-up, then starts again after the change', async () => {
    await bind('pw-gates', [
      { id: 'pw', type: 'password', required: true, order: 1 },
    ]);
    const user = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username: `steps-expired-${++userSeq}`,
        email: `steps-expired-${userSeq}@example.test`,
        emailVerified: true,
        enabled: true,
        passwordHash: await argon2.hash(PASSWORD),
      },
    });
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { adaptiveAuthEnabled: true, passwordMaxAgeDays: 30 },
    });
    jest
      .spyOn(app.get(RiskAssessmentService), 'assessRisk')
      .mockResolvedValue({ action: 'STEP_UP', riskScore: 70 } as never);
    jest
      .spyOn(app.get(RiskAssessmentService), 'updateUserProfile')
      .mockResolvedValue(undefined as never);
    const browser = new Browser(app);
    const login = await start(browser, { state: 'gates' });
    const pw = await postPassword(browser, csrfFrom(login.text), user.username);
    const location = pw.headers['location'] as string;
    expect(new URL(location, 'http://x').pathname).toBe(
      `/realms/${REALM}/change-password`,
    );

    const page = await browser.get(location);
    const changed = await browser.post(`/realms/${REALM}/change-password`, {
      token: new URL(location, 'http://x').searchParams.get('token') as string,
      currentPassword: PASSWORD,
      newPassword: 'NewPassword456!',
      confirmPassword: 'NewPassword456!',
      _csrf: csrfFrom(page.text),
    });
    // The built-in path may not finish a bound login: it starts again
    // through /auth with the original request.
    const restart = new URL(changed.headers['location'] as string, 'http://x');
    expect(restart.pathname).toBe(
      `/realms/${REALM}/protocol/openid-connect/auth`,
    );
    expect(restart.searchParams.get('state')).toBe('gates');
    expect(restart.searchParams.get('client_id')).toBe('test-client');
  });
});
