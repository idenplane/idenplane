import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, type TestContext, type SeededRealm } from './setup';
import {
  createThemeViewEngine,
  type ThemeViewEngine,
} from '../src/theme/theme-view-engine.js';
import { registerHandlebarsHelpers } from '../src/theme/handlebars-helpers.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { EmailService } from '../src/email/email.service.js';

describe('Safe theme pages and realm-bound action links (e2e)', () => {
  let ctx: TestContext, owner: SeededRealm, foreign: SeededRealm;
  let verification: VerificationService, crypto: CryptoService;
  let send: jest.SpyInstance;
  const csrf = (html: string) => {
    const value = /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1];
    expect(value).toBeTruthy();
    return value!;
  };
  // The in-process transport is HTTP, so superagent drops Secure cookies.
  // Forward the cookie emitted with each form explicitly, as a TLS browser does.
  const cookies = (response: request.Response) =>
    (response.headers['set-cookie'] as unknown as string[]).map(
      (cookie) => cookie.split(';')[0],
    );
  beforeAll(async () => {
    ctx = await createTestApp();
    const app = ctx.app.getHttpAdapter().getInstance() as {
      set: (name: string, value: string) => void;
      engine: (extension: string, engine: ThemeViewEngine) => void;
    };
    app.set('views', join(process.cwd(), 'themes'));
    app.engine('hbs', createThemeViewEngine(join(process.cwd(), 'themes')));
    app.set('view engine', 'hbs');
    registerHandlebarsHelpers();
    owner = await ctx.seedTestRealm('theme-view-owner');
    foreign = await ctx.seedTestRealm('theme-view-foreign');
    verification = ctx.app.get(VerificationService);
    crypto = ctx.app.get(CryptoService);
    const email = ctx.app.get(EmailService);
    jest.spyOn(email, 'isConfigured').mockResolvedValue(true);
    send = jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx?.cleanup();
  });

  it('renders inherited midnight pages with Arabic direction, realm branding, escaping and a working layout', async () => {
    await ctx.prisma.realm.update({
      where: { id: owner.realm.id },
      data: {
        loginTheme: 'midnight',
        displayName: '<script>realm-name</script>',
      },
    });
    const response = await request(ctx.app.getHttpServer()).get(
      `/realms/${owner.name}/forgot-password?lang=ar&error=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain('<!DOCTYPE html>');
    expect(response.text).toContain('lang="ar"');
    expect(response.text).toContain('dir="rtl"');
    expect(response.text).toContain('midnight');
    expect(response.text).toContain('name="_csrf"');
    expect(response.text).toContain('&lt;img');
    expect(response.text).not.toContain('<img src=x');
    expect(response.text).not.toContain('<script>realm-name');
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self' 'nonce-",
    );
    await ctx.prisma.realm.update({
      where: { id: owner.realm.id },
      data: { loginTheme: 'idenplane', displayName: 'Theme test realm' },
    });
  });
  it('renders a reset email locally, resets the password through the form and rejects token replay', async () => {
    const browser = request.agent(ctx.app.getHttpServer());
    const start = await browser.get(`/realms/${owner.name}/forgot-password`);
    const submitted = await browser
      .post(`/realms/${owner.name}/forgot-password`)
      .set('Cookie', cookies(start))
      .type('form')
      .send({ email: owner.user.email, _csrf: csrf(start.text) });
    expect(submitted.status).toBe(302);
    expect(send).toHaveBeenCalled();
    const html = send.mock.calls.at(-1)![3] as string;
    const escapedLink = /href="([^"]*reset-password\?token(?:=|&#x3D;)[^"]+)"/.exec(
      html,
    )?.[1];
    expect(escapedLink).toBeTruthy();
    // Decode the attribute once; `&amp;` goes last so it cannot form new entities.
    const link = new URL(
      escapedLink!.replaceAll('&#x3D;', '=').replaceAll('&amp;', '&'),
    );
    const form = await browser.get(link.pathname + link.search);
    expect(form.status).toBe(200);
    expect(form.text).toContain('name="confirmPassword"');
    const password = 'NewThemePassword123!';
    const changed = await browser
      .post(link.pathname)
      .set('Cookie', cookies(form))
      .type('form')
      .send({
        token: link.searchParams.get('token'),
        password,
        confirmPassword: password,
        _csrf: csrf(form.text),
      });
    expect(changed.status).toBe(302);
    expect(changed.headers['location']).toContain('/login?info=');
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: owner.user.id },
    });
    expect(await crypto.verifyPassword(user.passwordHash!, password)).toBe(
      true,
    );
    const replay = await browser.get(link.pathname + link.search);
    expect(replay.text).toContain('invalid or has expired');
  });
  it('does not display or consume a reset token through another realm', async () => {
    const token = await verification.createToken(
      owner.user.id,
      'password_reset',
      3600,
    );
    const browser = request.agent(ctx.app.getHttpServer());
    const other = await browser.get(
      `/realms/${foreign.name}/reset-password?token=${token}`,
    );
    expect(other.status).toBe(200);
    expect(other.text).toContain('invalid or has expired');
    expect(other.text).not.toContain(`value="${token}"`);
    const csrfForm = await browser.get(
      `/realms/${foreign.name}/forgot-password`,
    );
    const before = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: owner.user.id },
    });
    const changed = await browser
      .post(`/realms/${foreign.name}/reset-password`)
      .set('Cookie', cookies(csrfForm))
      .type('form')
      .send({
        token,
        password: 'ForeignPassword123!',
        confirmPassword: 'ForeignPassword123!',
        _csrf: csrf(csrfForm.text),
      });
    expect(changed.status).toBe(302);
    expect(changed.headers['location']).toContain('invalid');
    expect(
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: owner.user.id },
        })
      ).passwordHash,
    ).toBe(before.passwordHash);
    expect(
      await verification.validateToken(token, 'password_reset', owner.realm.id),
    ).toEqual({ userId: owner.user.id });
  });
  it('keeps email verification links bound to the owner realm', async () => {
    await ctx.prisma.user.update({
      where: { id: owner.user.id },
      data: { emailVerified: false },
    });
    const token = await verification.createToken(
      owner.user.id,
      'email_verification',
      3600,
    );
    const other = await request(ctx.app.getHttpServer()).get(
      `/realms/${foreign.name}/verify-email?token=${token}`,
    );
    expect(other.status).toBe(200);
    expect(
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: owner.user.id },
        })
      ).emailVerified,
    ).toBe(false);
    const valid = await request(ctx.app.getHttpServer()).get(
      `/realms/${owner.name}/verify-email?token=${token}`,
    );
    expect(valid.status).toBe(200);
    expect(
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: owner.user.id },
        })
      ).emailVerified,
    ).toBe(true);
  });
  it('does not accept an expired-password change token in another realm', async () => {
    const token = await verification.createToken(
      owner.user.id,
      'change_password',
      600,
    );
    const browser = request.agent(ctx.app.getHttpServer());
    const form = await browser.get(`/realms/${foreign.name}/forgot-password`);
    const result = await browser
      .post(`/realms/${foreign.name}/change-password`)
      .set('Cookie', cookies(form))
      .type('form')
      .send({
        token,
        currentPassword: 'NewThemePassword123!',
        newPassword: 'WrongRealmChange123!',
        confirmPassword: 'WrongRealmChange123!',
        _csrf: csrf(form.text),
      });
    expect(result.status).toBe(302);
    expect(result.headers['location']).toContain('expired');
    expect(
      await verification.validateToken(
        token,
        'change_password',
        owner.realm.id,
      ),
    ).toEqual({ userId: owner.user.id });
  });
});
