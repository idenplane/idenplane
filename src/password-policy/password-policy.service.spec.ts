import { PasswordPolicyService } from './password-policy.service.js';
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
    };
    service = new PasswordPolicyService(prisma as any, crypto as any);
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
          passwordHash: 'hash1',
          userId: 'user-1',
          realmId: 'realm-1',
        },
        {
          id: 'h2',
          passwordHash: 'hash2',
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
      expect(crypto.verifyPassword).toHaveBeenCalledWith('hash1', 'oldpass');
      expect(crypto.verifyPassword).toHaveBeenCalledWith('hash2', 'oldpass');
    });

    it('should return false when password does not match any history entry', async () => {
      prisma.passwordHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          passwordHash: 'hash1',
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
      });
    });
  });

  // ─── recordHistory ──────────────────────────────────────────

  describe('recordHistory', () => {
    it('should return immediately when historyCount <= 0', async () => {
      await service.recordHistory('user-1', 'realm-1', 'hash', 0);

      expect(prisma.passwordHistory.create).not.toHaveBeenCalled();
    });

    it('should return immediately when historyCount is negative', async () => {
      await service.recordHistory('user-1', 'realm-1', 'hash', -1);

      expect(prisma.passwordHistory.create).not.toHaveBeenCalled();
    });

    it('should create a new history entry', async () => {
      prisma.passwordHistory.create.mockResolvedValue({});
      prisma.passwordHistory.findMany.mockResolvedValue([]);

      await service.recordHistory('user-1', 'realm-1', 'newhash', 5);

      expect(prisma.passwordHistory.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', realmId: 'realm-1', passwordHash: 'newhash' },
      });
    });

    it('should trim old entries beyond historyCount', async () => {
      prisma.passwordHistory.create.mockResolvedValue({});
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
      prisma.passwordHistory.create.mockResolvedValue({});
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
