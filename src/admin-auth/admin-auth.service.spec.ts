import {
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { AdminAuthService } from './admin-auth.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

const masterRealm = {
  id: 'master-id',
  name: 'master',
  enabled: true,
  bruteForceEnabled: true,
  maxLoginFailures: 5,
  lockoutDuration: 900,
  failureResetTime: 600,
  permanentLockoutAfter: 0,
};

const signingKey = {
  id: 'key-1',
  realmId: 'master-id',
  kid: 'kid-1',
  algorithm: 'RS256',
  publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
  privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  active: true,
  createdAt: new Date(),
};

const adminUser = {
  id: 'user-1',
  realmId: 'master-id',
  username: 'admin',
  enabled: true,
  passwordHash: 'hashed-password',
  lockedUntil: null,
};

/** Allowed rate-limit result (not exhausted). */
const rlAllowed = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: 9999999999,
};
/** Denied rate-limit result (exhausted). */
const rlDenied = {
  allowed: false,
  limit: 5,
  remaining: 0,
  resetAt: 9999999999,
  retryAfter: 30,
};

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let prisma: MockPrismaService;
  let crypto: { hashPassword: jest.Mock; verifyPassword: jest.Mock };
  let jwkService: { signJwt: jest.Mock; verifyJwt: jest.Mock };
  let rateLimitService: {
    checkAdminIpLimit: jest.Mock;
    computeHeaders: jest.Mock;
  };
  let bruteForceService: {
    checkLocked: jest.Mock;
    recordFailure: jest.Mock;
    resetFailures: jest.Mock;
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = {
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
    };
    jwkService = {
      signJwt: jest.fn(),
      verifyJwt: jest.fn(),
    };
    rateLimitService = {
      checkAdminIpLimit: jest.fn().mockResolvedValue(rlAllowed),
      computeHeaders: jest.fn().mockReturnValue({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
        'X-RateLimit-Reset': '9999999999',
      }),
    };
    bruteForceService = {
      checkLocked: jest.fn().mockReturnValue({ locked: false }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      resetFailures: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminAuthService(
      prisma as any,
      crypto as any,
      jwkService as any,
      rateLimitService as any,
      bruteForceService as any,
    );
  });

  // ─── login ─────────────────────────────────────────────

  describe('login', () => {
    it('should return access token on valid credentials', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'super-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('jwt-token');

      const result = await service.login('admin', 'password', '127.0.0.1');

      expect(result.access_token).toBe('jwt-token');
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(3600);
      expect(result.rateLimitHeaders).toBeDefined();
      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'master' },
      });
      expect(crypto.verifyPassword).toHaveBeenCalledWith(
        'hashed-password',
        'password',
      );
    });

    it('should pass the caller IP to checkAdminIpLimit', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'super-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('tok');

      await service.login('admin', 'password', '203.0.113.10');

      expect(rateLimitService.checkAdminIpLimit).toHaveBeenCalledWith(
        '203.0.113.10',
      );
    });

    it('should throw 429 when IP rate limit is exceeded', async () => {
      rateLimitService.checkAdminIpLimit.mockResolvedValue(rlDenied);

      await expect(
        service.login('admin', 'password', '1.2.3.4'),
      ).rejects.toThrow(HttpException);
      await expect(
        service.login('admin', 'password', '1.2.3.4'),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      // Should NOT reach the DB when rate limited
      expect(prisma.realm.findUnique).not.toHaveBeenCalled();
    });

    it('should throw 429 when account is brute-force locked', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      bruteForceService.checkLocked.mockReturnValue({
        locked: true,
        lockedUntil: new Date('2099-01-01T00:00:00Z'),
      });

      await expect(
        service.login('admin', 'password', '1.2.3.4'),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      // Password must NOT be verified when account is locked
      expect(crypto.verifyPassword).not.toHaveBeenCalled();
    });

    it('should record brute-force failure on wrong password', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(false);

      await expect(service.login('admin', 'wrong', '5.5.5.5')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bruteForceService.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'master-id' }),
        'user-1',
        '5.5.5.5',
      );
    });

    it('should reset brute-force counters on successful login', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'super-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('jwt-token');

      await service.login('admin', 'password', '127.0.0.1');

      expect(bruteForceService.resetFailures).toHaveBeenCalledWith(
        'master-id',
        'user-1',
      );
    });

    it('should throw if master realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow('Admin system not initialized');
    });

    it('should throw if user not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('unknown', 'password', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if user is disabled', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue({
        ...adminUser,
        enabled: false,
      });

      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw if user has no password hash', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue({
        ...adminUser,
        passwordHash: null,
      });

      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw if password is invalid', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(false);

      await expect(
        service.login('admin', 'wrong', '127.0.0.1'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw if user has no admin role', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'regular-user' } },
      ]);

      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow('User does not have admin access');
    });

    it('should throw if no signing key found', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'realm-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(
        service.login('admin', 'password', '127.0.0.1'),
      ).rejects.toThrow('No signing key found for master realm');
    });

    it('should accept realm-admin role', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'realm-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('jwt-token');

      const result = await service.login('admin', 'password', '127.0.0.1');
      expect(result.access_token).toBe('jwt-token');
    });

    it('should accept view-only role', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'view-only' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('jwt-token');

      const result = await service.login('admin', 'password', '127.0.0.1');
      expect(result.access_token).toBe('jwt-token');
    });
  });

  // ─── validateAdminToken ───────────────────────────────

  describe('validateAdminToken', () => {
    it('should return userId and roles for a valid admin token', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'admin',
        sub: 'user-1',
        realm_access: { roles: ['super-admin'] },
      });

      const result = await service.validateAdminToken('valid-token');

      expect(result).toEqual({
        userId: 'user-1',
        roles: ['super-admin'],
      });
    });

    it('should throw if master realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.validateAdminToken('token')).rejects.toThrow(
        'Admin system not initialized',
      );
    });

    it('should throw if no signing key found', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(service.validateAdminToken('token')).rejects.toThrow(
        'No signing key found',
      );
    });

    it('should throw if token type is not admin', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'Bearer',
        sub: 'user-1',
      });

      await expect(service.validateAdminToken('token')).rejects.toThrow(
        'Invalid admin token',
      );
    });

    it('should throw if JWT verification fails', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('Invalid JWT'));

      await expect(service.validateAdminToken('invalid')).rejects.toThrow(
        'Invalid admin token',
      );
    });

    it('should return empty roles when realm_access is missing', async () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'admin',
        sub: 'user-1',
      });

      const result = await service.validateAdminToken('token');
      expect(result.roles).toEqual([]);
    });
  });

  // ─── hasRole ──────────────────────────────────────────

  describe('hasRole', () => {
    it('should return true for super-admin regardless of required role', () => {
      expect(service.hasRole(['super-admin'], 'realm-admin')).toBe(true);
      expect(service.hasRole(['super-admin'], 'view-only')).toBe(true);
      expect(service.hasRole(['super-admin'], 'any-role')).toBe(true);
    });

    it('should return true when required role is present', () => {
      expect(service.hasRole(['realm-admin', 'view-only'], 'realm-admin')).toBe(
        true,
      );
    });

    it('should return false when required role is not present', () => {
      expect(service.hasRole(['view-only'], 'realm-admin')).toBe(false);
    });

    it('should return false for empty roles', () => {
      expect(service.hasRole([], 'super-admin')).toBe(false);
    });
  });
});
