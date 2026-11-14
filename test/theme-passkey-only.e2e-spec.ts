import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import {
  ACR,
  PASSWORD,
  TXN_COOKIE,
  authorizeUrl,
  bindRealm,
  codeFrom,
  createFlow,
  createUser,
  idTokenClaims,
  registerPasskey,
  withRuntimeEnv,
} from './helpers/auth-flow';

/**
 * A custom theme whose login.hbs ignores `passkeyOnly`: on a passkey-only
 * step of a bound flow it still shows its password form. Posting it must
 * bring the user back to the passkey step with a message, not end the
 * sign-in, and the theme is flagged with a warning when it is loaded.
 */

const THEME = `e2e-ignores-passkey-${process.pid}`;
const THEME_DIR = join(process.cwd(), 'themes', THEME);
const REALM = 'e2e-theme-passkey-only';
const RP_ID = 'localhost';

// Every password form, whatever the step: the flag is never read.
const LOGIN_HBS = `{{!-- passkeyOnly is deliberately ignored --}}
{{#if error}}<div class="auth-error">{{error}}</div>{{/if}}
<form method="POST" action="/realms/{{realmName}}/login" class="auth-form">
  <input type="text" name="username" value="{{login_hint}}">
  <input type="password" name="password">
  <input type="hidden" name="_csrf" value="{{csrfToken}}">
  <button type="submit">Sign in</button>
</form>
`;

describe('Custom theme ignoring passkeyOnly (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let user: { id: string; username: string };
  let authenticator: SoftAuthenticator;

  beforeAll(async () => {
    // Themes are read when the application starts.
    mkdirSync(join(THEME_DIR, 'login', 'templates'), { recursive: true });
    writeFileSync(
      join(THEME_DIR, 'theme.json'),
      JSON.stringify({
        name: THEME,
        displayName: 'E2E: ignores passkeyOnly',
        description: 'Overrides login.hbs without reading the flag',
        parent: 'idenplane',
        colors: {},
        types: { login: { css: [] } },
      }),
    );
    writeFileSync(
      join(THEME_DIR, 'login', 'templates', 'login.hbs'),
      LOGIN_HBS,
    );

    restoreEnv = withRuntimeEnv('true');
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { webAuthnEnabled: true, loginTheme: THEME },
    });
    const flow = await createFlow(ctx.prisma, seeded.realm.id, 'pk-only', [
      { id: 'pk', type: 'webauthn', required: true, order: 1 },
    ]);
    await bindRealm(ctx.prisma, seeded.realm.id, flow.id);

    user = await createUser(ctx.prisma, seeded.realm.id, 'passkey-user');
    authenticator = new SoftAuthenticator(RP_ID, expectedOrigin(RP_ID));
    await registerPasskey(ctx.prisma, user.id, seeded.realm.id, authenticator);
  }, 30_000);

  afterAll(async () => {
    await bindRealm(ctx.prisma, seeded.realm.id, null, false).catch(() => {});
    await ctx?.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx?.cleanup();
    restoreEnv();
    rmSync(THEME_DIR, { recursive: true, force: true });
  });

  it('lists the theme with a warning, and the built-in themes without', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/realms/themes')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(200);
    const themes = res.body as Array<{ name: string; warnings: string[] }>;
    const custom = themes.find((t) => t.name === THEME);
    expect(custom?.warnings).toEqual([
      expect.stringMatching(/login\.hbs does not read passkeyOnly/),
    ]);
    for (const name of ['idenplane', 'midnight']) {
      expect(themes.find((t) => t.name === name)?.warnings).toEqual([]);
    }
  });

  it('a password posted on the passkey-only step shows the step again with a message, and the passkey still signs in', async () => {
    const browser = new Browser(app);
    const auth = await browser.get(authorizeUrl(REALM));
    expect(auth.headers['location']).toBe(`/realms/${REALM}/login`);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    // The theme ignores the flag: its password form is on the page.
    expect(page.text).toContain('name="password"');
    const txnBefore = browser.jar.get(TXN_COOKIE);
    expect(txnBefore).toBeTruthy();

    const posted = await browser.post(`/realms/${REALM}/login`, {
      username: user.username,
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(posted.status).toBe(302);
    const location = new URL(posted.headers['location'], 'https://idp.test');
    expect(location.pathname).toBe(`/realms/${REALM}/login`);
    expect(location.searchParams.get('error')).toBe(
      'This step signs in with a passkey. Use your passkey to continue.',
    );
    // The sign-in was not ended: same transaction, still in the browser.
    expect(browser.jar.get(TXN_COOKIE)).toBe(txnBefore);

    const again = await browser.get(`${location.pathname}${location.search}`);
    expect(again.status).toBe(200);
    expect(again.text).toContain(
      'This step signs in with a passkey. Use your passkey to continue.',
    );

    const options = await browser.postJson(
      `/realms/${REALM}/webauthn/authenticate/options`,
      {},
    );
    expect(options.status).toBe(200);
    const verified = await browser.postJson(
      `/realms/${REALM}/webauthn/authenticate/verify`,
      { response: authenticator.assert(options.body as RequestOptions) },
    );
    expect(verified.status).toBe(200);
    const { redirectUrl } = verified.body as { redirectUrl: string };
    const claims = await idTokenClaims(app, REALM, codeFrom(redirectUrl));
    expect(claims['sub']).toBe(user.id);
    expect(claims['acr']).toBe(ACR.webauthn);
  });

  it('answers a wrong password exactly as the right one: the password is never checked', async () => {
    const browser = new Browser(app);
    await browser.get(authorizeUrl(REALM));
    const page = await browser.get(`/realms/${REALM}/login`);
    const posted = await browser.post(`/realms/${REALM}/login`, {
      username: user.username,
      password: 'definitely-wrong',
      _csrf: csrfFrom(page.text),
    });
    // The same answer for a wrong password as for the right one.
    expect(
      new URL(posted.headers['location'], 'https://idp.test').searchParams.get(
        'error',
      ),
    ).toBe('This step signs in with a passkey. Use your passkey to continue.');
  });
});
