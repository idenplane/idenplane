import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';

/**
 * The account console asks for the current password before a sensitive
 * change. Those checks count toward the realm's account lock exactly like
 * a sign-in: a stolen session must not be a password oracle limited only
 * by the per-IP rate limit.
 */
describe('Account console password checks and the account lock (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-account-console-lockout';
  const PASSWORD = 'TestPassword123!';
  const WRONG = 'WrongPassword999!';
  const MAX_FAILURES = 3;

  const signIn = async (): Promise<Browser> => {
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    const res = await browser.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(res.status).toBe(302);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);
    return browser;
  };

  const changePassword = async (browser: Browser, currentPassword: string) => {
    const page = await browser.get(`/realms/${REALM}/account`);
    expect(page.status).toBe(200);
    return browser.post(`/realms/${REALM}/account/password`, {
      currentPassword,
      newPassword: 'NewPassword456!',
      confirmPassword: 'NewPassword456!',
      _csrf: csrfFrom(page.text),
    });
  };

  const requestDeletion = async (browser: Browser, currentPassword: string) => {
    const page = await browser.get(`/realms/${REALM}/account/delete-account`);
    expect(page.status).toBe(200);
    return browser.post(`/realms/${REALM}/account/delete-account`, {
      currentPassword,
      _csrf: csrfFrom(page.text),
    });
  };

  const failures = () =>
    ctx.prisma.loginFailure.count({
      where: { realmId: seeded.realm.id, userId: seeded.user.id },
    });

  const unlock = async () => {
    await ctx.prisma.loginFailure.deleteMany({
      where: { realmId: seeded.realm.id, userId: seeded.user.id },
    });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { lockedUntil: null, enabled: true },
    });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: {
        bruteForceEnabled: true,
        maxLoginFailures: MAX_FAILURES,
        lockoutDuration: 300,
        failureResetTime: 300,
        permanentLockoutAfter: 0,
        passwordHistoryCount: 0,
      },
    });
  }, 30_000);

  beforeEach(unlock);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM } })
      .catch(() => undefined);
    await ctx.cleanup();
  });

  it('wrong current passwords are login failures and lock the account', async () => {
    const browser = await signIn();

    // The forms share one counter with the sign-in page.
    expect(
      (await changePassword(browser, WRONG)).headers['location'],
    ).toContain('error=');
    expect(
      (await requestDeletion(browser, WRONG)).headers['location'],
    ).toContain('error=');
    expect(await failures()).toBe(2);
    await changePassword(browser, WRONG);
    expect(await failures()).toBe(MAX_FAILURES);

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seeded.user.id },
    });
    expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    // Locked: even the right password is refused, the password unchanged,
    // and nothing more is counted.
    const res = await changePassword(browser, PASSWORD);
    expect(decodeURIComponent(res.headers['location'] as string)).toContain(
      'temporarily locked',
    );
    expect(await failures()).toBe(MAX_FAILURES);
    const after = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seeded.user.id },
    });
    expect(after.passwordHash).toBe(user.passwordHash);
    const deletion = await requestDeletion(browser, PASSWORD);
    expect(
      decodeURIComponent(deletion.headers['location'] as string),
    ).toContain('temporarily locked');
    expect(
      await ctx.prisma.pendingDeletion.count({
        where: { userId: seeded.user.id },
      }),
    ).toBe(0);

    // And the lock holds on the sign-in page too.
    const other = new Browser(app);
    const page = await other.get(`/realms/${REALM}/login`);
    const login = await other.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(other.jar.has('IDENPLANE_SESSION')).toBe(false);
    expect(login.status).not.toBe(500);
  });

  it('the right current password clears earlier failures', async () => {
    const browser = await signIn();
    await requestDeletion(browser, WRONG);
    expect(await failures()).toBe(1);

    const res = await changePassword(browser, PASSWORD);
    expect(res.headers['location']).toContain('success=');
    expect(await failures()).toBe(0);

    // Put the seeded password back for the other suites' assumptions.
    const page = await browser.get(`/realms/${REALM}/account`);
    await browser.post(`/realms/${REALM}/account/password`, {
      currentPassword: 'NewPassword456!',
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
  });
});
