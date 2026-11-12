import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  SoftAuthenticator,
  expectedOrigin,
  type CreationOptions,
  type RequestOptions,
} from './helpers/soft-authenticator';

/**
 * A passkey registered through the account endpoints signs in without a
 * username: the challenge is bound to the browser that asked for it, and the
 * sign-in yields an SSO session and a code at the WebAuthn level.
 * Characterizes today's passwordless path before the session issuance is
 * shared with the password sign-in.
 */
describe('WebAuthn passwordless login (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let authenticator: SoftAuthenticator;

  const REALM = 'e2e-webauthn-login';
  const RP_ID = 'localhost';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const ACR_WEBAUTHN = 'urn:idenplane:acr:webauthn';
  const oauthBody = {
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
  };
  const authorizeUrl = `/realms/${REALM}/protocol/openid-connect/auth?${new URLSearchParams(oauthBody).toString()}`;

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

  const codeFrom = (location: string) => {
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('xyz');
    const code = url.searchParams.get('code');
    expect(code).toBeTruthy();
    return code as string;
  };

  /** A usernameless passkey sign-in, as the login page's script does it. */
  const passkeySignIn = async (
    browser: Browser,
    body: Record<string, string> = oauthBody,
  ) => {
    const options = await browser.postJson(
      `/realms/${REALM}/webauthn/authenticate/options`,
      {},
    );
    expect(options.status).toBe(200);
    const requestOptions = options.body as RequestOptions & {
      allowCredentials?: unknown[];
    };
    // Usernameless: the browser offers any passkey for the site.
    expect(requestOptions.allowCredentials ?? []).toHaveLength(0);
    expect(browser.jar.has('IDENPLANE_WEBAUTHN_LOGIN')).toBe(true);

    return browser.postJson(`/realms/${REALM}/webauthn/authenticate/verify`, {
      response: authenticator.assert(requestOptions),
      ...body,
    });
  };

  const setClient = (data: Record<string, unknown>) =>
    ctx.prisma.client.update({ where: { id: seeded.client.id }, data });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { webAuthnEnabled: true },
    });
    authenticator = new SoftAuthenticator(RP_ID, expectedOrigin(RP_ID));
  }, 30_000);

  afterEach(async () => {
    await setClient({ requireConsent: false });
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { requireEmailVerification: false },
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

  it('registers a passkey from a signed-in account session', async () => {
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/login`);
    const signedIn = await browser.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: 'TestPassword123!',
      _csrf: csrfFrom(page.text),
    });
    expect(signedIn.headers['location']).toBe(`/realms/${REALM}/account`);

    const options = await browser.postJson(
      `/realms/${REALM}/webauthn/register/options`,
      {},
    );
    expect(options.status).toBe(200);

    const verified = await browser.postJson(
      `/realms/${REALM}/webauthn/register/verify`,
      {
        response: authenticator.register(options.body as CreationOptions),
        friendlyName: 'Soft key',
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      credentialId: authenticator.id,
      friendlyName: 'Soft key',
    });

    const stored = await ctx.prisma.webAuthnCredential.findUniqueOrThrow({
      where: { credentialId: authenticator.id },
    });
    expect(stored.userId).toBe(seeded.user.id);
  });

  it('signs in without a username and issues a WebAuthn-level code', async () => {
    const browser = new Browser(app);
    const res = await passkeySignIn(browser);

    expect(res.status).toBe(200);
    const { redirectUrl } = res.body as { redirectUrl: string };
    const claims = await idTokenClaims(codeFrom(redirectUrl));
    expect(claims['acr']).toBe(ACR_WEBAUTHN);
    expect(claims['amr']).toEqual(['hwk']);
    expect(claims['sub']).toBe(seeded.user.id);

    // The challenge handle is spent; the SSO session is set.
    expect(browser.jar.has('IDENPLANE_WEBAUTHN_LOGIN')).toBe(false);
    const cookie = browser.raw.get('IDENPLANE_SESSION') as string;
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(new RegExp(`Path=/realms/${REALM}(;|$)`));
    expect(cookie).not.toMatch(/Max-Age|Expires/i);

    // Silent SSO from the passkey session keeps the WebAuthn level.
    const silent = await browser.get(authorizeUrl);
    expect(silent.status).toBe(302);
    const silentClaims = await idTokenClaims(
      codeFrom(silent.headers['location'] as string),
    );
    expect(silentClaims['acr']).toBe(ACR_WEBAUTHN);
    expect(silentClaims['amr']).toEqual(['hwk']);
  });

  it('opens the account page when there is no OAuth request', async () => {
    const browser = new Browser(app);
    const res = await passkeySignIn(browser, {});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ redirectUrl: `/realms/${REALM}/account` });
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);
  });

  it('carries the WebAuthn level across the consent screen', async () => {
    await setClient({ requireConsent: true });
    const browser = new Browser(app);
    const res = await passkeySignIn(browser);

    expect(res.status).toBe(200);
    const { redirectUrl } = res.body as { redirectUrl: string };
    expect(redirectUrl).toMatch(new RegExp(`^/realms/${REALM}/consent\\?req=`));

    const consentPage = await browser.get(redirectUrl);
    expect(consentPage.status).toBe(200);
    const reqId = /name="auth_req_id" value="([^"]+)"/.exec(
      consentPage.text,
    )?.[1];
    const granted = await browser.post(`/realms/${REALM}/consent`, {
      _csrf: csrfFrom(consentPage.text),
      auth_req_id: reqId as string,
      action: 'grant',
    });
    expect(granted.status).toBe(302);
    const claims = await idTokenClaims(
      codeFrom(granted.headers['location'] as string),
    );
    expect(claims['acr']).toBe(ACR_WEBAUTHN);
    expect(claims['amr']).toEqual(['hwk']);
  });

  it('refuses an unverified email without creating a session', async () => {
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { requireEmailVerification: true },
    });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { emailVerified: false },
    });
    const browser = new Browser(app);

    const res = await passkeySignIn(browser);

    expect(res.status).toBe(403);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(false);
  });

  it('refuses a sign-in without this browser’s challenge handle', async () => {
    const browser = new Browser(app);
    const options = await browser.postJson(
      `/realms/${REALM}/webauthn/authenticate/options`,
      {},
    );
    const res = await new Browser(app).postJson(
      `/realms/${REALM}/webauthn/authenticate/verify`,
      {
        response: authenticator.assert(options.body as RequestOptions),
        ...oauthBody,
      },
    );

    expect(res.status).toBe(400);
  });
});
