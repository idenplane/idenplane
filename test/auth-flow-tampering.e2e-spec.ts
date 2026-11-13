import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  ACR,
  PASSWORD,
  PASSWORD_ONLY,
  PASSWORD_TOTP,
  TXN_COOKIE,
  authorizeUrl,
  bindRealm,
  codeCount,
  codeFrom,
  createClient,
  createFlow,
  createUser,
  enrolTotp,
  idTokenClaims,
  isCodeResponse,
  withRuntimeEnv,
} from './helpers/auth-flow';

/**
 * The custom auth-flow runtime under attack: every way of bending a login
 * transaction must fail closed, with no session and no code.
 */
describe('Auth-flow runtime tampering (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let userSeq = 0;
  let passwordFlowId: string;
  let mfaFlowId: string;

  const REALM = 'e2e-auth-flow-tampering';

  const start = async (
    browser: Browser,
    params: Record<string, string> = {},
  ): Promise<string> => {
    const auth = await browser.get(authorizeUrl(REALM, params));
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
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

  const totpCsrf = async (browser: Browser) => {
    const page = await browser.get(`/realms/${REALM}/totp`);
    expect(page.status).toBe(200);
    return csrfFrom(page.text);
  };

  const newUser = () =>
    createUser(ctx.prisma, seeded.realm.id, `tamper-user-${++userSeq}`);

  const NOTICE_COOKIE = 'IDENPLANE_LOGIN_NOTICE';
  const AUTH_RESTART = new RegExp(
    `^/realms/${REALM}/protocol/openid-connect/auth\\?client_id=test-client`,
  );

  const noSession = (browser: Browser) =>
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);

  beforeAll(async () => {
    restoreEnv = withRuntimeEnv('true');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    passwordFlowId = (
      await createFlow(ctx.prisma, seeded.realm.id, 'pw', PASSWORD_ONLY)
    ).id;
    mfaFlowId = (
      await createFlow(ctx.prisma, seeded.realm.id, 'pw-totp', PASSWORD_TOTP)
    ).id;
  }, 30_000);

  beforeEach(async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, passwordFlowId);
  });

  afterEach(async () => {
    await ctx.prisma.client.updateMany({
      where: { realmId: seeded.realm.id },
      data: { authFlowId: null },
    });
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

  it('posting to a step endpoint out of order: 400, and the transaction is gone', async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, mfaFlowId);
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

    // Skip the password: go straight to the second-factor endpoint.
    const res = await browser.post(`/realms/${REALM}/totp`, {
      code: await totp.code(),
      _csrf: csrf,
    });
    expect(res.status).toBe(400);
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
    noSession(browser);
    expect(await codeCount(ctx.prisma, user.id)).toBe(0);

    // The same submission with the cookie put back finds nothing.
    const again = await browser.post(`/realms/${REALM}/login`, {
      username: user.username,
      password: PASSWORD,
      _csrf: csrf,
    });
    expect(isCodeResponse(again.headers['location'])).toBe(false);
  });

  it('replaying a finalised transaction yields nothing', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    const csrf = await start(browser);
    const txn = browser.jar.get(TXN_COOKIE) as string;

    const first = await postPassword(browser, csrf, user.username);
    codeFrom(first.headers['location']);
    expect(await codeCount(ctx.prisma, user.id)).toBe(1);

    // An attacker replays the exact same request with the spent cookie.
    const replay = new Browser(app);
    for (const [k, v] of browser.jar) {
      if (k !== 'IDENPLANE_SESSION') replay.jar.set(k, v);
    }
    replay.jar.set(TXN_COOKIE, txn);
    const res = await postPassword(replay, csrf, user.username);
    expect(res.status).toBe(302);
    expect(isCodeResponse(res.headers['location'])).toBe(false);
    expect(res.headers['location']).toBe(`/realms/${REALM}/login`);
    expect(replay.jar.get(NOTICE_COOKIE)).toBe('invalid');
    noSession(replay);
    expect(await codeCount(ctx.prisma, user.id)).toBe(1);
  });

  it('OAuth params changed in the form mid-flow are ignored', async () => {
    const user = await newUser();
    const evil = await createClient(
      ctx.prisma,
      seeded.realm.id,
      `evil-${userSeq}`,
      {
        redirectUris: ['https://evil.example/cb'],
      },
    );
    const browser = new Browser(app);
    const csrf = await start(browser);
    const res = await postPassword(browser, csrf, user.username, {
      client_id: evil.clientId,
      redirect_uri: 'https://evil.example/cb',
      state: 'evil-state',
      scope: 'openid email',
      nonce: 'evil-nonce',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
    });
    // The code goes to the original request, unchanged.
    const code = codeFrom(res.headers['location'], 'xyz');
    const claims = await idTokenClaims(app, REALM, code);
    expect(claims['aud']).toBe('test-client');
    expect(claims['nonce']).toBe('n-1');
  });

  it('swapping the authn_txn cookie between browsers', async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, mfaFlowId);
    const alice = await newUser();
    const bob = await newUser();
    const aliceTotp = await enrolTotp(
      app,
      ctx.prisma,
      alice.id,
      REALM,
      alice.username,
    );
    const bobTotp = await enrolTotp(
      app,
      ctx.prisma,
      bob.id,
      REALM,
      bob.username,
    );

    const a = new Browser(app);
    const csrfA = await start(a);
    const preIdentification = a.jar.get(TXN_COOKIE) as string;

    // Alice identifies: the cookie rotates.
    const afterPassword = await postPassword(a, csrfA, alice.username);
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    const postIdentification = a.jar.get(TXN_COOKIE) as string;
    expect(postIdentification).not.toBe(preIdentification);

    // A value captured before identification is dead (fixation defence):
    // even Alice's correct code does nothing with it.
    const b = new Browser(app);
    const csrfB = await start(b);
    b.jar.set(TXN_COOKIE, preIdentification);
    const stale = await b.post(`/realms/${REALM}/totp`, {
      code: await aliceTotp.code(),
      _csrf: csrfB,
    });
    expect(isCodeResponse(stale.headers['location'])).toBe(false);
    expect(b.jar.get(NOTICE_COOKIE)).toBe('invalid');
    noSession(b);

    // The live value only ever completes Alice's sign-in: Bob's own valid
    // code is checked against Alice's factor and fails.
    const c = new Browser(app);
    c.jar.set(TXN_COOKIE, postIdentification);
    const res = await c.post(`/realms/${REALM}/totp`, {
      code: await bobTotp.code(),
      _csrf: await totpCsrf(c),
    });
    expect(isCodeResponse(res.headers['location'])).toBe(false);
    noSession(c);
    expect(await codeCount(ctx.prisma, bob.id)).toBe(0);
    expect(await codeCount(ctx.prisma, alice.id)).toBe(0);
  });

  it('an expired transaction restarts the login and issues nothing', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    const csrf = await start(browser);
    await ctx.prisma.pendingAction.updateMany({
      where: {
        type: 'authn_txn',
        data: { path: ['realmId'], equals: seeded.realm.id },
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await postPassword(browser, csrf, user.username);
    expect(res.status).toBe(302);
    expect(isCodeResponse(res.headers['location'])).toBe(false);
    // The restart goes through /auth, rebuilt from the stored request.
    expect(res.headers['location']).toMatch(AUTH_RESTART);
    expect(browser.jar.get(NOTICE_COOKIE)).toBe('expired');
    noSession(browser);
    // The login page it leads to says why.
    const auth = await browser.get(res.headers['location'] as string);
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.text).toContain('Your sign-in expired');
    expect(browser.jar.has(NOTICE_COOKIE)).toBe(false);
    expect(await codeCount(ctx.prisma, user.id)).toBe(0);
  });

  it('a fallback cannot switch to another user', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      `fb-${userSeq}`,
      [
        { id: 'pw', type: 'password', required: true, order: 1 },
        {
          id: 'otp',
          type: 'totp',
          required: true,
          order: 2,
          fallbackStepId: 'pw2',
        },
        { id: 'pw2', type: 'password', required: true, order: 3 },
      ],
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);
    const alice = await newUser();
    const mallory = await newUser();
    await enrolTotp(app, ctx.prisma, alice.id, REALM, alice.username);

    const browser = new Browser(app);
    await postPassword(browser, await start(browser), alice.username);
    // A wrong code: the TOTP step fails and its password fallback is next.
    const failed = await browser.post(`/realms/${REALM}/totp`, {
      code: '000000',
      _csrf: await totpCsrf(browser),
    });
    expect(failed.headers['location']).toMatch(
      new RegExp(`^/realms/${REALM}/login\\?error=`),
    );
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    // The fallback page is prefilled with the identified user.
    expect(page.text).toContain(`value="${alice.username}"`);

    // Mallory's (correct) credentials in the fallback: fail closed.
    const res = await postPassword(
      browser,
      csrfFrom(page.text),
      mallory.username,
    );
    expect(isCodeResponse(res.headers['location'])).toBe(false);
    expect(res.headers['location']).toMatch(AUTH_RESTART);
    expect(browser.jar.get(NOTICE_COOKIE)).toBe('user_mismatch');
    expect(browser.jar.has(TXN_COOKIE)).toBe(false);
    noSession(browser);
    expect(await codeCount(ctx.prisma, alice.id)).toBe(0);
    expect(await codeCount(ctx.prisma, mallory.id)).toBe(0);
  });

  it('an SSO session from a weaker flow does not satisfy a stronger-bound client', async () => {
    // test-client runs the password-only realm flow; `strong` is bound to
    // password → TOTP.
    const strong = await createClient(
      ctx.prisma,
      seeded.realm.id,
      `strong-${userSeq}`,
      {
        authFlowId: mfaFlowId,
      },
    );
    const user = await newUser();
    const browser = new Browser(app);
    const first = await postPassword(
      browser,
      await start(browser),
      user.username,
    );
    codeFrom(first.headers['location']);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);

    // Silent: interaction_required, no code.
    const silent = await browser.get(
      authorizeUrl(REALM, { client_id: strong.clientId, prompt: 'none' }),
    );
    expect(silent.status).toBe(302);
    const url = new URL(silent.headers['location'] as string);
    expect(url.searchParams.get('error')).toBe('interaction_required');
    expect(url.searchParams.get('code')).toBeNull();

    // Interactive: a new sign-in through the stronger flow.
    const interactive = await browser.get(
      authorizeUrl(REALM, { client_id: strong.clientId }),
    );
    expect(interactive.headers['location']).toBe(`/realms/${REALM}/login`);
    expect(browser.jar.has(TXN_COOKIE)).toBe(true);
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );
    const page = await browser.get(`/realms/${REALM}/login`);
    const afterPassword = await postPassword(
      browser,
      csrfFrom(page.text),
      user.username,
    );
    expect(afterPassword.headers['location']).toBe(`/realms/${REALM}/totp`);
    const done = await browser.post(`/realms/${REALM}/totp`, {
      code: await totp.code(),
      _csrf: await totpCsrf(browser),
    });
    const claims = await idTokenClaims(
      app,
      REALM,
      codeFrom(done.headers['location']),
      strong.clientId,
    );
    expect(claims['acr']).toBe(ACR.mfa);
  });

  it('a concurrent double-submit yields exactly one code', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    const csrf = await start(browser);
    const responses = await Promise.all([
      postPassword(browser, csrf, user.username),
      postPassword(browser, csrf, user.username),
    ]);
    const codes = responses.filter((r) =>
      isCodeResponse(r.headers['location']),
    );
    expect(codes).toHaveLength(1);
    const loser = responses.find((r) => !isCodeResponse(r.headers['location']));
    // Both read the same version; the optimistic lock rejects the second.
    expect(loser?.status).toBe(409);
    expect(await codeCount(ctx.prisma, user.id)).toBe(1);
  });
});
