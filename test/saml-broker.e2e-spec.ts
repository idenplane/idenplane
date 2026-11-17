import type { INestApplication } from '@nestjs/common';
import { inflateRawSync } from 'zlib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, useThemeViews } from './helpers/browser';
import {
  REDIRECT_URI,
  TXN_COOKIE,
  authorizeUrl,
  bindRealm,
  codeFrom,
  createFlow,
  createUser,
  withRuntimeEnv,
  type Steps,
} from './helpers/auth-flow';
import {
  encodeResponse,
  makeFakeIdp,
  responseXml,
  type FakeIdp,
  type FakeResponseOptions,
} from '../src/broker/saml/__mocks__/fake-saml-idp';
import { spEndpoints } from '../src/broker/saml/saml-sp-messages';
import { SAML_BROKER_COOKIE } from '../src/broker/saml/saml-broker.service';

/**
 * Sign-in through a SAML 2.0 identity provider (Idenplane as the SP), end
 * to end: the login page's button → the start link → an AuthnRequest to a
 * fake IdP → a Response signed with the IdP's test key posted to the ACS →
 * back in the browser that started → signed in, linked, code issued. Also:
 * replay, another browser, account linking by trusted email, a flow's
 * `social` step, and the SP metadata.
 */
describe('SAML identity-provider broker (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let idp: FakeIdp;
  let userSeq = 0;

  const REALM = 'e2e-saml-broker';
  const ALIAS = 'okta';
  const SSO_URL = 'https://idp.example.test/saml/sso';
  const sp = () =>
    spEndpoints(
      process.env['BASE_URL'] ?? 'http://localhost:3000',
      REALM,
      ALIAS,
    );

  beforeAll(async () => {
    idp = await makeFakeIdp('https://idp.example.test/saml');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.identityProvider.create({
      data: {
        realmId: seeded.realm.id,
        alias: ALIAS,
        displayName: 'Okta SAML',
        providerType: 'saml',
        clientId: '',
        clientSecret: '',
        authorizationUrl: '',
        tokenUrl: '',
        defaultScopes: '',
        trustEmail: true,
        samlConfig: {
          entityId: idp.entityId,
          ssoUrl: SSO_URL,
          ssoBinding: 'redirect',
          signingCertificates: [idp.certificatePem],
          nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
          signAuthnRequests: true,
          wantAssertionsSigned: true,
          wantResponseSigned: false,
          allowSha1: false,
          sloUrl: null,
          clockSkewSeconds: 60,
          subjectAttribute: null,
          usernameSource: 'email',
          attributes: {},
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  /** /auth → the login page → the SAML button → the IdP; returns the request. */
  const toIdp = async (browser: Browser) => {
    const auth = await browser.get(authorizeUrl(REALM));
    expect(auth.status).toBe(302);
    const page = await browser.get(auth.headers['location'] as string);
    expect(page.status).toBe(200);
    const button = new RegExp(
      `href="(/realms/${REALM}/broker/${ALIAS}/login[^"]*)"`,
    ).exec(page.text);
    expect(button).not.toBeNull();
    const href = (button as RegExpExecArray)[1]
      .replaceAll('&#x3D;', '=')
      .replaceAll('&amp;', '&');
    return startAtIdp(browser, href);
  };

  /** The broker login link → the start link → the AuthnRequest at the IdP. */
  const startAtIdp = async (browser: Browser, loginHref: string) => {
    const toStart = await browser.get(loginHref);
    expect(toStart.status).toBe(302);
    const startUrl = toStart.headers['location'] as string;
    expect(startUrl).toMatch(
      new RegExp(`^/realms/${REALM}/broker/${ALIAS}/saml/start\\?h=`),
    );
    const toIdpRes = await browser.get(startUrl);
    expect(toIdpRes.status).toBe(302);
    expect(browser.jar.has(SAML_BROKER_COOKIE)).toBe(true);
    expect(browser.raw.get(SAML_BROKER_COOKIE)).toMatch(/HttpOnly/i);
    expect(browser.raw.get(SAML_BROKER_COOKIE)).toMatch(/SameSite=Lax/i);
    const url = new URL(toIdpRes.headers['location'] as string);
    expect(`${url.origin}${url.pathname}`).toBe(SSO_URL);
    expect(url.searchParams.get('SigAlg')).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    );
    expect(url.searchParams.get('Signature')).toBeTruthy();
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest') as string, 'base64'),
    ).toString('utf-8');
    expect(xml).toContain(`AssertionConsumerServiceURL="${sp().acsUrl}"`);
    expect(xml).toContain(`<saml:Issuer>${sp().entityId}</saml:Issuer>`);
    return {
      requestId: /ID="([^"]+)"/.exec(xml)![1],
      relayState: url.searchParams.get('RelayState') as string,
    };
  };

  /** What the fake IdP posts back for `requestId`. */
  const idpResponse = (
    requestId: string,
    over: Partial<FakeResponseOptions> = {},
  ) =>
    encodeResponse(
      responseXml({
        idp,
        spEntityId: sp().entityId,
        acsUrl: sp().acsUrl,
        requestId,
        attributes: {
          email: ['jane.saml@example.test'],
          firstName: ['Jane'],
          lastName: ['Saml'],
        },
        ...over,
      }),
    );

  /** The IdP's cross-site POST: it carries no cookies. */
  const postToAcs = (samlResponse: string, relayState: string) =>
    request(app.getHttpServer())
      .post(`/realms/${REALM}/broker/${ALIAS}/saml/acs`)
      .type('form')
      .send({ SAMLResponse: samlResponse, RelayState: relayState });

  it('publishes the SP metadata with the entity ID, ACS URL and signing certificate', async () => {
    const res = await request(app.getHttpServer()).get(
      `/realms/${REALM}/broker/${ALIAS}/saml/metadata`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/samlmetadata\+xml/);
    expect(res.text).toContain(`entityID="${sp().entityId}"`);
    expect(res.text).toContain(`Location="${sp().acsUrl}"`);
    expect(res.text).toMatch(/<ds:X509Certificate>[A-Za-z0-9+/=]{200,}</);
    expect(res.text).toContain('AuthnRequestsSigned="true"');
  });

  it('signs a new user in through the IdP and links the account', async () => {
    const browser = new Browser(app);
    const { requestId, relayState } = await toIdp(browser);

    const acs = await postToAcs(
      idpResponse(requestId, { nameId: 'okta-user-1' }),
      relayState,
    );
    expect(acs.status).toBe(303);
    const complete = acs.headers['location'] as string;
    expect(complete).toMatch(
      new RegExp(`^/realms/${REALM}/broker/${ALIAS}/saml/complete\\?id=`),
    );

    const back = await browser.get(complete);
    const code = codeFrom(back.headers['location']);
    expect(browser.jar.has(SAML_BROKER_COOKIE)).toBe(false);

    const link = await ctx.prisma.federatedIdentity.findFirst({
      where: { externalUserId: 'okta-user-1' },
      include: { user: true },
    });
    expect(link?.user).toMatchObject({
      realmId: seeded.realm.id,
      email: 'jane.saml@example.test',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Saml',
    });

    const token = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: 'test-client',
        client_secret: 'test-client-secret',
      });
    expect(token.status).toBe(200);
    expect(token.body.access_token).toBeTruthy();

    // Signing in again uses the same account.
    const again = new Browser(app);
    const second = await toIdp(again);
    const acs2 = await postToAcs(
      idpResponse(second.requestId, { nameId: 'okta-user-1' }),
      second.relayState,
    );
    codeFrom(
      (await again.get(acs2.headers['location'] as string)).headers['location'],
    );
    expect(
      await ctx.prisma.federatedIdentity.count({
        where: { externalUserId: 'okta-user-1' },
      }),
    ).toBe(1);
  });

  it('links an existing account by its trusted email address', async () => {
    const user = await createUser(
      ctx.prisma,
      seeded.realm.id,
      `saml-user-${++userSeq}`,
    );
    const browser = new Browser(app);
    const { requestId, relayState } = await toIdp(browser);
    const acs = await postToAcs(
      idpResponse(requestId, {
        nameId: 'okta-existing-1',
        attributes: { email: [user.email as string] },
      }),
      relayState,
    );
    codeFrom(
      (await browser.get(acs.headers['location'] as string)).headers[
        'location'
      ],
    );
    const link = await ctx.prisma.federatedIdentity.findFirst({
      where: { externalUserId: 'okta-existing-1' },
    });
    expect(link?.userId).toBe(user.id);
  });

  it('refuses a replayed response', async () => {
    const browser = new Browser(app);
    const { requestId, relayState } = await toIdp(browser);
    const posted = idpResponse(requestId, { nameId: 'okta-replay' });
    expect((await postToAcs(posted, relayState)).status).toBe(303);
    const replay = await postToAcs(posted, relayState);
    expect(replay.status).toBe(400);
    expect(replay.text).toMatch(/already completed/);
  });

  it('refuses a response signed by another key, an XSW-tampered one and one for another request', async () => {
    const other = await makeFakeIdp(idp.entityId);
    const browser = new Browser(app);
    const { requestId, relayState } = await toIdp(browser);

    const forged = await postToAcs(
      idpResponse(requestId, { signingKeyPem: other.privateKeyPem }),
      relayState,
    );
    expect(forged.status).toBe(401);
    expect(forged.text).toMatch(/signature is not valid/);

    const tampered = await postToAcs(
      encodeResponse(
        Buffer.from(idpResponse(requestId), 'base64')
          .toString('utf-8')
          .replace('user-123', 'admin'),
      ),
      relayState,
    );
    expect(tampered.status).toBe(401);

    const otherRequest = await postToAcs(
      idpResponse('_not-our-request'),
      relayState,
    );
    expect(otherRequest.status).toBe(401);

    // The sign-in still works with the real answer.
    const ok = await postToAcs(idpResponse(requestId), relayState);
    expect(ok.status).toBe(303);
  });

  it('only the browser that started can finish the sign-in', async () => {
    const browser = new Browser(app);
    const { requestId, relayState } = await toIdp(browser);
    const acs = await postToAcs(
      idpResponse(requestId, { nameId: 'okta-csrf' }),
      relayState,
    );
    const elsewhere = await new Browser(app).get(
      acs.headers['location'] as string,
    );
    expect(elsewhere.status).toBe(403);
    expect(
      await ctx.prisma.federatedIdentity.count({
        where: { externalUserId: 'okta-csrf' },
      }),
    ).toBe(0);
  });

  it('refuses an unsolicited (IdP-initiated) response', async () => {
    const res = await postToAcs(idpResponse('_x', { inResponseTo: null }), '');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/IdP-initiated/);
  });

  describe('as a social step of a custom flow', () => {
    let restoreEnv: () => void;
    beforeAll(() => {
      restoreEnv = withRuntimeEnv('true');
    });
    afterAll(async () => {
      restoreEnv();
      await bindRealm(ctx.prisma, seeded.realm.id, null, false);
    });

    it('comes back into the login transaction', async () => {
      const steps: Steps = [
        {
          id: 'social',
          type: 'social',
          required: true,
          order: 1,
          config: { providerAlias: ALIAS },
        },
      ];
      const flow = await createFlow(
        ctx.prisma,
        seeded.realm.id,
        'saml-social',
        steps,
      );
      await bindRealm(ctx.prisma, seeded.realm.id, flow.id);

      const browser = new Browser(app);
      const auth = await browser.get(authorizeUrl(REALM));
      expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
      expect(browser.jar.has(TXN_COOKIE)).toBe(true);
      const page = await browser.get(`/realms/${REALM}/login`);
      expect(page.text).toContain('Okta SAML');

      const { requestId, relayState } = await startAtIdp(
        browser,
        `/realms/${REALM}/broker/${ALIAS}/login`,
      );
      const acs = await postToAcs(
        idpResponse(requestId, { nameId: 'okta-flow-1' }),
        relayState,
      );
      expect(acs.status).toBe(303);
      const back = await browser.get(acs.headers['location'] as string);
      codeFrom(back.headers['location']);
      expect(
        await ctx.prisma.federatedIdentity.count({
          where: { externalUserId: 'okta-flow-1' },
        }),
      ).toBe(1);
    });
  });
});
