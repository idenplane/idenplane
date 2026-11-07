import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { registerHandlebarsHelpers } from '../src/theme/handlebars-helpers.js';
import { SmsService } from '../src/sms/sms.service.js';

/**
 * SMS as a second factor through the real pages and APIs: a realm that
 * requires MFA lets a new user enrol a phone instead of an authenticator app,
 * later sign-ins accept a texted code, and step-up and the token API accept
 * one too. Codes only work for the sign-in they were sent for.
 */
describe('SMS MFA screens (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  const sent: { to: string; message: string }[] = [];

  const REALM = 'e2e-sms-mfa-screens';
  const PHONE = '+201012345678';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const ACR_MFA = 'urn:idenplane:acr:mfa';
  const oauthQuery = {
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
  };

  const lastCode = () => /^(\d+)/.exec(sent[sent.length - 1].message)![1];
  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

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

    async get(url: string) {
      return this.store(
        await request(app.getHttpServer()).get(url).set('Cookie', this.header()),
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

    async postJson(url: string, body: Record<string, string>) {
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

  const codeFrom = (location: string) => {
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    return url.searchParams.get('code') as string;
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

  const signIn = async (browser: Browser) => {
    const page = await browser.get(
      `/realms/${REALM}/login?${new URLSearchParams(oauthQuery).toString()}`,
    );
    expect(page.status).toBe(200);
    return browser.post(`/realms/${REALM}/login`, {
      ...oauthQuery,
      username: 'testuser',
      password: 'TestPassword123!',
      _csrf: csrfFrom(page.text),
    });
  };

  /** Sign in up to the second-factor page and have a code texted. */
  const signInAndTextCode = async (browser: Browser) => {
    const res = await signIn(browser);
    expect(res.headers['location']).toBe(`/realms/${REALM}/totp`);
    const page = await browser.get(`/realms/${REALM}/totp`);
    const sendRes = await browser.post(`/realms/${REALM}/totp/sms`, {
      _csrf: csrfFrom(page.text),
    });
    expect(sendRes.headers['location']).toContain('method=sms&info=');
    return browser.get(`/realms/${REALM}/totp?method=sms`);
  };

  let signedIn: Browser;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const express = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: string) => void;
    };
    express.set('views', join(process.cwd(), 'themes'));
    express.set('view engine', 'hbs');
    registerHandlebarsHelpers();

    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: {
        mfaRequired: true,
        smsMfaEnabled: true,
        smsProvider: 'webhook',
        smsMaxRequestsPerUser: 100,
      },
    });
    jest
      .spyOn(app.get(SmsService), 'sendSms')
      .mockImplementation(async (_realm, to, message) => {
        sent.push({ to, message });
      });
  }, 30_000);

  // Sign-ins are capped at 5 MFA challenges per user per 5 minutes; each
  // test starts from a clean slate so the cap doesn't leak between them.
  beforeEach(async () => {
    await ctx.prisma.pendingAction.deleteMany({
      where: { type: 'mfa_challenge' },
    });
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('lets a required-MFA user enrol a phone instead of an app, then resumes sign-in at the MFA level', async () => {
    const browser = new Browser();
    await signIn(browser);

    const totpSetup = await browser.get(`/realms/${REALM}/account/totp-setup`);
    expect(totpSetup.text).toContain(`href="/realms/${REALM}/account/sms-setup"`);

    const phonePage = await browser.get(`/realms/${REALM}/account/sms-setup`);
    expect(phonePage.status).toBe(200);
    // The password was just entered: no second password prompt here.
    expect(phonePage.text).not.toContain('name="currentPassword"');

    const sendRes = await browser.post(`/realms/${REALM}/account/sms-setup/send`, {
      phone: '+20 101 234 5678',
      _csrf: csrfFrom(phonePage.text),
    });
    expect(sendRes.headers['location']).toContain('sms-setup?info=');
    expect(sent[sent.length - 1].to).toBe(PHONE);

    const codePage = await browser.get(`/realms/${REALM}/account/sms-setup`);
    expect(codePage.text).toContain('+20••••••5678');
    expect(codePage.text).toContain('sms-setup/verify');

    const wrong = await browser.post(`/realms/${REALM}/account/sms-setup/verify`, {
      code: wrongCode(lastCode()),
      _csrf: csrfFrom(codePage.text),
    });
    expect(wrong.headers['location']).toContain('error=');
    await expect(
      ctx.prisma.userCredential.count({ where: { userId: seeded.user.id, type: 'sms' } }),
    ).resolves.toBe(0);

    const retryPage = await browser.get(`/realms/${REALM}/account/sms-setup`);
    const activated = await browser.post(`/realms/${REALM}/account/sms-setup/verify`, {
      code: lastCode(),
      _csrf: csrfFrom(retryPage.text),
    });
    expect(activated.status).toBe(201);
    expect(activated.text).toContain(`action="/realms/${REALM}/mfa-enrollment/continue"`);
    await expect(
      ctx.prisma.recoveryCode.count({ where: { userId: seeded.user.id } }),
    ).resolves.toBe(10);

    const done = await browser.post(`/realms/${REALM}/mfa-enrollment/continue`, {
      _csrf: csrfFrom(activated.text),
    });
    expect(done.status).toBe(302);
    const claims = await idTokenClaims(codeFrom(done.headers['location'] as string));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'sms']);
  });

  it('signs in with a texted code, and keeps a wrong code on the SMS form', async () => {
    const browser = new Browser();
    const smsPage = await signInAndTextCode(browser);
    expect(smsPage.text).toContain('name="smsCode"');
    // SMS-only user: no authenticator field.
    expect(smsPage.text).not.toContain('name="code"');

    const wrong = await browser.post(`/realms/${REALM}/totp`, {
      smsCode: wrongCode(lastCode()),
      _csrf: csrfFrom(smsPage.text),
    });
    expect(wrong.headers['location']).toContain('method=sms');
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);

    const page = await browser.get(`/realms/${REALM}/totp?method=sms`);
    const ok = await browser.post(`/realms/${REALM}/totp`, {
      smsCode: lastCode(),
      _csrf: csrfFrom(page.text),
    });
    expect(ok.status).toBe(302);
    const claims = await idTokenClaims(codeFrom(ok.headers['location'] as string));
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'sms']);
    signedIn = browser;
  });

  it('rejects a code that was texted for a different sign-in', async () => {
    const first = new Browser();
    await signInAndTextCode(first);
    const codeForFirst = lastCode();

    const second = new Browser();
    await signIn(second);
    const page = await second.get(`/realms/${REALM}/totp?method=sms`);
    const res = await second.post(`/realms/${REALM}/totp`, {
      smsCode: codeForFirst,
      _csrf: csrfFrom(page.text),
    });

    expect(res.headers['location']).toContain(`/realms/${REALM}/totp?error=`);
    expect(second.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('shows the phone on the account page and keeps the last factor of a required-MFA realm', async () => {
    const account = await signedIn.get(`/realms/${REALM}/account`);
    expect(account.status).toBe(200);
    expect(account.text).toContain('+20••••••5678');

    const res = await signedIn.post(`/realms/${REALM}/account/sms-disable`, {
      currentPassword: 'TestPassword123!',
      _csrf: csrfFrom(account.text),
    });
    expect(res.headers['location']).toContain('/account?error=');
    await expect(
      ctx.prisma.userCredential.count({ where: { userId: seeded.user.id, type: 'sms' } }),
    ).resolves.toBe(1);
  });

  it('accepts a texted code for an MFA step-up', async () => {
    const challenge = await signedIn.get(
      `/realms/${REALM}/step-up/challenge?acr=${encodeURIComponent(ACR_MFA)}&client_id=test-client`,
    );
    // A fresh sign-in may already satisfy the level; force a new challenge.
    if (challenge.body.status === 'satisfied') {
      await ctx.prisma.stepUpRecord.deleteMany({});
    }
    const fresh = await signedIn.get(
      `/realms/${REALM}/step-up/challenge?acr=${encodeURIComponent(ACR_MFA)}&client_id=test-client`,
    );
    expect(fresh.body).toMatchObject({
      status: 'challenge_required',
      challenge_type: 'sms',
      methods: ['sms', 'recovery'],
    });
    const mfaToken = fresh.body.mfa_token as string;

    const sendRes = await signedIn.postJson(`/realms/${REALM}/step-up/sms`, {
      mfa_token: mfaToken,
    });
    expect(sendRes.status).toBe(201);
    expect(sendRes.body.masked_phone).toBe('+20••••••5678');

    const verify = await signedIn.postJson(`/realms/${REALM}/step-up/verify`, {
      acr: ACR_MFA,
      client_id: 'test-client',
      mfa_token: mfaToken,
      otp: lastCode(),
      method: 'sms',
    });
    expect(verify.status).toBe(201);
    expect(verify.body).toMatchObject({ status: 'success', amr: ['pwd', 'sms'] });
  });

  it('completes the token API challenge with a texted code', async () => {
    const tokenUrl = `/realms/${REALM}/protocol/openid-connect/token`;
    const challenge = await request(app.getHttpServer())
      .post(tokenUrl)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      });
    expect(challenge.status).toBe(401);
    expect(challenge.body).toMatchObject({
      error: 'mfa_required',
      mfa_methods: ['sms', 'recovery'],
    });
    const mfaToken = challenge.body.mfa_token as string;

    // Without client authentication no code is sent.
    const anonymous = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/mfa/sms`)
      .type('form')
      .send({ client_id: 'test-client', mfa_token: mfaToken });
    expect(anonymous.status).toBeGreaterThanOrEqual(400);

    const before = sent.length;
    const sendRes = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/mfa/sms`)
      .type('form')
      .send({
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        mfa_token: mfaToken,
      });
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.masked_phone).toBe('+20••••••5678');
    expect(sent.length).toBe(before + 1);

    const tokens = await request(app.getHttpServer())
      .post(tokenUrl)
      .type('form')
      .send({
        grant_type: 'mfa_otp',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        mfa_token: mfaToken,
        mfa_method: 'sms',
        otp: lastCode(),
      });
    expect(tokens.status).toBe(200);
    expect(tokens.body).toHaveProperty('access_token');
  });

  it('refuses to switch SMS MFA on without a provider', async () => {
    await request(app.getHttpServer())
      .put(`/admin/realms/${REALM}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ smsMfaEnabled: true, smsProvider: 'none' })
      .expect(400);
  });
});
