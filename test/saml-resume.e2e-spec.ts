import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  PASSWORD,
  PASSWORD_TOTP,
  TXN_COOKIE,
  bindRealm,
  createFlow,
  createUser,
  enrolTotp,
  withRuntimeEnv,
} from './helpers/auth-flow';

/**
 * An SP-initiated SAML sign-in that has to sign in first (a password, a
 * second factor, a custom flow) answers the AuthnRequest afterwards. The
 * request waits server-side behind an opaque cookie, is answered once, and
 * its service provider and ACS URL are checked again when it is.
 */
describe('SAML resume after sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let userSeq = 0;

  const REALM = 'e2e-saml-resume';
  const SP_ENTITY = 'https://sp.example.test/metadata';
  const ACS = 'https://sp.example.test/acs';
  const SAML_COOKIE = 'IDENPLANE_SAML_REQUEST';

  /** An AuthnRequest as the SP sends it (HTTP-Redirect binding). */
  const authnRequestUrl = (id: string, relayState = 'rs-1') => {
    const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" AssertionConsumerServiceURL="${ACS}"><saml:Issuer>${SP_ENTITY}</saml:Issuer></samlp:AuthnRequest>`;
    const qs = new URLSearchParams({
      SAMLRequest: Buffer.from(xml).toString('base64'),
      RelayState: relayState,
    });
    return `/realms/${REALM}/protocol/saml?${qs.toString()}`;
  };

  /** The SAML response an auto-POST page carries, decoded. */
  const samlResponseOf = (html: string) => {
    expect(html).toContain(`action="${ACS}"`);
    const value = /name="SAMLResponse" value="([^"]+)"/.exec(html)?.[1];
    expect(value).toBeTruthy();
    return Buffer.from(value as string, 'base64').toString('utf-8');
  };

  const signInWithPassword = async (browser: Browser, username: string) => {
    const page = await browser.get(`/realms/${REALM}/login?saml=1`);
    expect(page.status).toBe(200);
    return browser.post(`/realms/${REALM}/login`, {
      username,
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
  };

  const newUser = () =>
    createUser(ctx.prisma, seeded.realm.id, `saml-user-${++userSeq}`);

  beforeAll(async () => {
    restoreEnv = withRuntimeEnv('true');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.samlServiceProvider.create({
      data: {
        realmId: seeded.realm.id,
        entityId: SP_ENTITY,
        name: 'Test SP',
        acsUrl: ACS,
        validRedirectUris: [],
      },
    });
  }, 30_000);

  afterEach(async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
  });

  afterAll(async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, null, false);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
    restoreEnv();
  });

  it('answers the AuthnRequest after a password sign-in, once', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    const id = `_${randomUUID()}`;

    const sso = await browser.get(authnRequestUrl(id, 'relay-xyz'));
    expect(sso.status).toBe(302);
    expect(sso.headers['location']).toBe(`/realms/${REALM}/login?saml=1`);
    // Only an opaque handle is in the browser, never the request itself.
    const handle = browser.jar.get(SAML_COOKIE) as string;
    expect(handle).toBeTruthy();
    expect(Buffer.from(handle, 'base64').toString('utf-8')).not.toContain(ACS);
    expect(browser.raw.get(SAML_COOKIE)).toMatch(/HttpOnly/i);
    expect(browser.raw.get(SAML_COOKIE)).toMatch(/Secure/i);
    expect(browser.raw.get(SAML_COOKIE)).toMatch(/SameSite=Lax/i);

    const login = await signInWithPassword(browser, user.username);
    expect(login.headers['location']).toBe(
      `/realms/${REALM}/protocol/saml/resume`,
    );

    const resumed = await browser.get(`/realms/${REALM}/protocol/saml/resume`);
    expect(resumed.status).toBe(200);
    const response = samlResponseOf(resumed.text);
    expect(response).toContain(`InResponseTo="${id}"`);
    expect(response).toContain(user.email as string);
    expect(resumed.text).toContain('value="relay-xyz"');
    expect(browser.jar.has(SAML_COOKIE)).toBe(false);

    // Answered once: replaying the old handle leads to the account page.
    const replay = new Browser(app);
    replay.jar.set(SAML_COOKIE, handle);
    for (const [k, v] of browser.jar)
      if (k !== SAML_COOKIE) replay.jar.set(k, v);
    const again = await replay.get(`/realms/${REALM}/protocol/saml/resume`);
    expect(again.status).toBe(302);
    expect(again.headers['location']).toBe(`/realms/${REALM}/account`);
  });

  it('answers it after the second factor', async () => {
    const user = await newUser();
    const totp = await enrolTotp(
      app,
      ctx.prisma,
      user.id,
      REALM,
      user.username,
    );
    const browser = new Browser(app);
    const id = `_${randomUUID()}`;
    await browser.get(authnRequestUrl(id));

    const login = await signInWithPassword(browser, user.username);
    expect(login.headers['location']).toBe(`/realms/${REALM}/totp`);
    const page = await browser.get(`/realms/${REALM}/totp`);
    const answered = await browser.post(`/realms/${REALM}/totp`, {
      code: await totp.code(),
      _csrf: csrfFrom(page.text),
    });
    expect(answered.headers['location']).toBe(
      `/realms/${REALM}/protocol/saml/resume`,
    );
    const resumed = await browser.get(answered.headers['location'] as string);
    expect(samlResponseOf(resumed.text)).toContain(`InResponseTo="${id}"`);
  });

  it('answers it after a custom flow (password, then TOTP)', async () => {
    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'saml-pw-totp',
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
    const id = `_${randomUUID()}`;
    await browser.get(authnRequestUrl(id));

    const login = await signInWithPassword(browser, user.username);
    expect(browser.jar.has(TXN_COOKIE)).toBe(true);
    expect(login.headers['location']).toBe(`/realms/${REALM}/totp`);
    const page = await browser.get(`/realms/${REALM}/totp`);
    const answered = await browser.post(`/realms/${REALM}/totp`, {
      code: await totp.code(),
      _csrf: csrfFrom(page.text),
    });
    expect(answered.headers['location']).toBe(
      `/realms/${REALM}/protocol/saml/resume`,
    );
    const resumed = await browser.get(answered.headers['location'] as string);
    expect(samlResponseOf(resumed.text)).toContain(`InResponseTo="${id}"`);
  });

  it('answers at once from an SSO session', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    await browser.get(authnRequestUrl(`_${randomUUID()}`));
    await signInWithPassword(browser, user.username);
    await browser.get(`/realms/${REALM}/protocol/saml/resume`);

    const id = `_${randomUUID()}`;
    const sso = await browser.get(authnRequestUrl(id));
    expect(sso.status).toBe(200);
    expect(samlResponseOf(sso.text)).toContain(`InResponseTo="${id}"`);
  });

  it('does not let a session weaker than the realm flow answer it', async () => {
    // A password-level session from before the realm was bound to a flow
    // that requires a second factor.
    const user = await newUser();
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/login`);
    await browser.post(`/realms/${REALM}/login`, {
      username: user.username,
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);

    const flow = await createFlow(
      ctx.prisma,
      seeded.realm.id,
      'saml-strong',
      PASSWORD_TOTP,
    );
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);

    const sso = await browser.get(authnRequestUrl(`_${randomUUID()}`));
    expect(sso.status).toBe(302);
    expect(sso.headers['location']).toBe(`/realms/${REALM}/login?saml=1`);
  });

  it('ignores a forged request cookie', async () => {
    const user = await newUser();
    const browser = new Browser(app);
    const forged = Buffer.from(
      JSON.stringify({
        requestId: '_x',
        issuer: SP_ENTITY,
        acsUrl: 'https://attacker.example.test/acs',
        relayState: '',
      }),
    ).toString('base64');
    browser.jar.set(SAML_COOKIE, forged);
    const page = await browser.get(`/realms/${REALM}/login`);
    const login = await browser.post(`/realms/${REALM}/login`, {
      username: user.username,
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(login.headers['location']).toBe(
      `/realms/${REALM}/protocol/saml/resume`,
    );
    const resumed = await browser.get(login.headers['location'] as string);
    expect(resumed.status).toBe(302);
    expect(resumed.headers['location']).toBe(`/realms/${REALM}/account`);
    expect(resumed.text ?? '').not.toContain('attacker.example.test');
  });
});
