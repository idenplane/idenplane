import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  SoftAuthenticator,
  expectedOrigin,
  type RequestOptions,
} from './helpers/soft-authenticator';
const NOTICE_COOKIE = 'IDENPLANE_LOGIN_NOTICE';

import {
  ACR,
  PASSKEY_OR_PASSWORD,
  PASSWORD,
  PASSWORD_ONLY,
  PASSWORD_TOTP,
  TXN_COOKIE,
  authorizeUrl,
  bindRealm,
  codeFrom,
  createClient,
  createFlow,
  createUser,
  enrolTotp,
  idTokenClaims,
  registerPasskey,
  withRuntimeEnv,
} from './helpers/auth-flow';

/**
 * The custom auth-flow runtime, happy paths: a bound flow drives the hosted
 * login pages from `/auth` to the authorization code.
 */
describe('Auth-flow runtime (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let userSeq = 0;

  const REALM = 'e2e-auth-flow-runtime';
  const RP_ID = 'localhost';

  /** /auth → the first step's login page. Returns the page's CSRF token. */
  const start = async (
    browser: Browser,
    params: Record<string, string> = {},
  ): Promise<string> => {
    const auth = await browser.get(authorizeUrl(REALM, params));
    expect(auth.status).toBe(302);
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    expect(browser.jar.has(TXN_COOKIE)).toBe(true);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    return csrfFrom(page.text);
  };

  const postPassword = (
    browser: Browser,
    csrf: string,
    username: string,
    extra: Record<string, string> = {},
  ) =>
    browser.post(`/realms/${REALM}/login`, {
      username,
      password: PASSWORD,
      _csrf: csrf,
      ...extra,
    });

  const postTotp = async (browser: Browser, code: string) => {
    const page = await browser.get(`/realms/${REALM}/totp`);
    expect(page.status).toBe(200);
    return browser.post(`/realms/${REALM}/totp`, {
      code,
      _csrf: csrfFrom(page.text),
    });
  };

  const newUser = () =>
    createUser(ctx.prisma, seeded.realm.id, `flow-user-${++userSeq}`);

  beforeAll(async () => {
    restoreEnv = withRuntimeEnv('true');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { webAuthnEnabled: true, eventsEnabled: true },
    });
  }, 30_000);

  /** Events are recorded in the background: wait for one to appear. */
  const eventOf = async (userId: string, type: string) => {
    for (let i = 0; i < 50; i++) {
      const event = await ctx.prisma.loginEvent.findFirst({
        where: { userId, type },
      });
      if (event) return event;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  afterEach(async () => {
    restoreEnv();
    restoreEnv = withRuntimeEnv('true');
    await ctx.prisma.client.updateMany({
      where: { realmId: seeded.realm.id },
      data: { authFlowId: null },
    });
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
  });

  afterAll(async () => {
    await ctx.prisma.client.updateMany({
      where: { realmId: seeded.realm.id },
      data: { authFlowId: null },
    });
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
    restoreEnv();
  });

  it('realm-bound password-only: /auth → password → code at the password level', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'pw-only',
      PASSWORD_ONLY,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();

    const browser = new Browser(app);
    const csrf = await start(browser);
    const res = await postPassword(browser, csrf, user.username, {
      rememberMe: 'true',
    });
    expect(res.status).toBe(302);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.password);
    expect(claims['amr']).toEqual(['pwd']);
    expect(claims['nonce']).toBe('n-1');

    // The transaction is gone; the session exists, remembered.
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
    expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/Max-Age/i);
    const rows = await ctx.prisma.pendingAction.count({
      where: { type: 'authn_txn', data: { path: ['userId'], equals: user.id } },
    });
    expect(rows).toBe(0);

    // The login event is recorded as for the built-in login.
    expect(await eventOf(user.id, 'LOGIN')).toBeTruthy();
  });

  it('password → totp: rotates the transaction cookie and issues an MFA code', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'pw-totp',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );

    const browser = new Browser(app);
    const csrf = await start(browser);
    const before = browser.jar.get(TXN_COOKIE);
    const afterPassword = await postPassword(browser, csrf, user.username);
    expect(afterPassword.status).toBe(302);
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    expect(browser.jar.get(TXN_COOKIE)).toBeTruthy();
    expect(browser.jar.get(TXN_COOKIE)).not.toBe(before);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);

    const res = await postTotp(browser, await totp.code());
    expect(res.status).toBe(302);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.mfa);
    expect(claims['amr']).toEqual(['pwd', 'otp']);

    expect(await eventOf(user.id, 'MFA_VERIFY')).toBeTruthy();
    expect(await eventOf(user.id, 'LOGIN')).toBeTruthy();
  });

  it('password-only flow still asks an enrolled user for the second factor (never weaker than legacy)', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'pw-only-2',
      PASSWORD_ONLY,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );

    const browser = new Browser(app);
    const afterPassword = await postPassword(
      browser,
      await start(browser),
      user.username,
    );
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    const res = await postTotp(browser, await totp.code());
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.mfa);
  });

  describe('webauthn first, password fallback', () => {
    let user: { id: string; username: string };
    let authenticator: SoftAuthenticator;

    beforeEach(async () => {
      const flow = await createFlow(
        ctx.prisma,
        seeded.realm.id,
        `pk-pw-${userSeq + 1}`,
        PASSKEY_OR_PASSWORD,
      );
      await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
      user = await newUser();
      authenticator = new SoftAuthenticator(RP_ID, expectedOrigin(RP_ID));
      await registerPasskey(
        ctx.prisma,
        user.id,
        seeded.realm.id,
        authenticator,
      );
    });

    const passkeyVerify = async (browser: Browser, key: SoftAuthenticator) => {
      const options = await browser.postJson(
        `/realms/${REALM}/webauthn/authenticate/options`,
        {},
      );
      expect(options.status).toBe(200);
      return browser.postJson(`/realms/${REALM}/webauthn/authenticate/verify`, {
        response: key.assert(options.body as RequestOptions),
        // Ignored: the transaction holds the OAuth request.
        client_id: 'someone-else',
      });
    };

    it('signs in with the passkey at the WebAuthn level', async () => {
      const browser = new Browser(app);
      const page = await browser
        .get(authorizeUrl(REALM))
        .then(() => browser.get(`/realms/${REALM}/login`));
      expect(page.text).toContain('passkey-login-btn');
      const res = await passkeyVerify(browser, authenticator);
      expect(res.status).toBe(200);
      const { redirectUrl } = res.body as { redirectUrl: string };
      const claims = await idTokenClaims(app, REALM, codeFrom(redirectUrl));
      expect(claims['sub']).toBe(user.id);
      expect(claims['acr']).toBe(ACR.webauthn);
      expect(claims['amr']).toEqual(['hwk']);
    });

    it('falls back to the password after a failed passkey', async () => {
      const browser = new Browser(app);
      await start(browser);
      const stranger = new SoftAuthenticator(RP_ID, expectedOrigin(RP_ID));
      const failed = await passkeyVerify(browser, stranger);
      expect(failed.status).toBe(200);
      expect((failed.body as { redirectUrl: string }).redirectUrl).toMatch(
        new RegExp(`^/realms/${REALM}/login\\?error=`),
      );

      const page = await browser.get(`/realms/${REALM}/login`);
      expect(page.status).toBe(200);
      const res = await postPassword(
        browser,
        csrfFrom(page.text),
        user.username,
      );
      const claims = await idTokenClaims(
        app,
        REALM,
        codeFrom(res.headers['location']),
      );
      expect(claims['acr']).toBe(ACR.password);
      expect(claims['amr']).toEqual(['pwd']);
    });

    it('takes the password fallback when the user declines the passkey', async () => {
      const browser = new Browser(app);
      const csrf = await start(browser);
      const res = await postPassword(browser, csrf, user.username);
      const claims = await idTokenClaims(
        app,
        REALM,
        codeFrom(res.headers['location']),
      );
      expect(claims['sub']).toBe(user.id);
      expect(claims['acr']).toBe(ACR.password);
    });
  });

  it('a client override beats the realm flow', async () => {
    const realmFlow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'realm-pw',
      PASSWORD_ONLY,
    );
    const clientFlow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'client-mfa',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, realmFlow.id);
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data: { authFlowId: clientFlow.id },
    });
    const other = await createClient(
      ctx.prisma,
      seeded.realm.id,
      `plain-${userSeq}`,
    );
    const user = await newUser();
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );

    // The overridden client runs its own flow: password then TOTP.
    const a = new Browser(app);
    const afterPassword = await postPassword(a, await start(a), user.username);
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    const done = await postTotp(a, await totp.code());
    expect(
      (await idTokenClaims(app, REALM, codeFrom(done.headers['location'])))[
        'acr'
      ],
    ).toBe(ACR.mfa);

    // A client without an override runs the realm flow (password only).
    const plainUser = await newUser();
    const b = new Browser(app);
    const csrf = await start(b, { client_id: other.clientId });
    const res = await postPassword(b, csrf, plainUser.username);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
      other.clientId,
    );
    expect(claims['acr']).toBe(ACR.password);
  });

  it('a misconfigured binding fails closed with a 503 page, never the built-in login', async () => {
    const broken = await createFlow(ctx.prisma, seeded.realm.id, 'broken', [
      { id: 'otp', type: 'totp', required: true, order: 1 },
    ]);
    await bindRealm(ctx.prisma, seeded.realm.id, broken.id);

    const browser = new Browser(app);
    const auth = await browser.get(authorizeUrl(REALM));
    expect(auth.status).toBe(503);
    expect(auth.text).toContain('not configured correctly');
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);

    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(503);

    // A built-in login form post (valid CSRF) is refused too.
    const forgot = await browser.get(`/realms/${REALM}/forgot-password`);
    const legacy = await browser.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: PASSWORD,
      client_id: 'test-client',
      redirect_uri: 'http://localhost:3000/callback',
      response_type: 'code',
      state: 'xyz',
      _csrf: csrfFrom(forgot.text),
    });
    expect(legacy.status).toBe(503);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('runtime switched off: the built-in login runs, whatever is bound', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'ignored',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    restoreEnv();
    restoreEnv = withRuntimeEnv(undefined);

    const browser = new Browser(app);
    const auth = await browser.get(authorizeUrl(REALM));
    expect(auth.status).toBe(302);
    expect(auth.headers['location']).toMatch(
      new RegExp(`^/realms/${REALM}/login\\?client_id=test-client`),
    );
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
    const page = await browser.get(auth.headers['location'] as string);
    const res = await browser.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
      client_id: 'test-client',
      redirect_uri: 'http://localhost:3000/callback',
      response_type: 'code',
      scope: 'openid',
      state: 'xyz',
    });
    // The bound TOTP step does not apply: password only, straight to a code.
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(res.headers['location']),
    );
    expect(claims['acr']).toBe(ACR.password);
  });

  it('a flow version change mid-login restarts the login on the new version', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'changing',
      PASSWORD_ONLY,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();

    const browser = new Browser(app);
    const csrf = await start(browser);
    const oldTxn = browser.jar.get(TXN_COOKIE);

    // An admin edits the flow while the user is on the login page.
    await request(app.getHttpServer())
      .put(`/admin/realms/${REALM}/auth-flows/${flow.id}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ steps: PASSWORD_TOTP })
      .expect(200);

    const res = await postPassword(browser, csrf, user.username);
    expect(res.status).toBe(302);
    // The restart goes back through /auth, rebuilt from the stored request.
    const restart = res.headers['location'] as string;
    expect(restart).toMatch(
      new RegExp(`^/realms/${REALM}/protocol/openid-connect/auth\\?`),
    );
    expect(restart).toContain('client_id=test-client');
    expect(restart).toContain('state=xyz');
    expect(browser.jar.get(NOTICE_COOKIE)).toBe('flow_changed');
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);

    // /auth starts a new transaction pinned to the new version.
    const auth = await browser.get(restart);
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('The sign-in steps changed');
    expect(browser.jar.get(TXN_COOKIE)).not.toBe(oldTxn);
    const again = await postPassword(
      browser,
      csrfFrom(page.text),
      user.username,
    );
    // Version 2 requires TOTP the user has not set up: the enrolment detour.
    expect(again.headers['location']).toMatch(
      new RegExp(`^/realms/${REALM}/account/totp-setup`),
    );
  });

  /** Password, then the TOTP setup page, up to the "Continue" form. */
  const enrolDetour = async (browser: Browser, username: string) => {
    const afterPassword = await postPassword(
      browser,
      await start(browser),
      username,
    );
    expect(afterPassword.headers['location']).toMatch(
      new RegExp(`^/realms/${REALM}/account/totp-setup`),
    );
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
    const setupPage = await browser.get(`/realms/${REALM}/account/totp-setup`);
    expect(setupPage.status).toBe(200);
    const secret = /<code[^>]*>([A-Z2-7]+)<\/code>/.exec(setupPage.text)?.[1];
    expect(secret).toBeTruthy();
    const OTPAuth = await import('otpauth');
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret as string),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const activated = await browser.post(
      `/realms/${REALM}/account/totp-setup`,
      {
        code: totp.generate(),
        _csrf: csrfFrom(setupPage.text),
      },
    );
    expect(activated.text).toContain(
      `action="/realms/${REALM}/mfa-enrollment/continue"`,
    );
    return csrfFrom(activated.text);
  };

  it('a required totp step sends a user without a factor through enrolment, then resumes the flow', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'enrol',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();

    const browser = new Browser(app);
    const csrf = await enrolDetour(browser, user.username);
    const done = await browser.post(
      `/realms/${REALM}/mfa-enrollment/continue`,
      {
        _csrf: csrf,
      },
    );
    expect(done.status).toBe(302);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(done.headers['location']),
    );
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.mfa);
    expect(claims['amr']).toEqual(['pwd', 'otp']);
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
    expect(browser.jar.has('IDENPLANE_MFA_ENROLLMENT')).toBe(false);
  });

  it('the enrolment detour only resumes in the browser that holds the transaction', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'enrol-2',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();

    const browser = new Browser(app);
    const csrf = await enrolDetour(browser, user.username);
    const thief = new Browser(app);
    for (const [k, v] of browser.jar) {
      if (k !== TXN_COOKIE) thief.jar.set(k, v);
    }
    const stolen = await thief.post(
      `/realms/${REALM}/mfa-enrollment/continue`,
      {
        _csrf: csrf,
      },
    );
    expect(stolen.status).toBe(302);
    expect(String(stolen.headers['location'])).not.toMatch(/code=/);
    expect(thief.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('a restart goes through /auth: an SSO session that meets the new flow is used', async () => {
    // test-client runs the realm's password flow; `other` is bound to
    // password → TOTP, so the password session alone does not serve it.
    const realmFlow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'rs-realm',
      PASSWORD_ONLY,
    );
    const strong = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'rs-strong',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, realmFlow.id);
    const other = await createClient(
      ctx.prisma,
      seeded.realm.id,
      `rs-${userSeq}`,
      {
        authFlowId: strong.id,
      },
    );
    const user = await newUser();
    const browser = new Browser(app);
    codeFrom(
      (await postPassword(browser, await start(browser), user.username))
        .headers['location'],
    );

    // The session is too weak for `other`: a new sign-in through its flow.
    const auth = await browser.get(
      authorizeUrl(REALM, { client_id: other.clientId }),
    );
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);

    // Meanwhile the admin relaxes `other`'s flow to password only.
    await ctx.prisma.authenticationFlow.update({
      where: { id: strong.id },
      data: { steps: PASSWORD_ONLY as never, version: { increment: 1 } },
    });
    const res = await postPassword(browser, csrfFrom(page.text), user.username);
    const restart = res.headers['location'] as string;
    expect(restart).toMatch(/\/protocol\/openid-connect\/auth\?/);

    // Through /auth, the existing session now meets the flow: a code, silently.
    const resumed = await browser.get(restart);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(resumed.headers['location']),
      other.clientId,
    );
    expect(claims['sub']).toBe(user.id);
  });

  it('SSO is decided per user: TOTP required only for group G', async () => {
    // test-client: password only (realm flow). `gated`: password, then
    // TOTP only for members of G.
    const realmFlow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'g-realm',
      PASSWORD_ONLY,
    );
    const gatedFlow = await createFlow(ctx.prisma, seeded.realm.id, 'g-gated', [
      { id: 'pw', type: 'password', required: true, order: 1 },
      {
        id: 'otp',
        type: 'totp',
        required: true,
        order: 2,
        condition: { field: 'user.groups', operator: 'in', value: ['G'] },
      },
    ]);
    await bindRealm(ctx.prisma, seeded.realm.id, realmFlow.id);
    const gated = await createClient(
      ctx.prisma,
      seeded.realm.id,
      `gated-${userSeq}`,
      {
        authFlowId: gatedFlow.id,
      },
    );
    const group = await ctx.prisma.group.create({
      data: { realmId: seeded.realm.id, name: 'G' },
    });
    const member = await newUser();
    const outsider = await newUser();
    await ctx.prisma.userGroup.create({
      data: { userId: member.id, groupId: group.id },
    });

    // Both get a password-level session from test-client.
    const signIn = async (username: string) => {
      const b = new Browser(app);
      codeFrom(
        (await postPassword(b, await start(b), username)).headers['location'],
      );
      return b;
    };
    const m = await signIn(member.username);
    const o = await signIn(outsider.username);
    // The member enrols TOTP only now (else the MFA rule applied above).
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      member.id,
      REALM,
      member.username,
    );

    // The outsider's session serves `gated` silently.
    const silent = await o.get(
      authorizeUrl(REALM, { client_id: gated.clientId, prompt: 'none' }),
    );
    const outsiderClaims = await idTokenClaims(
      app,
      REALM,
      codeFrom(silent.headers['location']),
      gated.clientId,
    );
    expect(outsiderClaims['sub']).toBe(outsider.id);
    expect(outsiderClaims['acr']).toBe(ACR.password);

    // The member's does not: interaction_required silently...
    const refused = await m.get(
      authorizeUrl(REALM, { client_id: gated.clientId, prompt: 'none' }),
    );
    const url = new URL(refused.headers['location'] as string);
    expect(url.searchParams.get('error')).toBe('interaction_required');
    expect(url.searchParams.get('code')).toBeNull();

    // ...and interactively a sign-in through the flow, with the TOTP receipt.
    const auth = await m.get(
      authorizeUrl(REALM, { client_id: gated.clientId }),
    );
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await m.get(`/realms/${REALM}/login`);
    const afterPassword = await postPassword(
      m,
      csrfFrom(page.text),
      member.username,
    );
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    const done = await postTotp(m, await totp.code());
    const memberClaims = await idTokenClaims(
      app,
      REALM,
      codeFrom(done.headers['location']),
      gated.clientId,
    );
    expect(memberClaims['acr']).toBe(ACR.mfa);
    expect(memberClaims['amr']).toEqual(['pwd', 'otp']);
  });

  it('a passkey step without a password fallback hides the password form', async () => {
    const flow = await createFlow(ctx.prisma, seeded.realm.id, 'pk-only', [
      { id: 'pk', type: 'webauthn', required: true, order: 1 },
    ]);
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const browser = new Browser(app);
    await browser.get(authorizeUrl(REALM));
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('passkey-login-btn');
    expect(page.text).not.toContain('name="password"');
  });

  it('SSO from a flow session serves a client bound to the same flow silently', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'sso',
      PASSWORD_ONLY,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const user = await newUser();
    const browser = new Browser(app);
    const first = await postPassword(
      browser,
      await start(browser),
      user.username,
    );
    codeFrom(first.headers['location']);

    const silent = await browser.get(authorizeUrl(REALM, { prompt: 'none' }));
    expect(silent.status).toBe(302);
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(silent.headers['location']),
    );
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.password);
  });
});
