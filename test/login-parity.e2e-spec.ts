import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as OTPAuth from 'otpauth';
import * as argon2 from 'argon2';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import { MfaService } from '../src/mfa/mfa.service.js';
import { SmsOtpService } from '../src/sms/sms-otp.service.js';
import { SmsService } from '../src/sms/sms.service.js';
import { RiskAssessmentService } from '../src/risk-assessment/risk-assessment.service.js';

/**
 * Characterization of the hosted browser sign-in, pinned before the login
 * code is split into gates, a second-factor verifier, a session issuer and
 * the post-authentication step. Every assertion here is what the code does
 * today; a refactor must leave all of it unchanged.
 */
describe('Login parity (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  const sent: { to: string; message: string }[] = [];

  const REALM = 'e2e-login-parity';
  const PASSWORD = 'TestPassword123!';
  const PHONE = '+201012345679';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const ACR_PASSWORD = 'urn:idenplane:acr:password';
  const ACR_MFA = 'urn:idenplane:acr:mfa';
  const ACR_WEBAUTHN = 'urn:idenplane:acr:webauthn';
  const oauthQuery = (extra: Record<string, string> = {}) => ({
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
    ...extra,
  });
  const authorizeUrl = (extra: Record<string, string> = {}) =>
    `/realms/${REALM}/protocol/openid-connect/auth?${new URLSearchParams(oauthQuery(extra)).toString()}`;

  /** Users with each kind of second factor (one each, so codes never clash). */
  const users = {} as Record<
    'totp' | 'recovery' | 'consent' | 'sms',
    { id: string; username: string; totp?: OTPAuth.TOTP; recovery?: string[] }
  >;

  /** Opens the login page as /auth would, then submits the form. */
  const signIn = async (
    browser: Browser,
    options: {
      username?: string;
      query?: Record<string, string> | null;
      form?: Record<string, string>;
    } = {},
  ) => {
    const query = options.query === null ? {} : oauthQuery(options.query);
    const qs = new URLSearchParams(query).toString();
    const page = await browser.get(
      `/realms/${REALM}/login${qs ? `?${qs}` : ''}`,
    );
    expect(page.status).toBe(200);
    const form: Record<string, string> = {
      username: options.username ?? 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
      ...options.form,
    };
    // Exactly the hidden fields the page rendered, as a browser would send.
    for (const m of page.text.matchAll(
      /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
    )) {
      if (m[1] !== '_csrf') form[m[1]] = m[2].replaceAll('&amp;', '&');
    }
    return browser.post(`/realms/${REALM}/login`, form);
  };

  /** Answers the second-factor page with the given form fields. */
  const answerSecondFactor = async (
    browser: Browser,
    fields: Record<string, string>,
    page = `/realms/${REALM}/totp`,
  ) => {
    const totpPage = await browser.get(page);
    expect(totpPage.status).toBe(200);
    return browser.post(`/realms/${REALM}/totp`, {
      ...fields,
      _csrf: csrfFrom(totpPage.text),
    });
  };

  const redirectParams = (res: request.Response) => {
    expect(res.status).toBe(302);
    const url = new URL(res.headers['location'] as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    return url.searchParams;
  };

  const codeFrom = (res: request.Response) => {
    const params = redirectParams(res);
    expect(params.get('state')).toBe('xyz');
    const code = params.get('code');
    expect(code).toBeTruthy();
    return code as string;
  };

  const idTokenClaims = async (code: string) => {
    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: 'test-client',
        client_secret: 'test-client-secret',
      })
      .expect(200);
    const payload = (res.body as { id_token: string }).id_token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
  };

  const loginError = (res: request.Response) => {
    expect(res.status).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toMatch(new RegExp(`^/realms/${REALM}/login\\?`));
    return new URL(location, 'http://x').searchParams;
  };

  const createUser = async (username: string) => {
    const user = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username,
        email: `${username}@example.com`,
        emailVerified: true,
        enabled: true,
        passwordHash: await argon2.hash(PASSWORD),
      },
    });
    return { id: user.id, username };
  };

  const enrolTotp = async (user: { id: string; username: string }) => {
    const mfa = app.get(MfaService);
    const { secret } = await mfa.setupTotp(user.id, REALM, user.username);
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const recovery = await mfa.verifyAndActivateTotp(user.id, totp.generate());
    expect(recovery?.length).toBeGreaterThan(0);
    return { ...user, totp, recovery: recovery as string[] };
  };

  const setClient = (data: Record<string, unknown>) =>
    ctx.prisma.client.update({ where: { id: seeded.client.id }, data });
  const setRealm = (data: Record<string, unknown>) =>
    ctx.prisma.realm.update({ where: { id: seeded.realm.id }, data });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
    await setRealm({
      smsMfaEnabled: true,
      smsProvider: 'webhook',
      smsMaxRequestsPerUser: 100,
    });

    users.totp = await enrolTotp(await createUser('totp-user'));
    users.recovery = await enrolTotp(await createUser('recovery-user'));
    users.consent = await enrolTotp(await createUser('consent-user'));
    users.sms = await createUser('sms-user');
    await app.get(SmsOtpService).saveEnrolledPhone(users.sms.id, PHONE);
  }, 60_000);

  beforeEach(() => {
    // Capture texts instead of calling a provider (restored after each test).
    jest
      .spyOn(app.get(SmsService), 'sendSms')
      .mockImplementation(async (_realm, to, message) => {
        sent.push({ to, message });
      });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await setClient({ requiredAcr: null, requireConsent: false });
    await setRealm({
      adaptiveAuthEnabled: false,
      requireEmailVerification: false,
      passwordMaxAgeDays: 0,
      bruteForceEnabled: false,
    });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { emailVerified: true },
    });
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  // ─── First factor ──────────────────────────────────────────────────────

  it('issues a password-level code for a password sign-in', async () => {
    const browser = new Browser(app);
    const res = await signIn(browser);

    const claims = await idTokenClaims(codeFrom(res));
    expect(claims['acr']).toBe(ACR_PASSWORD);
    expect(claims['amr']).toEqual(['pwd']);

    // The SSO cookie: Lax, HttpOnly, Secure, realm path, a browser session.
    const cookie = browser.raw.get('IDENPLANE_SESSION') as string;
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(new RegExp(`Path=/realms/${REALM}(;|$)`));
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });

  it('keeps the SSO cookie for 30 days with "remember me"', async () => {
    const browser = new Browser(app);
    const res = await signIn(browser, { form: { rememberMe: 'on' } });

    codeFrom(res);
    expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/Max-Age=2592000/);
  });

  it('keeps "remember me" through the second factor', async () => {
    const browser = new Browser(app);
    await signIn(browser, {
      username: users.recovery.username,
      form: { rememberMe: 'on' },
    });

    // A recovery code: a fresh TOTP code could be refused as a replay.
    const res = await answerSecondFactor(browser, {
      recoveryCode: users.recovery.recovery![1],
    });

    codeFrom(res);
    expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/Max-Age=2592000/);
  });

  it('opens the account page when there is no OAuth request', async () => {
    const browser = new Browser(app);
    const res = await signIn(browser, { query: null });

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe(`/realms/${REALM}/account`);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);
  });

  it('reports wrong credentials on the login page, keeping the OAuth request', async () => {
    const browser = new Browser(app);
    const res = await signIn(browser, { form: { password: 'wrong' } });

    const params = loginError(res);
    expect(params.get('error')).toBeTruthy();
    expect(params.get('client_id')).toBe('test-client');
    expect(params.get('state')).toBe('xyz');
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  // ─── Second factor ─────────────────────────────────────────────────────

  it('sends a TOTP user to /totp, then issues an MFA-level code', async () => {
    const browser = new Browser(app);
    const first = await signIn(browser, { username: users.totp.username });
    expect(first.status).toBe(302);
    expect(first.headers['location']).toBe(`/realms/${REALM}/totp`);
    expect(browser.jar.has('IDENPLANE_MFA_CHALLENGE')).toBe(true);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);

    const res = await answerSecondFactor(browser, {
      code: users.totp.totp!.generate(),
    });

    const claims = await idTokenClaims(codeFrom(res));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'otp']);
    expect(browser.jar.has('IDENPLANE_MFA_CHALLENGE')).toBe(false);
    expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/SameSite=Lax/i);

    // Silent SSO from that session keeps the level it was signed in at.
    const silent = await browser.get(authorizeUrl());
    const silentClaims = await idTokenClaims(codeFrom(silent));
    expect(silentClaims['acr']).toBe(ACR_MFA);
    expect(silentClaims['amr']).toEqual(['pwd', 'otp']);
  });

  it('refuses a wrong code and keeps the challenge, then accepts a recovery code', async () => {
    const browser = new Browser(app);
    const first = await signIn(browser, { username: users.recovery.username });
    expect(first.headers['location']).toBe(`/realms/${REALM}/totp`);

    const wrong = await answerSecondFactor(browser, {
      recoveryCode: 'not-a-recovery-code',
    });
    expect(wrong.status).toBe(302);
    // With brute-force protection off (the default) there is no attempt
    // limit to warn about: a wrong code just says so.
    expect(wrong.headers['location']).toBe(
      `/realms/${REALM}/totp?error=${encodeURIComponent('Invalid code. Please try again.')}`,
    );
    expect(browser.jar.has('IDENPLANE_MFA_CHALLENGE')).toBe(true);

    const res = await answerSecondFactor(browser, {
      recoveryCode: users.recovery.recovery![0],
    });

    const claims = await idTokenClaims(codeFrom(res));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'otp']);
  });

  it('accepts a texted code and records sms as the method', async () => {
    await setRealm({ bruteForceEnabled: true, maxLoginFailures: 10 });
    const browser = new Browser(app);
    const first = await signIn(browser, { username: users.sms.username });
    expect(first.headers['location']).toBe(`/realms/${REALM}/totp`);

    const page = await browser.get(`/realms/${REALM}/totp`);
    const sendRes = await browser.post(`/realms/${REALM}/totp/sms`, {
      _csrf: csrfFrom(page.text),
    });
    expect(sendRes.headers['location']).toContain('method=sms&info=');
    const code = /^(\d+)/.exec(sent[sent.length - 1].message)![1];
    const wrongCode = code === '000000' ? '111111' : '000000';

    // A wrong texted code keeps the user on the SMS form.
    const wrong = await answerSecondFactor(
      browser,
      { smsCode: wrongCode },
      `/realms/${REALM}/totp?method=sms`,
    );
    expect(wrong.headers['location']).toBe(
      `/realms/${REALM}/totp?error=${encodeURIComponent('Invalid code. Please try again.')}&method=sms`,
    );

    const res = await answerSecondFactor(
      browser,
      { smsCode: code },
      `/realms/${REALM}/totp?method=sms`,
    );

    const claims = await idTokenClaims(codeFrom(res));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'sms']);
  });

  it('sends a second-factor answer without a challenge back to sign in', async () => {
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/login`);
    const res = await browser.post(`/realms/${REALM}/totp`, {
      code: '123456',
      _csrf: csrfFrom(page.text),
    });

    expect(loginError(res).get('error')).toBe(
      'MFA session expired. Please login again.',
    );
  });

  it('carries the MFA level across the consent screen', async () => {
    await setClient({ requireConsent: true });
    const browser = new Browser(app);
    await signIn(browser, { username: users.consent.username });
    const afterMfa = await answerSecondFactor(browser, {
      code: users.consent.totp!.generate(),
    });
    expect(afterMfa.status).toBe(302);
    expect(afterMfa.headers['location']).toMatch(
      new RegExp(`^/realms/${REALM}/consent\\?req=`),
    );
    const signedInAt = Math.floor(Date.now() / 1000);

    const consentPage = await browser.get(
      afterMfa.headers['location'] as string,
    );
    expect(consentPage.status).toBe(200);
    const reqId = /name="auth_req_id" value="([^"]+)"/.exec(
      consentPage.text,
    )?.[1];
    expect(reqId).toBeTruthy();
    // Linger on the consent page past a second boundary.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res = await browser.post(`/realms/${REALM}/consent`, {
      _csrf: csrfFrom(consentPage.text),
      auth_req_id: reqId as string,
      action: 'grant',
    });

    const claims = await idTokenClaims(codeFrom(res));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'otp']);
    // auth_time is when the user signed in, not when they clicked Allow.
    expect(claims['auth_time']).toBeLessThanOrEqual(signedInAt);
  });

  // ─── Account gates ─────────────────────────────────────────────────────

  it('blocks an unverified email, keeping the OAuth request', async () => {
    await setRealm({ requireEmailVerification: true });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { emailVerified: false },
    });
    const browser = new Browser(app);

    const params = loginError(await signIn(browser));

    expect(params.get('error')).toBe(
      'Please verify your email address before signing in. Check your inbox for the verification link.',
    );
    expect(params.get('client_id')).toBe('test-client');
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('sends an expired password to change-password, without a session', async () => {
    // The seeded user has never changed the password, which counts as expired.
    await setRealm({ passwordMaxAgeDays: 30 });
    const browser = new Browser(app);

    const res = await signIn(browser);

    expect(res.status).toBe(302);
    const location = new URL(res.headers['location'] as string, 'http://x');
    expect(location.pathname).toBe(`/realms/${REALM}/change-password`);
    expect(location.searchParams.get('token')).toBeTruthy();
    expect(location.searchParams.get('info')).toBe(
      'Your password has expired and must be changed.',
    );
    // The OAuth request is not carried to the change-password page.
    expect(location.searchParams.get('client_id')).toBeNull();
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  /** Changes the expired password on the page `location` leads to. */
  const changeExpiredPassword = async (browser: Browser, location: string) => {
    const page = await browser.get(location);
    expect(page.status).toBe(200);
    const token = new URL(location, 'http://x').searchParams.get('token');
    return browser.post(`/realms/${REALM}/change-password`, {
      token: token as string,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      _csrf: csrfFrom(page.text),
    });
  };
  const NEW_PASSWORD = 'NewPassword456!';
  const resetPassword = async (userId: string) =>
    ctx.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(PASSWORD),
        passwordChangedAt: null,
      },
    });

  it('continues to the application after the expired password is changed', async () => {
    await setRealm({ passwordMaxAgeDays: 30 });
    const browser = new Browser(app);
    try {
      const res = await signIn(browser, {
        query: { nonce: 'n-expiry', prompt: 'login' },
        form: { rememberMe: 'true' },
      });
      const changed = await changeExpiredPassword(
        browser,
        res.headers['location'] as string,
      );

      // The OAuth request was kept server-side: the code goes to the client
      // with the original state, at the level the password proved.
      const claims = await idTokenClaims(codeFrom(changed));
      expect(claims['acr']).toBe(ACR_PASSWORD);
      expect(claims['amr']).toEqual(['pwd']);
      expect(claims['nonce']).toBe('n-expiry');
      expect(browser.raw.get('IDENPLANE_SESSION')).toMatch(/Max-Age=2592000/);
    } finally {
      await resetPassword(seeded.user.id);
    }
  });

  it('asks for the second factor after an expired password is changed', async () => {
    await setRealm({ passwordMaxAgeDays: 30 });
    const browser = new Browser(app);
    try {
      const res = await signIn(browser, { username: users.totp.username });
      const changed = await changeExpiredPassword(
        browser,
        res.headers['location'] as string,
      );
      expect(changed.status).toBe(302);
      expect(changed.headers['location']).toBe(`/realms/${REALM}/totp`);

      // Codes used earlier in this suite would be refused as replays.
      await ctx.prisma.usedTotpCode.deleteMany({
        where: { userId: users.totp.id },
      });
      const claims = await idTokenClaims(
        codeFrom(
          await answerSecondFactor(browser, {
            code: users.totp.totp!.generate(),
          }),
        ),
      );
      expect(claims['acr']).toBe(ACR_MFA);
      expect(claims['amr']).toEqual(['pwd', 'otp']);
    } finally {
      await ctx.prisma.usedTotpCode.deleteMany({
        where: { userId: users.totp.id },
      });
      await resetPassword(users.totp.id);
    }
  });

  it('resumes the sign-in once: a replayed change token gets no code', async () => {
    await setRealm({ passwordMaxAgeDays: 30 });
    const browser = new Browser(app);
    try {
      const res = await signIn(browser);
      const location = res.headers['location'] as string;
      codeFrom(await changeExpiredPassword(browser, location));

      const replay = await changeExpiredPassword(new Browser(app), location);
      expect(replay.headers['location']).toContain(`/realms/${REALM}/login?`);
      expect(replay.headers['location']).not.toContain('code=');
    } finally {
      await resetPassword(seeded.user.id);
    }
  });

  // ─── Risk ──────────────────────────────────────────────────────────────

  const mockRisk = (action: 'ALLOW' | 'STEP_UP' | 'BLOCK') => {
    const risk = app.get(RiskAssessmentService);
    jest
      .spyOn(risk, 'assessRisk')
      .mockResolvedValue({ action, riskScore: 70 } as never);
    return {
      blockedEmail: jest
        .spyOn(risk, 'sendBlockedLoginEmail')
        .mockResolvedValue(undefined as never),
      profile: jest
        .spyOn(risk, 'updateUserProfile')
        .mockResolvedValue(undefined as never),
    };
  };

  it('blocks a sign-in that risk assessment blocks', async () => {
    await setRealm({ adaptiveAuthEnabled: true });
    const spies = mockRisk('BLOCK');
    const browser = new Browser(app);

    const params = loginError(await signIn(browser));

    expect(params.get('error')).toBe(
      'Login blocked due to suspicious activity. Check your email for details.',
    );
    expect(params.get('client_id')).toBe('test-client');
    expect(spies.blockedEmail).toHaveBeenCalledTimes(1);
    expect(spies.profile).not.toHaveBeenCalled();
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('ignores risk assessment when adaptive authentication is off', async () => {
    const spies = mockRisk('BLOCK');

    codeFrom(await signIn(new Browser(app)));
    expect(spies.blockedEmail).not.toHaveBeenCalled();
  });

  it('steps a risky sign-in up to the second factor', async () => {
    await setRealm({ adaptiveAuthEnabled: true });
    const spies = mockRisk('STEP_UP');
    const browser = new Browser(app);

    const res = await signIn(browser, { username: users.totp.username });

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe(`/realms/${REALM}/totp`);
    expect(browser.jar.has('IDENPLANE_MFA_CHALLENGE')).toBe(true);
    expect(spies.profile).toHaveBeenCalledTimes(1);
  });

  it('applies the client policy before a risk step-up', async () => {
    // A passkey-only client cannot be satisfied by password + TOTP, so the
    // sign-in is refused instead of sending the user through TOTP first.
    await setClient({ requiredAcr: ACR_WEBAUTHN });
    await setRealm({ adaptiveAuthEnabled: true });
    mockRisk('STEP_UP');

    const res = await signIn(new Browser(app), {
      username: users.totp.username,
    });

    const url = new URL(res.headers['location'] as string);
    expect(url.searchParams.get('error')).toBe('access_denied');
  });

  it('applies password expiry before a risk step-up', async () => {
    await setRealm({ adaptiveAuthEnabled: true, passwordMaxAgeDays: 30 });
    mockRisk('STEP_UP');
    const browser = new Browser(app);
    try {
      const res = await signIn(browser, { username: users.totp.username });

      // The expired password is handled first; no second factor is asked
      // for and no challenge is created.
      expect(res.status).toBe(302);
      const location = new URL(res.headers['location'] as string, 'http://x');
      expect(location.pathname).toBe(`/realms/${REALM}/change-password`);
      expect(browser.jar.has('IDENPLANE_MFA_CHALLENGE')).toBe(false);
    } finally {
      await ctx.prisma.user.update({
        where: { id: users.totp.id },
        data: { passwordChangedAt: null },
      });
    }
  });

  it('lets a risky sign-in through when there is no factor to step up with', async () => {
    await setRealm({ adaptiveAuthEnabled: true });
    mockRisk('STEP_UP');

    const claims = await idTokenClaims(
      codeFrom(await signIn(new Browser(app))),
    );
    expect(claims['acr']).toBe(ACR_PASSWORD);
    expect(claims['amr']).toEqual(['pwd']);
  });

  // ─── Single sign-on and prompt ─────────────────────────────────────────

  it('reuses the SSO session silently', async () => {
    const browser = new Browser(app);
    codeFrom(await signIn(browser));

    const silent = await browser.get(authorizeUrl());

    const claims = await idTokenClaims(codeFrom(silent));
    expect(claims['acr']).toBe(ACR_PASSWORD);
    expect(claims['amr']).toEqual(['pwd']);
  });

  it('shows the login page for prompt=login, even with a session', async () => {
    const browser = new Browser(app);
    codeFrom(await signIn(browser));

    const res = await browser.get(authorizeUrl({ prompt: 'login' }));
    expect(res.status).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toMatch(new RegExp(`^/realms/${REALM}/login\\?`));
    expect(new URL(location, 'http://x').searchParams.get('prompt')).toBe(
      'login',
    );

    const page = await browser.get(location);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`action="/realms/${REALM}/login"`);
  });

  it('answers prompt=none without a session with login_required', async () => {
    const res = await new Browser(app).get(authorizeUrl({ prompt: 'none' }));

    const params = redirectParams(res);
    expect(params.get('error')).toBe('login_required');
    expect(params.get('state')).toBe('xyz');
    expect(params.get('code')).toBeNull();
  });

  it('answers prompt=none with interaction_required when the client needs more', async () => {
    const browser = new Browser(app);
    codeFrom(await signIn(browser));
    await setClient({ requiredAcr: ACR_MFA });

    const res = await browser.get(authorizeUrl({ prompt: 'none' }));

    const params = redirectParams(res);
    expect(params.get('error')).toBe('interaction_required');
    expect(params.get('state')).toBe('xyz');
    expect(params.get('code')).toBeNull();
  });

  it('answers prompt=none with consent_required when consent is missing', async () => {
    const browser = new Browser(app);
    codeFrom(await signIn(browser));
    await setClient({ requireConsent: true });

    const res = await browser.get(authorizeUrl({ prompt: 'none' }));

    const params = redirectParams(res);
    expect(params.get('error')).toBe('consent_required');
    expect(params.get('state')).toBe('xyz');
    expect(params.get('code')).toBeNull();
  });
});
