import { PasswordPolicyService } from './password-policy.service.js';
import { PasswordVerificationService } from '../crypto/password-verification.service.js';
import {
  PASSWORD,
  WRONG,
  bcryptHash,
  legacyKeycloakRow,
  pbkdf2,
  pbkdf2Hash,
  realPasswordVerifier,
} from '../crypto/__mocks__/password-hash-fixtures.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm, User } from '@prisma/client';

describe('PasswordPolicyService', () => {
  let service: PasswordPolicyService;
  let prisma: MockPrismaService;
  let crypto: {
    verifyPassword: jest.Mock;
    hashPassword: jest.Mock;
    generateSecret: jest.Mock;
    sha256: jest.Mock;
    argon2HashNeedsUpgrade: jest.Mock;
  };

  const baseRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    passwordMinLength: 8,
    passwordRequireUppercase: false,
    passwordRequireLowercase: false,
    passwordRequireDigits: false,
    passwordRequireSpecialChars: false,
    passwordMaxAgeDays: 0,
  } as Realm;

  const baseUser: User = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'alice',
    passwordChangedAt: null,
  } as User;

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = {
      verifyPassword: jest.fn(),
      hashPassword: jest.fn(),
      generateSecret: jest.fn(),
      sha256: jest.fn(),
      argon2HashNeedsUpgrade: jest.fn().mockReturnValue(false),
    };
    // The real format dispatcher over a mocked Argon2 check.
    service = new PasswordPolicyService(
      prisma as any,
      new PasswordVerificationService(crypto as any, prisma as any),
    );
  });

  // ─── validate ───────────────────────────────────────────────

  describe('validate', () => {
    it('should accept a password that meets all requirements', () => {
      const realm = {
        ...baseRealm,
        passwordMinLength: 8,
        passwordRequireUppercase: true,
        passwordRequireLowercase: true,
        passwordRequireDigits: true,
        passwordRequireSpecialChars: true,
      } as Realm;

      const result = service.validate(realm, 'Abcdef1!');

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should reject a password shorter than minimum length', () => {
      const realm = { ...baseRealm, passwordMinLength: 10 };

      const result = service.validate(realm, 'short');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must be at least 10 characters',
      );
    });

    it('should accept a password that exactly meets minimum length', () => {
      const realm = { ...baseRealm, passwordMinLength: 5 };

      const result = service.validate(realm, 'abcde');

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should reject when uppercase is required but missing', () => {
      const realm = {
        ...baseRealm,
        passwordRequireUppercase: true,
      } as Realm;

      const result = service.validate(realm, 'alllowercase');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter',
      );
    });

    it('should accept when uppercase is required and present', () => {
      const realm = {
        ...baseRealm,
        passwordRequireUppercase: true,
      } as Realm;

      const result = service.validate(realm, 'hasUpperA');

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should reject when lowercase is required but missing', () => {
      const realm = {
        ...baseRealm,
        passwordRequireLowercase: true,
      } as Realm;

      const result = service.validate(realm, 'ALLUPPERCASE');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one lowercase letter',
      );
    });

    it('should reject when digits are required but missing', () => {
      const realm = {
        ...baseRealm,
        passwordRequireDigits: true,
      } as Realm;

      const result = service.validate(realm, 'NoDigitsHere');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one digit',
      );
    });

    it('should accept when digits are required and present', () => {
      const realm = {
        ...baseRealm,
        passwordRequireDigits: true,
      } as Realm;

      const result = service.validate(realm, 'HasDigit9');

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should reject when special chars are required but missing', () => {
      const realm = {
        ...baseRealm,
        passwordRequireSpecialChars: true,
      } as Realm;

      const result = service.validate(realm, 'NoSpecial123');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one special character',
      );
    });

    it('should accept when special chars are required and present', () => {
      const realm = {
        ...baseRealm,
        passwordRequireSpecialChars: true,
      } as Realm;

      const result = service.validate(realm, 'Special@1');

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should return multiple errors when multiple requirements fail', () => {
      const realm = {
        ...baseRealm,
        passwordMinLength: 20,
        passwordRequireUppercase: true,
        passwordRequireDigits: true,
        passwordRequireSpecialChars: true,
      } as Realm;

      const result = service.validate(realm, 'short');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors).toContain(
        'Password must be at least 20 characters',
      );
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter',
      );
      expect(result.errors).toContain(
        'Password must contain at least one digit',
      );
      expect(result.errors).toContain(
        'Password must contain at least one special character',
      );
    });

    it('should pass when no policy constraints are enabled', () => {
      const realm = { ...baseRealm, passwordMinLength: 0 };

      const result = service.validate(realm, '');

      expect(result).toEqual({ valid: true, errors: [] });
    });
  });

  // ─── checkHistory ───────────────────────────────────────────

  describe('checkHistory', () => {
    it('should return false immediately when historyCount <= 0', async () => {
      const result = await service.checkHistory(
        'user-1',
        'realm-1',
        'password',
        0,
      );

      expect(result).toBe(false);
      expect(prisma.passwordHistory.findMany).not.toHaveBeenCalled();
    });

    it('should return false when historyCount is negative', async () => {
      const result = await service.checkHistory(
        'user-1',
        'realm-1',
        'password',
        -5,
      );

      expect(result).toBe(false);
      expect(prisma.passwordHistory.findMany).not.toHaveBeenCalled();
    });

    it('should return true when password matches a history entry', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          passwordHash: '$argon2id$hash1',
          userId: 'user-1',
          realmId: 'realm-1',
        },
        {
          id: 'h2',
          passwordHash: '$argon2id$hash2',
          userId: 'user-1',
          realmId: 'realm-1',
        },
      ]);
      crypto.verifyPassword
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await service.checkHistory(
        'user-1',
        'realm-1',
        'oldpass',
        5,
      );

      expect(result).toBe(true);
      expect(crypto.verifyPassword).toHaveBeenCalledTimes(2);
      expect(crypto.verifyPassword).toHaveBeenCalledWith(
        '$argon2id$hash1',
        'oldpass',
      );
      expect(crypto.verifyPassword).toHaveBeenCalledWith(
        '$argon2id$hash2',
        'oldpass',
      );
    });

    it('should return false when password does not match any history entry', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          passwordHash: '$argon2id$hash1',
          userId: 'user-1',
          realmId: 'realm-1',
        },
      ]);
      crypto.verifyPassword.mockResolvedValue(false);

      const result = await service.checkHistory(
        'user-1',
        'realm-1',
        'newpass',
        5,
      );

      expect(result).toBe(false);
    });

    it('should return false when there is no history', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      const result = await service.checkHistory(
        'user-1',
        'realm-1',
        'newpass',
        5,
      );

      expect(result).toBe(false);
      expect(crypto.verifyPassword).not.toHaveBeenCalled();
    });

    it('should query with correct take parameter from historyCount', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.checkHistory('user-1', 'realm-1', 'pass', 3);

      expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', realmId: 'realm-1' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { passwordHash: true, passwordAlgorithm: true },
      });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', realmId: 'realm-1' },
        select: { passwordHash: true, passwordAlgorithm: true },
      });
    });

    it('checks the current hash once when it is also the newest history row', async () => {
      prisma.user.findFirst.mockResolvedValue({
        passwordHash: '$argon2id$current',
        passwordAlgorithm: 'argon2',
      });
      prisma.passwordHistory.findMany.mockResolvedValue([
        { passwordHash: '$argon2id$current', passwordAlgorithm: null },
        { passwordHash: '$argon2id$older', passwordAlgorithm: null },
      ]);
      crypto.verifyPassword.mockResolvedValue(false);

      await service.checkHistory('user-1', 'realm-1', 'pass', 3);

      expect(crypto.verifyPassword.mock.calls.map((c) => c[0])).toEqual([
        '$argon2id$current',
        '$argon2id$older',
      ]);
    });

    it('checks the current hash first when the history does not have it', async () => {
      prisma.user.findFirst.mockResolvedValue({
        passwordHash: '$argon2id$rehashed-at-sign-in',
        passwordAlgorithm: 'argon2',
      });
      prisma.passwordHistory.findMany.mockResolvedValue([
        { passwordHash: '$argon2id$older', passwordAlgorithm: null },
      ]);
      crypto.verifyPassword.mockResolvedValueOnce(true);

      await expect(
        service.checkHistory('user-1', 'realm-1', 'pass', 3),
      ).resolves.toBe(true);
      expect(crypto.verifyPassword).toHaveBeenCalledWith(
        '$argon2id$rehashed-at-sign-in',
        'pass',
      );
    });
  });

  // ─── checkHistory: entries in a migrated format ─────────────

  describe('checkHistory with bcrypt and PBKDF2 entries (real hashes)', () => {
    let real: PasswordPolicyService;
    let updateMany: jest.Mock;

    beforeEach(() => {
      const verifier = realPasswordVerifier();
      updateMany = verifier.updateMany;
      real = new PasswordPolicyService(prisma as any, verifier.passwords);
    });

    const history = (...hashes: string[]) =>
      prisma.passwordHistory.findMany.mockResolvedValue(
        hashes.map((passwordHash, i) => ({
          id: `h${i}`,
          passwordHash,
          userId: 'user-1',
          realmId: 'realm-1',
        })),
      );

    it.each([
      ['bcrypt', () => bcryptHash()],
      ['PBKDF2-SHA256', () => pbkdf2Hash('sha256')],
      ['PBKDF2-SHA512', () => pbkdf2Hash('sha512')],
    ])(
      'a %s entry detects reuse and rejects nothing else',
      async (_label, make) => {
        history(make());
        await expect(
          real.checkHistory('user-1', 'realm-1', PASSWORD, 5),
        ).resolves.toBe(true);
        await expect(
          real.checkHistory('user-1', 'realm-1', WRONG, 5),
        ).resolves.toBe(false);
        // A history row is never rewritten.
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('finds the reused password behind entries in other formats', async () => {
      history(bcryptHash(WRONG), pbkdf2Hash('sha256', WRONG), bcryptHash());
      await expect(
        real.checkHistory('user-1', 'realm-1', PASSWORD, 5),
      ).resolves.toBe(true);
    });

    it.each([
      ['a bcrypt prefix with garbage', '$2b$10$garbage'],
      ['a PBKDF2 prefix with garbage', '$pbkdf2-sha256$i=1000$$'],
      ['an unknown scheme', '{SSHA}c2FsdA=='],
      ['the plaintext password itself', PASSWORD],
    ])('a malformed entry (%s) never matches', async (_label, stored) => {
      history(stored);
      await expect(
        real.checkHistory('user-1', 'realm-1', PASSWORD, 5),
      ).resolves.toBe(false);
    });

    it('an unlabelled legacy PBKDF2 row (iterations$salt$hash) matches with the algorithm stored next to it', async () => {
      const { salt, hash, iterations } = pbkdf2('sha256');
      const row = `${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
      prisma.passwordHistory.findMany.mockResolvedValue([
        { passwordHash: row, passwordAlgorithm: 'pbkdf2-sha256' },
      ]);
      await expect(
        real.checkHistory('user-1', 'realm-1', PASSWORD, 5),
      ).resolves.toBe(true);
      await expect(
        real.checkHistory('user-1', 'realm-1', WRONG, 5),
      ).resolves.toBe(false);
    });

    it('an unlabelled legacy PBKDF2 row without an algorithm never matches', async () => {
      const { salt, hash, iterations } = pbkdf2('sha256');
      history(
        `${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`,
      );
      await expect(
        real.checkHistory('user-1', 'realm-1', PASSWORD, 5),
      ).resolves.toBe(false);
    });

    // ─── the current, imported password ────────────────────────
    //
    // An imported user has no history at all: their imported hash is the
    // only record of the password, and it must count.

    it.each([
      ['bcrypt (Auth0, Zitadel)', () => bcryptHash(), 'bcrypt'],
      [
        'PBKDF2-SHA256 (Keycloak since 0.11.0)',
        () => pbkdf2Hash('sha256'),
        'pbkdf2-sha256',
      ],
      [
        'an unlabelled legacy Keycloak row (imported before 0.11.0)',
        () => legacyKeycloakRow(),
        'pbkdf2-sha256',
      ],
    ])(
      'the current %s hash counts with no history at all',
      async (_label, make, passwordAlgorithm) => {
        prisma.user.findFirst.mockResolvedValue({
          passwordHash: make(),
          passwordAlgorithm,
        });
        history();

        await expect(
          real.checkHistory('user-1', 'realm-1', PASSWORD, 3),
        ).resolves.toBe(true);
        await expect(
          real.checkHistory('user-1', 'realm-1', WRONG, 3),
        ).resolves.toBe(false);
        // Checked, never rewritten.
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('a user with no password has nothing to reuse', async () => {
      prisma.user.findFirst.mockResolvedValue({
        passwordHash: null,
        passwordAlgorithm: null,
      });
      history();
      await expect(
        real.checkHistory('user-1', 'realm-1', PASSWORD, 3),
      ).resolves.toBe(false);
    });
  });

  // ─── recordHistory ──────────────────────────────────────────

  describe('recordHistory', () => {
    it('should return immediately when historyCount <= 0', async () => {
      await service.recordHistory('user-1', 'realm-1', 'hash', 0);

      expect(prisma.passwordHistory.createMany).not.toHaveBeenCalled();
    });

    it('should return immediately when historyCount is negative', async () => {
      await service.recordHistory('user-1', 'realm-1', 'hash', -1);

      expect(prisma.passwordHistory.createMany).not.toHaveBeenCalled();
    });

    it('should create a new history entry', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5);

      expect(prisma.passwordHistory.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user-1',
            realmId: 'realm-1',
            passwordHash: 'newhash',
            passwordAlgorithm: null,
            createdAt: expect.any(Date),
          },
        ],
      });
    });

    it('records the replaced hash first, with its algorithm, when the history does not have it', async () => {
      prisma.passwordHistory.findFirst.mockResolvedValue(null);
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5, {
        passwordHash: '1000$c2FsdA==$aGFzaA==',
        passwordAlgorithm: 'pbkdf2-sha256',
      });

      const { data } = prisma.passwordHistory.createMany.mock.calls[0][0];
      expect(data).toEqual([
        expect.objectContaining({
          passwordHash: '1000$c2FsdA==$aGFzaA==',
          passwordAlgorithm: 'pbkdf2-sha256',
        }),
        expect.objectContaining({
          passwordHash: 'newhash',
          passwordAlgorithm: null,
        }),
      ]);
      // Strictly older, so the trim keeps the new one first.
      expect(data[0].createdAt.getTime()).toBeLessThan(
        data[1].createdAt.getTime(),
      );
    });

    it('does not record the replaced hash again when it is the newest entry', async () => {
      prisma.passwordHistory.findFirst.mockResolvedValue({
        passwordHash: '$argon2id$old',
      });
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5, {
        passwordHash: '$argon2id$old',
        passwordAlgorithm: 'argon2',
      });

      const { data } = prisma.passwordHistory.createMany.mock.calls[0][0];
      expect(data).toHaveLength(1);
      expect(data[0].passwordHash).toBe('newhash');
    });

    it('a user who had no password records only the new hash', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5, {
        passwordHash: null,
        passwordAlgorithm: null,
      });

      expect(prisma.passwordHistory.findFirst).not.toHaveBeenCalled();
      const { data } = prisma.passwordHistory.createMany.mock.calls[0][0];
      expect(data).toHaveLength(1);
    });

    it('should trim old entries beyond historyCount', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'old-1' },
        { id: 'old-2' },
      ]);
      prisma.passwordHistory.deleteMany.mockResolvedValue({ count: 2 });

      await service.recordHistory('user-1', 'realm-1', 'newhash', 3);

      expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', realmId: 'realm-1' },
        orderBy: { createdAt: 'desc' },
        skip: 3,
        select: { id: true },
      });
      expect(prisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
    });

    it('should not delete when there are no entries beyond historyCount', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5);

      expect(prisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── isExpired ──────────────────────────────────────────────

  describe('isExpired', () => {
    it('should return false when maxAgeDays <= 0', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: 0 };

      const result = service.isExpired(baseUser, realm);

      expect(result).toBe(false);
    });

    it('should return false when maxAgeDays is negative', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: -1 };

      const result = service.isExpired(baseUser, realm);

      expect(result).toBe(false);
    });

    it('should return true when passwordChangedAt is null', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: 90 };
      const user = { ...baseUser, passwordChangedAt: null } as User;

      const result = service.isExpired(user, realm);

      expect(result).toBe(true);
    });

    it('should return true when password is older than max age', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: 30 };
      // Set passwordChangedAt to 31 days ago
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const user = {
        ...baseUser,
        passwordChangedAt: thirtyOneDaysAgo,
      } as User;

      const result = service.isExpired(user, realm);

      expect(result).toBe(true);
    });

    it('should return false when password is within max age', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: 30 };
      // Set passwordChangedAt to 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const user = { ...baseUser, passwordChangedAt: tenDaysAgo } as User;

      const result = service.isExpired(user, realm);

      expect(result).toBe(false);
    });

    it('should return false when password was just changed', () => {
      const realm = { ...baseRealm, passwordMaxAgeDays: 1 };
      const user = {
        ...baseUser,
        passwordChangedAt: new Date(),
      } as User;

      const result = service.isExpired(user, realm);

      expect(result).toBe(false);
    });
  });
});
