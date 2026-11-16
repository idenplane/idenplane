import { pbkdf2Sync, randomBytes } from 'node:crypto';
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

/**
 * Users imported from a Keycloak realm export sign in with the password they
 * had in Keycloak, on the hosted login page and with the password grant, and
 * their hash is moved to Argon2id on that first sign-in.
 *
 * Before 0.11.0 the login page threw on a Keycloak PBKDF2 hash (and showed
 * argon2's error text), the password grant checked Argon2 only, and the
 * importer labelled every credential pbkdf2-sha256, so SHA-512 never worked.
 */
describe('Migrated Keycloak users sign in (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-migrated-logins';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const TOKEN_URL = `/realms/${REALM}/protocol/openid-connect/token`;
  // Test passwords only; never real credentials.
  const PASSWORDS: Record<string, string> = {
    'kc-sha256-page': 'kc-sha256-example-1',
    'kc-sha512-page': 'kc-sha512-example-1',
    'kc-sha256-grant': 'kc-sha256-example-2',
    'kc-sha512-grant': 'kc-sha512-example-2',
    'kc-legacy-sha512': 'kc-legacy-example-3',
    'kc-lockout': 'kc-lockout-example-4',
  };
  const WRONG = 'wrong-example-password';

  /** A Keycloak 7+ password credential (secretData / credentialData). */
  const keycloakCredential = (
    password: string,
    algorithm: 'pbkdf2-sha256' | 'pbkdf2-sha512',
    iterations: number,
  ) => {
    const salt = randomBytes(16);
    const digest = algorithm === 'pbkdf2-sha256' ? 'sha256' : 'sha512';
    const hash = pbkdf2Sync(password, salt, iterations, 64, digest);
    return {
      type: 'password',
      userLabel: 'My password',
      createdDate: 1700000000000,
      secretData: JSON.stringify({
        value: hash.toString('base64'),
        salt: salt.toString('base64'),
        additionalParameters: {},
      }),
      credentialData: JSON.stringify({
        hashIterations: iterations,
        algorithm,
        additionalParameters: {},
      }),
    };
  };

  /** The pre-6.0 export format: fields directly on the credential. */
  const legacyCredential = (password: string, iterations: number) => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512');
    return {
      type: 'password',
      hashedSaltedValue: hash.toString('base64'),
      salt: salt.toString('base64'),
      hashIterations: iterations,
      algorithm: 'pbkdf2-sha512',
    };
  };

  const keycloakUser = (
    username: string,
    credential: Record<string, unknown>,
  ) => ({
    username,
    email: `${username}@example.com`,
    enabled: true,
    emailVerified: true,
    credentials: [credential],
  });

  const userRow = (username: string) =>
    ctx.prisma.user.findUniqueOrThrow({
      where: { realmId_username: { realmId: seeded.realm.id, username } },
    });

  const passwordGrant = (username: string, password: string) =>
    request(app.getHttpServer()).post(TOKEN_URL).type('form').send({
      grant_type: 'password',
      client_id: 'test-client',
      client_secret: 'test-client-secret',
      username,
      password,
    });

  const signInOnPage = async (username: string, password: string) => {
    const browser = new Browser(app);
    const query = new URLSearchParams({
      client_id: 'test-client',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid',
      state: 'xyz',
    }).toString();
    const page = await browser.get(`/realms/${REALM}/login?${query}`);
    expect(page.status).toBe(200);
    const form: Record<string, string> = {
      username,
      password,
      _csrf: csrfFrom(page.text),
    };
    for (const m of page.text.matchAll(
      /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
    )) {
      if (m[1] !== '_csrf') form[m[1]] = m[2].replaceAll('&amp;', '&');
    }
    return browser.post(`/realms/${REALM}/login`, form);
  };

  const loginErrorOf = (res: request.Response): string | null => {
    expect(res.status).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toMatch(new RegExp(`^/realms/${REALM}/login\\?`));
    return new URL(location, 'http://x').searchParams.get('error');
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
        maxLoginFailures: 3,
        lockoutDuration: 60,
        failureResetTime: 300,
        permanentLockoutAfter: 0,
      },
    });

    // A Keycloak realm export with users only, imported into the realm
    // (an existing realm is reused, as the importer documents).
    const res = await request(app.getHttpServer())
      .post('/admin/migration/keycloak')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        targetRealm: REALM,
        data: {
          realm: 'keycloak-source',
          enabled: true,
          users: [
            keycloakUser(
              'kc-sha256-page',
              keycloakCredential(
                PASSWORDS['kc-sha256-page'],
                'pbkdf2-sha256',
                27500,
              ),
            ),
            keycloakUser(
              'kc-sha512-page',
              keycloakCredential(
                PASSWORDS['kc-sha512-page'],
                'pbkdf2-sha512',
                210000,
              ),
            ),
            keycloakUser(
              'kc-sha256-grant',
              keycloakCredential(
                PASSWORDS['kc-sha256-grant'],
                'pbkdf2-sha256',
                27500,
              ),
            ),
            keycloakUser(
              'kc-sha512-grant',
              keycloakCredential(
                PASSWORDS['kc-sha512-grant'],
                'pbkdf2-sha512',
                210000,
              ),
            ),
            keycloakUser(
              'kc-legacy-sha512',
              legacyCredential(PASSWORDS['kc-legacy-sha512'], 27500),
            ),
            keycloakUser(
              'kc-lockout',
              keycloakCredential(
                PASSWORDS['kc-lockout'],
                'pbkdf2-sha512',
                1000,
              ),
            ),
            keycloakUser('kc-unsupported', {
              type: 'password',
              secretData: JSON.stringify({
                value: 'aGFzaA==',
                salt: 'c2FsdA==',
              }),
              credentialData: JSON.stringify({
                hashIterations: 1,
                algorithm: 'md5-custom',
              }),
            }),
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.summary.users.created).toBe(7);
    expect(res.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'user',
          message: expect.stringContaining(
            `User 'kc-unsupported': Keycloak password algorithm "md5-custom" is not supported`,
          ),
        }),
      ]),
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('the importer records the real algorithm and a self-describing hash', async () => {
    const sha256 = await userRow('kc-sha256-page');
    expect(sha256.passwordAlgorithm).toBe('pbkdf2-sha256');
    expect(sha256.passwordHash).toMatch(/^\$pbkdf2-sha256\$i=27500,l=64\$/);
    const sha512 = await userRow('kc-sha512-page');
    expect(sha512.passwordAlgorithm).toBe('pbkdf2-sha512');
    expect(sha512.passwordHash).toMatch(/^\$pbkdf2-sha512\$i=210000,l=64\$/);
    const legacy = await userRow('kc-legacy-sha512');
    expect(legacy.passwordAlgorithm).toBe('pbkdf2-sha512');
    const unsupported = await userRow('kc-unsupported');
    expect(unsupported.passwordHash).toBeNull();
  });

  describe.each([
    ['PBKDF2-SHA256', 'kc-sha256-page'],
    ['PBKDF2-SHA512', 'kc-sha512-page'],
    ['PBKDF2-SHA512, legacy export format', 'kc-legacy-sha512'],
  ])('hosted login page, %s', (_label, username) => {
    it('a wrong password is "Invalid credentials", with no library text', async () => {
      const res = await signInOnPage(username, WRONG);
      expect(loginErrorOf(res)).toBe('Invalid credentials');
      expect(res.headers['location']).not.toMatch(/pchstr|argon2/i);
      // Not upgraded on a failure.
      expect((await userRow(username)).passwordHash).not.toMatch(/^\$argon2/);
      await ctx.prisma.loginFailure.deleteMany({
        where: { realmId: seeded.realm.id },
      });
    });

    it('the Keycloak password signs in and the hash becomes Argon2id', async () => {
      const res = await signInOnPage(username, PASSWORDS[username]);
      expect(res.status).toBe(302);
      const location = new URL(res.headers['location'] as string);
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(location.searchParams.get('code')).toBeTruthy();

      const row = await userRow(username);
      expect(row.passwordAlgorithm).toBe('argon2');
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);

      // And the same password keeps working against the new hash.
      const again = await signInOnPage(username, PASSWORDS[username]);
      expect(
        new URL(again.headers['location'] as string).searchParams.get('code'),
      ).toBeTruthy();
    });
  });

  describe.each([
    ['PBKDF2-SHA256', 'kc-sha256-grant'],
    ['PBKDF2-SHA512', 'kc-sha512-grant'],
  ])('password grant, %s', (_label, username) => {
    it('a wrong password is invalid_grant', async () => {
      const res = await passwordGrant(username, WRONG);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
      expect(res.body.error_description).toBe('Invalid credentials');
      await ctx.prisma.loginFailure.deleteMany({
        where: { realmId: seeded.realm.id },
      });
    });

    it('the Keycloak password gets tokens and the hash becomes Argon2id', async () => {
      const res = await passwordGrant(username, PASSWORDS[username]);
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();

      const row = await userRow(username);
      expect(row.passwordAlgorithm).toBe('argon2');
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);

      const again = await passwordGrant(username, PASSWORDS[username]);
      expect(again.status).toBe(200);
    });
  });

  describe('lockout and brute-force protection with a migrated hash', () => {
    const username = 'kc-lockout';

    it('wrong passwords are counted and lock the account', async () => {
      const user = await userRow(username);
      for (let i = 0; i < 3; i++) {
        const res = await passwordGrant(username, WRONG);
        expect(res.status).toBe(400);
      }
      const failures = await ctx.prisma.loginFailure.count({
        where: { realmId: seeded.realm.id, userId: user.id },
      });
      expect(failures).toBeGreaterThanOrEqual(3);
    });

    it('a locked account refuses the right password everywhere, and the hash is not upgraded', async () => {
      const grant = await passwordGrant(username, PASSWORDS[username]);
      expect(grant.status).toBe(400);
      expect(grant.body.error_description).toMatch(/locked/i);

      const page = await signInOnPage(username, PASSWORDS[username]);
      expect(loginErrorOf(page)).toMatch(/locked/i);

      const row = await userRow(username);
      expect(row.passwordHash).toMatch(/^\$pbkdf2-sha512\$/);
      expect(row.passwordAlgorithm).toBe('pbkdf2-sha512');
    });

    it('after the lock is lifted the right password signs in, resets the counter and upgrades the hash', async () => {
      const user = await userRow(username);
      await ctx.prisma.loginFailure.deleteMany({
        where: { realmId: seeded.realm.id, userId: user.id },
      });
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: null },
      });

      // One wrong attempt, then the right one: the counter is reset.
      expect((await passwordGrant(username, WRONG)).status).toBe(400);
      const ok = await passwordGrant(username, PASSWORDS[username]);
      expect(ok.status).toBe(200);
      expect(
        await ctx.prisma.loginFailure.count({
          where: { realmId: seeded.realm.id, userId: user.id },
        }),
      ).toBe(0);
      expect((await userRow(username)).passwordHash).toMatch(/^\$argon2id\$/);
    });
  });
});
