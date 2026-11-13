/**
 * CAPTCHA enforcement on self-registration (API and hosted form).
 *
 * A tiny HTTP server started here plays both providers' `siteverify`
 * endpoints; CAPTCHA_VERIFY_ENDPOINTS is overridden to point at it, so no
 * request leaves the machine.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import {
  CAPTCHA_VERIFY_ENDPOINTS,
  type CaptchaVerifyEndpoints,
} from '../src/captcha/captcha.service';
import { EmailService } from '../src/email/email.service';
import { CacheService } from '../src/cache/cache.service';
import { SECRET_PLACEHOLDER } from '../src/realms/secret-placeholder';

/** Escapes every regular-expression metacharacter in `text`. */
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

const REALM = 'captcha-e2e';
const PASSWORD = 'Str0ng!Passw0rd#';
const HOSTED_HOST = new URL(process.env['BASE_URL'] ?? 'http://localhost:3000')
  .hostname;

/** What the fake provider received, per call. */
interface Received {
  provider: 'recaptcha' | 'hcaptcha';
  form: URLSearchParams;
}

/**
 * Tokens the fake provider understands. `good` passes for either provider
 * (reCAPTCHA: action register, score 0.9) and reports the hosted host.
 */
function verdict(provider: Received['provider'], token: string | null) {
  switch (token) {
    case 'good':
      return provider === 'recaptcha'
        ? {
            success: true,
            score: 0.9,
            action: 'register',
            hostname: HOSTED_HOST,
          }
        : { success: true, hostname: HOSTED_HOST };
    case 'low-score':
      return {
        success: true,
        score: 0.1,
        action: 'register',
        hostname: HOSTED_HOST,
      };
    case 'wrong-action':
      return {
        success: true,
        score: 0.9,
        action: 'login',
        hostname: HOSTED_HOST,
      };
    case 'other-host':
      return {
        success: true,
        score: 0.9,
        action: 'register',
        hostname: 'evil.example',
      };
    default:
      return { success: false, 'error-codes': ['invalid-input-response'] };
  }
}

describe('CAPTCHA enforcement on registration (e2e)', () => {
  let ctx: TestContext;
  let fake: Server;
  let received: Received[];

  const admin = () => request(ctx.app.getHttpServer());
  const configure = async (body: Record<string, unknown>) =>
    admin()
      .put(`/admin/realms/${REALM}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send(body);
  const enableHcaptcha = () =>
    configure({
      captchaEnabled: true,
      captchaProvider: 'hcaptcha',
      hcaptchaSiteKey: 'hc-site-key',
      hcaptchaSecretKey: 'hc-secret',
    });
  const enableRecaptcha = () =>
    configure({
      captchaEnabled: true,
      captchaProvider: 'recaptcha',
      recaptchaSiteKey: 'rc-site-key',
      recaptchaSecretKey: 'rc-secret',
      captchaScoreThreshold: 0.5,
    });
  const disable = () => configure({ captchaEnabled: false });

  let seq = 0;
  const newUser = () => {
    seq += 1;
    return {
      username: `cap-user-${seq}`,
      email: `cap-user-${seq}@example.com`,
    };
  };
  const userExists = async (username: string) =>
    (await ctx.prisma.user.count({
      where: { realm: { name: REALM }, username },
    })) > 0;
  const apiRegister = (body: Record<string, unknown>, query = '') =>
    admin()
      .post(`/realms/${REALM}/registration/register${query}`)
      .send({ password: PASSWORD, ...body });

  beforeAll(async () => {
    received = [];
    fake = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        const provider = req.url?.startsWith('/hcaptcha')
          ? 'hcaptcha'
          : 'recaptcha';
        const form = new URLSearchParams(raw);
        received.push({ provider, form });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(verdict(provider, form.get('response'))));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const { port } = fake.address() as AddressInfo;
    const endpoints: CaptchaVerifyEndpoints = {
      recaptcha: `http://127.0.0.1:${port}/recaptcha/siteverify`,
      hcaptcha: `http://127.0.0.1:${port}/hcaptcha/siteverify`,
      timeoutMs: 5000,
    };

    ctx = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(CAPTCHA_VERIFY_ENDPOINTS).useValue(endpoints),
    });
    useThemeViews(ctx.app);
    const email = ctx.app.get(EmailService);
    jest.spyOn(email, 'isConfigured').mockResolvedValue(false);
    jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);

    await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { name: REALM },
      data: { registrationAllowed: true },
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx?.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx?.cleanup();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });

  beforeEach(() => {
    received = [];
  });

  describe('admin validation', () => {
    afterAll(() => disable());

    it('refuses to enable CAPTCHA without a provider', async () => {
      const res = await configure({ captchaEnabled: true });
      expect(res.status).toBe(400);
    });

    it('refuses an unknown provider', async () => {
      const res = await configure({
        captchaEnabled: true,
        captchaProvider: 'none',
      });
      expect(res.status).toBe(400);
    });

    it('refuses to enable hCaptcha without its site key or secret', async () => {
      const noSite = await configure({
        captchaEnabled: true,
        captchaProvider: 'hcaptcha',
        hcaptchaSecretKey: 'x',
      });
      expect(noSite.status).toBe(400);
      expect(JSON.stringify(noSite.body)).toContain('hcaptchaSiteKey');
      const noSecret = await configure({
        captchaEnabled: true,
        captchaProvider: 'hcaptcha',
        hcaptchaSiteKey: 'x',
      });
      expect(noSecret.status).toBe(400);
    });

    it('accepts a complete configuration', async () => {
      expect((await enableHcaptcha()).status).toBe(200);
    });

    it('returns the secret as the placeholder and keeps it when the placeholder is sent back', async () => {
      await enableHcaptcha();
      const got = await admin()
        .get(`/admin/realms/${REALM}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY);
      expect(got.status).toBe(200);
      expect(got.body.hcaptchaSecretKey).toBe(SECRET_PLACEHOLDER);
      expect(JSON.stringify(got.body)).not.toContain('hc-secret');

      // Round-trip what the admin console sends back.
      const saved = await configure({
        captchaEnabled: true,
        captchaProvider: 'hcaptcha',
        hcaptchaSiteKey: 'hc-site-key',
        hcaptchaSecretKey: got.body.hcaptchaSecretKey,
      });
      expect(saved.status).toBe(200);
      received = [];
      const res = await apiRegister({ ...newUser(), captchaToken: 'good' });
      expect(res.status).toBe(201);
      expect(received[0].form.get('secret')).toBe('hc-secret');
    });
  });

  describe('API: POST /realms/:realm/registration/register', () => {
    describe('with hCaptcha enabled', () => {
      beforeAll(() => enableHcaptcha());
      afterAll(() => disable());

      it('answers 400 without a token and creates no user', async () => {
        const user = newUser();
        const res = await apiRegister(user);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('CAPTCHA required');
        expect(received).toHaveLength(0);
        expect(await userExists(user.username)).toBe(false);
      });

      it('answers 400 for a token the provider rejects', async () => {
        const user = newUser();
        const res = await apiRegister({ ...user, captchaToken: 'bad' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('CAPTCHA verification failed');
        expect(await userExists(user.username)).toBe(false);
      });

      it('registers with a good token, verified with the realm secret and client IP', async () => {
        const user = newUser();
        const res = await apiRegister({ ...user, captchaToken: 'good' });
        expect(res.status).toBe(201);
        expect(await userExists(user.username)).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0].provider).toBe('hcaptcha');
        expect(received[0].form.get('secret')).toBe('hc-secret');
        expect(received[0].form.get('sitekey')).toBe('hc-site-key');
        expect(received[0].form.get('remoteip')).toBeTruthy();
      });

      it.each([
        '?captchaProvider=none',
        '?captchaProvider=',
        '?captchaProvider=recaptcha',
      ])('cannot be bypassed with %s', async (query) => {
        const user = newUser();
        const res = await apiRegister(user, query);
        expect(res.status).toBe(400);
        expect(await userExists(user.username)).toBe(false);
        // The provider still comes from the realm.
        const withToken = await apiRegister(
          { ...newUser(), captchaToken: 'good' },
          query,
        );
        expect(withToken.status).toBe(201);
        expect(received.every((r) => r.provider === 'hcaptcha')).toBe(true);
      });
    });

    describe('with reCAPTCHA v3 enabled', () => {
      beforeAll(() => enableRecaptcha());
      afterAll(() => disable());

      it('registers with a good token', async () => {
        const user = newUser();
        const res = await apiRegister({ ...user, captchaToken: 'good' });
        expect(res.status).toBe(201);
        expect(received[0].provider).toBe('recaptcha');
        expect(received[0].form.get('secret')).toBe('rc-secret');
      });

      it.each(['low-score', 'wrong-action', 'bad'])(
        'answers 400 for a %s token',
        async (token) => {
          const user = newUser();
          const res = await apiRegister({ ...user, captchaToken: token });
          expect(res.status).toBe(400);
          expect(await userExists(user.username)).toBe(false);
        },
      );

      it('does not check the hostname on the API (callers host their own widget)', async () => {
        const res = await apiRegister({
          ...newUser(),
          captchaToken: 'other-host',
        });
        expect(res.status).toBe(201);
      });
    });

    describe('with CAPTCHA disabled', () => {
      it('registers without a token and calls no provider', async () => {
        const user = newUser();
        const res = await apiRegister(user);
        expect(res.status).toBe(201);
        expect(received).toHaveLength(0);
      });
    });

    describe('with CAPTCHA enabled but its configuration incomplete', () => {
      afterAll(() => disable());

      it('refuses registration (fails closed)', async () => {
        // A realm stored before admin validation existed.
        await ctx.prisma.realm.update({
          where: { name: REALM },
          data: {
            captchaEnabled: true,
            captchaProvider: 'hcaptcha',
            hcaptchaSiteKey: null,
            hcaptchaSecretKey: null,
          },
        });
        const realm = await ctx.prisma.realm.findUniqueOrThrow({
          where: { name: REALM },
        });
        await ctx.app.get(CacheService).invalidateRealmCache(realm.id, REALM);
        const user = newUser();
        const res = await apiRegister({ ...user, captchaToken: 'good' });
        expect(res.status).toBe(503);
        expect(JSON.stringify(res.body)).not.toMatch(/secret|site ?key/i);
        expect(received).toHaveLength(0);
        expect(await userExists(user.username)).toBe(false);
      });
    });
  });

  describe('hosted registration form', () => {
    const fillForm = (
      html: string,
      user: { username: string; email: string },
    ) => ({
      _csrf: csrfFrom(html),
      username: user.username,
      email: user.email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });

    describe('with hCaptcha enabled', () => {
      beforeAll(() => enableHcaptcha());
      afterAll(() => disable());

      it('renders the hCaptcha widget with the site key', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('class="h-captcha"');
        expect(res.text).toContain('data-sitekey="hc-site-key"');
        expect(res.text).toContain('src="https://js.hcaptcha.com/1/api.js"');
        expect(res.text).not.toContain('hc-secret');
      });

      it('renders the widget in the midnight theme too', async () => {
        await ctx.prisma.realm.update({
          where: { name: REALM },
          data: { loginTheme: 'midnight' },
        });
        try {
          const res = await new Browser(ctx.app).get(
            `/realms/${REALM}/register`,
          );
          expect(res.text).toContain('midnight');
          expect(res.text).toContain('class="h-captcha"');
          expect(res.text).toContain('data-sitekey="hc-site-key"');
        } finally {
          await ctx.prisma.realm.update({
            where: { name: REALM },
            data: { loginTheme: 'idenplane' },
          });
        }
      });

      it('allows exactly the hCaptcha origins in the CSP of the register page', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        const csp = res.headers['content-security-policy'] as string;
        const hc = 'https://hcaptcha.com https://*.hcaptcha.com';
        expect(csp).toMatch(
          new RegExp(
            `script-src 'self' 'nonce-[^']+' ${escapeRegExp(hc)};`,
          ),
        );
        expect(csp).toContain(`frame-src 'self' ${hc}`);
        expect(csp).toContain(`connect-src 'self' ${hc}`);
        expect(csp).toContain(`https://fonts.googleapis.com ${hc}`);
        expect(csp).not.toContain('google.com/recaptcha');
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
      });

      it('does not widen the CSP of other pages', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/login`);
        const csp = res.headers['content-security-policy'] as string;
        expect(csp).not.toContain('hcaptcha');
        expect(csp).not.toContain('frame-src');
      });

      it.each(['login', 'register'])(
        "keeps helmet's anti-framing directives on the %s page",
        async (page) => {
          const res = await new Browser(ctx.app).get(
            `/realms/${REALM}/${page}`,
          );
          const csp = res.headers['content-security-policy'] as string;
          expect(csp).toContain("frame-ancestors 'none'");
          expect(csp).toContain("object-src 'none'");
          expect(csp).toContain("base-uri 'self'");
          expect(csp).toContain("script-src-attr 'none'");
          expect(csp).not.toContain('form-action');
        },
      );

      it('re-renders with an error and creates no user when the token is missing', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(
          `/realms/${REALM}/register`,
          fillForm(page.text, user),
        );
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain(
          `/realms/${REALM}/register?error=`,
        );
        expect(res.headers.location).not.toContain(PASSWORD);
        const again = await browser.get(res.headers.location as string);
        expect(again.text).toContain('CAPTCHA required');
        expect(again.text).toContain('class="h-captcha"');
        expect(received).toHaveLength(0);
        expect(await userExists(user.username)).toBe(false);
      });

      it('re-renders with an error for a rejected token', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          'h-captcha-response': 'bad',
        });
        expect(res.status).toBe(302);
        const again = await browser.get(res.headers.location as string);
        expect(again.text).toContain('CAPTCHA verification failed');
        expect(await userExists(user.username)).toBe(false);
      });

      it("ignores a token sent in the other provider's field", async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          'g-recaptcha-response': 'good',
        });
        expect(res.headers.location).toContain('register?error=');
        expect(await userExists(user.username)).toBe(false);
      });

      it('creates the user with a good token', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          'h-captcha-response': 'good',
        });
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain(`/realms/${REALM}/login?info=`);
        expect(await userExists(user.username)).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0].form.get('response')).toBe('good');
      });
    });

    describe('with reCAPTCHA v3 enabled', () => {
      beforeAll(() => enableRecaptcha());
      afterAll(() => disable());

      it('loads reCAPTCHA with the site key and a hidden token field', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        expect(res.text).toMatch(
          /src="https:\/\/www\.google\.com\/recaptcha\/api\.js\?render(=|&#x3D;)rc-site-key"/,
        );
        expect(res.text).toContain('data-captcha-site-key="rc-site-key"');
        expect(res.text).toContain('name="g-recaptcha-response"');
        expect(res.text).toContain(
          "grecaptcha.execute(siteKey, { action: 'register' })",
        );
        // The submit script is a nonce'd inline block allowed by the CSP.
        const nonce = /'nonce-([^']+)'/.exec(
          res.headers['content-security-policy'] as string,
        )?.[1];
        expect(nonce).toBeTruthy();
        // Handlebars HTML-escapes the base64 padding in the attribute.
        const attr = nonce!.replace(/=/g, '&#x3D;');
        expect(res.text).toContain(`<script nonce="${attr}">`);
      });

      it('allows exactly the reCAPTCHA origins in the CSP of the register page', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        const csp = res.headers['content-security-policy'] as string;
        const rc =
          'https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/';
        expect(csp).toContain(`${rc};`);
        expect(csp).toContain(`frame-src 'self' ${rc}`);
        expect(csp).toContain("connect-src 'self';");
        expect(csp).not.toContain('hcaptcha');
      });

      it('creates the user with a good token', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          'g-recaptcha-response': 'good',
        });
        expect(res.headers.location).toContain('/login?info=');
        expect(await userExists(user.username)).toBe(true);
      });

      it('refuses a token solved on another host', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          'g-recaptcha-response': 'other-host',
        });
        expect(res.headers.location).toContain('register?error=');
        expect(await userExists(user.username)).toBe(false);
      });
    });

    describe('with CAPTCHA disabled', () => {
      it('renders no widget and keeps the base CSP', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        expect(res.text).not.toContain('h-captcha');
        expect(res.text).not.toContain('recaptcha');
        const csp = res.headers['content-security-policy'] as string;
        expect(csp).not.toContain('hcaptcha');
        expect(csp).not.toContain('google.com');
        expect(csp).not.toContain('frame-src');
        expect(csp).toContain("connect-src 'self';");
      });

      it('creates the user without a token', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(
          `/realms/${REALM}/register`,
          fillForm(page.text, user),
        );
        expect(res.headers.location).toContain('/login?info=');
        expect(await userExists(user.username)).toBe(true);
        expect(received).toHaveLength(0);
      });
    });

    describe('midnight theme with terms of service and a custom attribute', () => {
      beforeAll(async () => {
        const realm = await ctx.prisma.realm.update({
          where: { name: REALM },
          data: {
            loginTheme: 'midnight',
            termsOfServiceUrl: 'https://example.com/terms',
          },
        });
        await ctx.prisma.customAttribute.create({
          data: {
            realmId: realm.id,
            name: 'department',
            displayName: 'Department',
            type: 'text',
            required: true,
            showOnRegistration: true,
          },
        });
        await ctx.app.get(CacheService).invalidateRealmCache(realm.id, REALM);
      });
      afterAll(async () => {
        const realm = await ctx.prisma.realm.update({
          where: { name: REALM },
          data: { loginTheme: 'idenplane', termsOfServiceUrl: null },
        });
        await ctx.prisma.customAttribute.deleteMany({
          where: { realmId: realm.id, name: 'department' },
        });
        await ctx.app.get(CacheService).invalidateRealmCache(realm.id, REALM);
      });

      it('renders the terms checkbox and the custom attribute', async () => {
        const res = await new Browser(ctx.app).get(`/realms/${REALM}/register`);
        expect(res.text).toContain('midnight');
        expect(res.text).toContain('name="terms_accepted"');
        expect(res.text).toContain('href="https://example.com/terms"');
        expect(res.text).toContain('name="attr_department"');
      });

      it('refuses a registration without accepting the terms', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          attr_department: 'Sales',
        });
        expect(res.headers.location).toContain('register?error=');
        expect(await userExists(user.username)).toBe(false);
      });

      it('registers with the terms accepted and the attribute filled in', async () => {
        const browser = new Browser(ctx.app);
        const page = await browser.get(`/realms/${REALM}/register`);
        const user = newUser();
        const res = await browser.post(`/realms/${REALM}/register`, {
          ...fillForm(page.text, user),
          terms_accepted: '1',
          attr_department: 'Sales',
        });
        expect(res.headers.location).toContain('/login?info=');
        expect(await userExists(user.username)).toBe(true);
        const stored = await ctx.prisma.userAttribute.findFirst({
          where: {
            user: { username: user.username, realm: { name: REALM } },
            attribute: { name: 'department' },
          },
        });
        expect(stored?.value).toBe('Sales');
      });
    });
  });
});
