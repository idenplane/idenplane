import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as OTPAuth from 'otpauth';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import { CryptoService } from '../src/crypto/crypto.service.js';

/**
 * A realm with "Require MFA" on must never issue an SSO session, an
 * authorization code or a SAML assertion on a password alone. This drives the
 * real browser flow: sign-in → forced TOTP enrolment → resumed authorization.
 */
describe('Required MFA enforcement (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-mfa-required-realm';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const ACR_MFA = 'urn:idenplane:acr:mfa';
  const oauthQuery = {
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
  };
  const authorizeUrl = `/realms/${REALM}/protocol/openid-connect/auth?${new URLSearchParams(oauthQuery).toString()}`;

  const codeFrom = (location: string) => {
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    const code = url.searchParams.get('code');
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

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);

    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { mfaRequired: true },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('pauses an un-enrolled sign-in without creating an SSO session', async () => {
    const browser = new Browser(app);
    const res = await signIn(browser);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(
      `/realms/${REALM}/account/totp-setup`,
    );
    expect(browser.jar.has('IDENPLANE_MFA_ENROLLMENT')).toBe(true);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
    await expect(
      ctx.prisma.loginSession.count({ where: { userId: seeded.user.id } }),
    ).resolves.toBe(0);

    // The paused sign-in cannot be turned into an authorization code.
    const authorize = await browser.get(authorizeUrl);
    expect(authorize.status).toBe(302);
    expect(authorize.headers['location']).not.toContain('code=');
  });

  it('refuses a password-only SSO session that already exists', async () => {
    // e.g. one issued before this fix, or before the realm turned MFA on.
    const crypto = app.get(CryptoService);
    const token = crypto.generateSecret(32);
    await ctx.prisma.loginSession.create({
      data: {
        userId: seeded.user.id,
        realmId: seeded.realm.id,
        tokenHash: crypto.sha256(token),
        satisfiedAcr: 'urn:idenplane:acr:password',
        amr: ['pwd'],
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const browser = new Browser(app);
    browser.jar.set('IDENPLANE_SESSION', token);

    const authorize = await browser.get(authorizeUrl);
    expect(authorize.status).toBe(302);
    expect(authorize.headers['location']).not.toContain('code=');

    const account = await browser.get(`/realms/${REALM}/account`);
    expect(account.status).toBe(302);
    expect(account.headers['location']).toBe(`/realms/${REALM}/login`);

    await ctx.prisma.loginSession.deleteMany({
      where: { userId: seeded.user.id },
    });
  });

  it('enrols TOTP, then resumes the original authorization at the MFA level', async () => {
    const browser = new Browser(app);
    await signIn(browser);

    const setupPage = await browser.get(`/realms/${REALM}/account/totp-setup`);
    expect(setupPage.status).toBe(200);
    const secret = /<code[^>]*>([A-Z2-7]+)<\/code>/.exec(setupPage.text)?.[1];
    expect(secret).toBeTruthy();

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
    // A rendered POST response keeps Nest's default 201.
    expect(activated.status).toBe(201);
    expect(activated.text).toContain(
      `action="/realms/${REALM}/mfa-enrollment/continue"`,
    );

    const done = await browser.post(
      `/realms/${REALM}/mfa-enrollment/continue`,
      {
        _csrf: csrfFrom(activated.text),
      },
    );
    expect(done.status).toBe(302);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);
    expect(browser.jar.has('IDENPLANE_MFA_ENROLLMENT')).toBe(false);

    const claims = await idTokenClaims(
      codeFrom(done.headers['location'] as string),
    );
    expect(claims['acr']).toBe(ACR_MFA);
    expect(claims['amr']).toEqual(['pwd', 'otp']);

    // The enrolment is single-use.
    const replay = await browser.post(
      `/realms/${REALM}/mfa-enrollment/continue`,
      {
        _csrf: csrfFrom(activated.text),
      },
    );
    expect(replay.headers['location']).toContain(
      `/realms/${REALM}/login?error=`,
    );

    // Silent SSO from the same session keeps the MFA level it was signed in at.
    const silent = await browser.get(authorizeUrl);
    expect(silent.status).toBe(302);
    const silentClaims = await idTokenClaims(
      codeFrom(silent.headers['location'] as string),
    );
    expect(silentClaims['acr']).toBe(ACR_MFA);
  });

  it('does not let the user turn off the required second factor', async () => {
    const browser = new Browser(app);
    const challenge = await signIn(browser);
    expect(challenge.headers['location']).toBe(`/realms/${REALM}/totp`);
    // Drop the challenge: this only checks the disable endpoint, which needs a
    // session — reuse the MFA-level session from the database instead.
    const crypto = app.get(CryptoService);
    const token = crypto.generateSecret(32);
    await ctx.prisma.loginSession.create({
      data: {
        userId: seeded.user.id,
        realmId: seeded.realm.id,
        tokenHash: crypto.sha256(token),
        satisfiedAcr: ACR_MFA,
        amr: ['pwd', 'otp'],
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    browser.jar.set('IDENPLANE_SESSION', token);

    const account = await browser.get(`/realms/${REALM}/account`);
    expect(account.status).toBe(200);
    const res = await browser.post(`/realms/${REALM}/account/totp-disable`, {
      currentPassword: 'TestPassword123!',
      _csrf: csrfFrom(account.text),
    });
    expect(res.headers['location']).toContain('error=');
    await expect(
      ctx.prisma.userCredential.count({
        where: { userId: seeded.user.id, type: 'totp', verified: true },
      }),
    ).resolves.toBe(1);
  });
});
