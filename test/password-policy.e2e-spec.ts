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
import { VerificationService } from '../src/verification/verification.service.js';

describe('Password Policy (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-password-policy-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  /** Helper: create a user via the admin API. */
  const createUser = async (username: string, password: string) => {
    const res = await withKey(
      request(app.getHttpServer())
        .post(`/admin/realms/${REALM_NAME}/users`)
        .send({
          username,
          email: `${username}@example.com`,
          firstName: 'Policy',
          lastName: 'Test',
          password,
        }),
    );
    return res;
  };

  /** Helper: reset a user's password via the admin API. */
  const resetPassword = async (userId: string, password: string) => {
    return withKey(
      request(app.getHttpServer())
        .put(`/admin/realms/${REALM_NAME}/users/${userId}/reset-password`)
        .send({ password }),
    );
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM_NAME);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── HELPER: reset all policy fields to defaults ──────────────────────

  const resetPolicy = () =>
    ctx.prisma.realm.update({
      where: { name: REALM_NAME },
      data: {
        passwordMinLength: 8,
        passwordRequireUppercase: false,
        passwordRequireLowercase: false,
        passwordRequireDigits: false,
        passwordRequireSpecialChars: false,
        passwordHistoryCount: 0,
      },
    });

  // ─── 1. MINIMUM LENGTH ENFORCEMENT ────────────────────────────────────

  describe('Minimum password length', () => {
    beforeAll(async () => {
      await resetPolicy();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: { passwordMinLength: 12 },
      });
    });

    it('should reject a password shorter than the minimum length', async () => {
      const res = await createUser('policy-user-short', 'Short1!');
      // Expect 400 (validation) or 422
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should accept a password that meets the minimum length', async () => {
      const res = await createUser('policy-user-ok-len', 'LongEnoughPass1!');
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');

      // Cleanup
      await ctx.prisma.user
        .delete({ where: { id: res.body.id } })
        .catch(() => {});
    });

    it('should reject a password of exactly min-1 characters', async () => {
      // minLength=12; send an 11-char password
      const res = await createUser('policy-user-11', 'Elevenchar1');
      expect([400, 422]).toContain(res.status);
    });

    it('should accept a password of exactly min characters', async () => {
      // minLength=12; send a 12-char password with required chars (none extra required here)
      const res = await createUser('policy-user-12', 'Twelvechar12');
      expect(res.status).toBe(201);

      await ctx.prisma.user
        .delete({ where: { id: res.body.id } })
        .catch(() => {});
    });
  });

  // ─── 2. CHARACTER REQUIREMENTS ────────────────────────────────────────

  describe('Character requirements', () => {
    let policyUserId: string;

    beforeAll(async () => {
      await resetPolicy();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          passwordMinLength: 8,
          passwordRequireUppercase: true,
          passwordRequireLowercase: true,
          passwordRequireDigits: true,
          passwordRequireSpecialChars: true,
        },
      });
    });

    it('should reject a password missing uppercase letters', async () => {
      const res = await createUser('policy-user-noup', 'lowercase1!xx');
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should reject a password missing lowercase letters', async () => {
      const res = await createUser('policy-user-nolw', 'UPPERCASE1!XX');
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should reject a password missing digits', async () => {
      const res = await createUser('policy-user-nodig', 'NoDigitsHere!');
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should reject a password missing special characters', async () => {
      const res = await createUser('policy-user-nosp', 'NoSpecial123');
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should accept a password that satisfies all character requirements', async () => {
      const res = await createUser('policy-user-full', 'ComplexP@ss1');
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      policyUserId = res.body.id;
    });

    afterAll(async () => {
      if (policyUserId) {
        await ctx.prisma.user
          .delete({ where: { id: policyUserId } })
          .catch(() => {});
      }
    });
  });

  // ─── 3. PASSWORD HISTORY (PREVENT REUSE) ─────────────────────────────

  describe('Password history — prevent reuse', () => {
    let historyUserId: string;
    const initialPassword = 'FirstPass1!';
    const secondPassword = 'SecondPass2@';
    const thirdPassword = 'ThirdPass3#';

    beforeAll(async () => {
      await resetPolicy();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          passwordMinLength: 8,
          passwordHistoryCount: 2,
        },
      });

      // Create the test user
      const res = await createUser('policy-history-user', initialPassword);
      expect(res.status).toBe(201);
      historyUserId = res.body.id;
    });

    afterAll(async () => {
      if (historyUserId) {
        await ctx.prisma.user
          .delete({ where: { id: historyUserId } })
          .catch(() => {});
      }
    });

    it('should allow setting a new password that is not in history', async () => {
      const res = await resetPassword(historyUserId, secondPassword);
      expect(res.status).toBe(204);
    });

    it('should allow a second new password', async () => {
      const res = await resetPassword(historyUserId, thirdPassword);
      expect(res.status).toBe(204);
    });

    it('should reject reuse of a password in history (passwordHistoryCount=2)', async () => {
      // secondPassword is within the last 2 passwords
      const res = await resetPassword(historyUserId, secondPassword);
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should reject reuse of the most recent password', async () => {
      const res = await resetPassword(historyUserId, thirdPassword);
      expect([400, 422]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });

    it('should allow setting a completely new password not in history', async () => {
      const res = await resetPassword(historyUserId, 'BrandNewPass4$');
      expect(res.status).toBe(204);
    });
  });

  // ─── 3b. AN IMPORTED PASSWORD IS HISTORY TOO ──────────────────────────
  //
  // A user imported from another IdP keeps the imported hash, which was
  // never written to the history. It must count as used: at the first
  // change (as the current password) and at the next ones (recorded when
  // it is replaced). The unlabelled legacy PBKDF2 row (imported before
  // 0.11.0) can only be checked with the user's passwordAlgorithm.

  describe('Password history — an imported password counts', () => {
    const imported = 'ImportedPass1!';
    const other = 'OtherPass2@';
    const userIds: string[] = [];

    const pbkdf2 = (password: string, digest: 'sha256' | 'sha512') => {
      const salt = randomBytes(16);
      const hash = pbkdf2Sync(password, salt, 1000, 64, digest);
      return { salt: salt.toString('base64'), hash: hash.toString('base64') };
    };
    /** Keycloak PBKDF2-SHA512 as the pre-0.11.0 importer stored it. */
    const legacyRow = (password: string) => {
      const { salt, hash } = pbkdf2(password, 'sha512');
      return ['1000', salt, hash].join('$');
    };
    /** The self-describing format the importers write since 0.11.0. */
    const labelled = (password: string) => {
      const { salt, hash } = pbkdf2(password, 'sha256');
      return ['', 'pbkdf2-sha256', 'i=1000', salt, hash].join('$');
    };

    beforeAll(async () => {
      await resetPolicy();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: { passwordMinLength: 8, passwordHistoryCount: 3 },
      });
    });

    afterAll(async () => {
      await ctx.prisma.user
        .deleteMany({ where: { id: { in: userIds } } })
        .catch(() => {});
    });

    it.each([
      ['an unlabelled legacy PBKDF2 row', legacyRow, 'pbkdf2-sha256'],
      ['a self-describing PBKDF2 hash', labelled, 'pbkdf2-sha256'],
    ])(
      '%s: refused as the new password, now and after one change',
      async (_label, hashOf, passwordAlgorithm) => {
        const n = userIds.length;
        const user = await ctx.prisma.user.create({
          data: {
            realmId: seeded.realm.id,
            username: `imported-${n}`,
            email: `imported-${n}@example.com`,
            passwordHash: hashOf(imported),
            passwordAlgorithm,
          },
        });
        userIds.push(user.id);
        expect(
          await ctx.prisma.passwordHistory.count({
            where: { userId: user.id },
          }),
        ).toBe(0);

        // The first change: the imported (current) password is refused.
        const same = await resetPassword(user.id, imported);
        expect([400, 422]).toContain(same.status);

        // A different one is accepted, and the imported hash is kept in
        // the history with its algorithm.
        expect((await resetPassword(user.id, other)).status).toBe(204);
        const rows = await ctx.prisma.passwordHistory.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({ passwordAlgorithm });

        // Changing back to the imported password is still refused.
        const back = await resetPassword(user.id, imported);
        expect([400, 422]).toContain(back.status);
      },
    );

    it('a reset by email refuses the imported password and keeps the link usable', async () => {
      const user = await ctx.prisma.user.create({
        data: {
          realmId: seeded.realm.id,
          username: 'imported-reset',
          email: 'imported-reset@example.com',
          passwordHash: legacyRow(imported),
          passwordAlgorithm: 'pbkdf2-sha512',
        },
      });
      userIds.push(user.id);
      const token = await app
        .get(VerificationService)
        .createToken(user.id, 'password_reset', 3600);
      const browser = new Browser(app);
      const submit = async (password: string) => {
        const form = await browser.get(
          `/realms/${REALM_NAME}/reset-password?token=${token}`,
        );
        expect(form.status).toBe(200);
        return browser.post(`/realms/${REALM_NAME}/reset-password`, {
          token,
          password,
          confirmPassword: password,
          _csrf: csrfFrom(form.text),
        });
      };

      const refused = await submit(imported);
      expect(refused.status).toBe(302);
      expect(refused.headers['location']).toContain('/reset-password?token=');
      expect(
        decodeURIComponent(refused.headers['location'] as string),
      ).toContain('used recently');
      // The link was not used up: the user picks another password with it.
      const accepted = await submit(other);
      expect(accepted.headers['location']).toContain('/login?info=');
      expect(
        await ctx.prisma.passwordHistory.count({ where: { userId: user.id } }),
      ).toBe(2);
    });
  });

  // ─── 4. PASSWORD POLICY — NO RESTRICTIONS ────────────────────────────

  describe('When no password policy is enforced', () => {
    beforeAll(async () => {
      await resetPolicy();
      // Use the default 8-char minimum with no other requirements
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          passwordMinLength: 8,
        },
      });
    });

    it('should accept a simple password that meets only the minimum length', async () => {
      const res = await createUser('policy-simple-user', 'simple12');
      expect(res.status).toBe(201);

      await ctx.prisma.user
        .delete({ where: { id: res.body.id } })
        .catch(() => {});
    });
  });
});
