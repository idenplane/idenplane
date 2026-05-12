import { UnauthorizedException } from '@nestjs/common';
import { LoginService } from './login.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm, User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

const FAKE_TOKEN_RAW = 'aabbccdd00112233eeff44556677';
const FAKE_TOKEN_HASH = 'hashed-login-session-token';

const realm: Realm = {
  id: 'realm-1',
  name: 'test-realm',
  displayName: 'Test Realm',
  enabled: true,
  accessTokenLifespan: 300,
  refreshTokenLifespan: 1800,
  smtpHost: null,
  smtpPort: 587,
  smtpUser: null,
  smtpPassword: null,
  smtpFrom: null,
  smtpSecure: false,
  passwordMinLength: 8,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireDigits: false,
  passwordRequireSpecialChars: false,
  passwordHistoryCount: 0,
  passwordMaxAgeDays: 0,
  bruteForceEnabled: true,
  maxLoginFailures: 5,
  lockoutDuration: 900,
  failureResetTime: 600,
  permanentLockoutAfter: 0,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
} as Realm;

const dbUser: User = {
  id: 'user-1',
  realmId: realm.id,
  username: 'testuser',
  email: 'test@example.com',
  emailVerified: true,
  firstName: 'Test',
  lastName: 'User',
  enabled: true,
  passwordHash: '$argon2id$hashed',
  federationLink: null,
  passwordChangedAt: null,
  lockedUntil: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
} as User;

const federatedUser: User = {
  ...dbUser,
  id: 'user-fed-1',
  username: 'ldapuser',
  federationLink: 'federation-1',
  passwordHash: null,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockCryptoService() {
  return {
    hashPassword: jest.fn(),
    verifyPassword: jest.fn(),
    generateSecret: jest.fn().mockReturnValue(FAKE_TOKEN_RAW),
    sha256: jest.fn().mockReturnValue(FAKE_TOKEN_HASH),
  };
}

function createMockBruteForceService() {
  return {
    checkLocked: jest.fn().mockReturnValue({ locked: false }),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    resetFailures: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockFederationService() {
  return {
    authenticateViaFederation: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LoginService', () => {
  let service: LoginService;
  let prisma: MockPrismaService;
  let crypto: ReturnType<typeof createMockCryptoService>;
  let bruteForce: ReturnType<typeof createMockBruteForceService>;
  let federation: ReturnType<typeof createMockFederationService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = createMockCryptoService();
    bruteForce = createMockBruteForceService();
    federation = createMockFederationService();

    service = new LoginService(
      prisma as any,
      crypto as any,
      bruteForce as any,
      federation as any,
    );
  });

  // -----------------------------------------------------------------------
  // validateCredentials — local login (happy path)
  // -----------------------------------------------------------------------

  describe('validateCredentials', () => {
    describe('successful local login', () => {
      it('should return the user when credentials are valid', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(true);

        const result = await service.validateCredentials(
          realm,
          'testuser',
          'correct-password',
          '127.0.0.1',
        );

        expect(result).toEqual(dbUser);
      });

      it('should look up the user by realmId and username', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(true);

        await service.validateCredentials(realm, 'testuser', 'pass');

        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: {
            realmId_username: { realmId: realm.id, username: 'testuser' },
          },
        });
      });

      it('should verify the password against the stored hash', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(true);

        await service.validateCredentials(
          realm,
          'testuser',
          'correct-password',
        );

        expect(crypto.verifyPassword).toHaveBeenCalledWith(
          dbUser.passwordHash,
          'correct-password',
        );
      });

      it('should reset brute-force failures on successful login', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(true);

        await service.validateCredentials(
          realm,
          'testuser',
          'correct-password',
        );

        expect(bruteForce.resetFailures).toHaveBeenCalledWith(
          realm.id,
          dbUser.id,
        );
      });

      it('should check the brute-force lock status before verifying password', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(true);

        await service.validateCredentials(
          realm,
          'testuser',
          'correct-password',
        );

        expect(bruteForce.checkLocked).toHaveBeenCalledWith(realm, dbUser);
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — wrong password
    // -----------------------------------------------------------------------

    describe('wrong password', () => {
      it('should throw UnauthorizedException when password is incorrect', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(false);

        await expect(
          service.validateCredentials(
            realm,
            'testuser',
            'wrong-password',
            '10.0.0.1',
          ),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should record a brute-force failure when password is incorrect', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(false);

        await expect(
          service.validateCredentials(
            realm,
            'testuser',
            'wrong-password',
            '10.0.0.1',
          ),
        ).rejects.toThrow(UnauthorizedException);

        expect(bruteForce.recordFailure).toHaveBeenCalledWith(
          realm,
          dbUser.id,
          '10.0.0.1',
        );
      });

      it('should not reset failures when password is incorrect', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.verifyPassword.mockResolvedValue(false);

        await expect(
          service.validateCredentials(realm, 'testuser', 'wrong-password'),
        ).rejects.toThrow(UnauthorizedException);

        expect(bruteForce.resetFailures).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — disabled user
    // -----------------------------------------------------------------------

    describe('disabled user', () => {
      it('should throw UnauthorizedException when user is disabled', async () => {
        prisma.user.findUnique.mockResolvedValue({ ...dbUser, enabled: false });

        await expect(
          service.validateCredentials(realm, 'testuser', 'correct-password'),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should not verify password for a disabled local user', async () => {
        prisma.user.findUnique.mockResolvedValue({ ...dbUser, enabled: false });

        await expect(
          service.validateCredentials(realm, 'testuser', 'correct-password'),
        ).rejects.toThrow(UnauthorizedException);

        expect(crypto.verifyPassword).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — locked user (brute-force)
    // -----------------------------------------------------------------------

    describe('locked user (brute-force)', () => {
      it('should throw UnauthorizedException with lock message when user is locked', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        bruteForce.checkLocked.mockReturnValue({
          locked: true,
          lockedUntil: new Date(Date.now() + 900_000),
        });

        await expect(
          service.validateCredentials(realm, 'testuser', 'correct-password'),
        ).rejects.toThrow('Account is temporarily locked');
      });

      it('should not verify password when user is locked', async () => {
        prisma.user.findUnique.mockResolvedValue(dbUser);
        bruteForce.checkLocked.mockReturnValue({ locked: true });

        await expect(
          service.validateCredentials(realm, 'testuser', 'correct-password'),
        ).rejects.toThrow(UnauthorizedException);

        expect(crypto.verifyPassword).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — federation user (user.federationLink exists)
    // -----------------------------------------------------------------------

    describe('federation user (user.federationLink exists)', () => {
      it('should authenticate via federation service when user has a federationLink', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          userId: federatedUser.id,
        });

        const result = await service.validateCredentials(
          realm,
          'ldapuser',
          'ldap-password',
        );

        expect(result).toEqual(federatedUser);
        expect(federation.authenticateViaFederation).toHaveBeenCalledWith(
          realm.id,
          'ldapuser',
          'ldap-password',
        );
      });

      it('should reset failures on successful federation login', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          userId: federatedUser.id,
        });

        await service.validateCredentials(realm, 'ldapuser', 'ldap-password');

        expect(bruteForce.resetFailures).toHaveBeenCalledWith(
          realm.id,
          federatedUser.id,
        );
      });

      it('should check brute-force lock status for federated users', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          userId: federatedUser.id,
        });

        await service.validateCredentials(realm, 'ldapuser', 'ldap-password');

        expect(bruteForce.checkLocked).toHaveBeenCalledWith(
          realm,
          federatedUser,
        );
      });

      it('should throw when disabled federated user attempts login', async () => {
        prisma.user.findUnique.mockResolvedValue({
          ...federatedUser,
          enabled: false,
        });

        await expect(
          service.validateCredentials(realm, 'ldapuser', 'ldap-password'),
        ).rejects.toThrow(UnauthorizedException);

        expect(federation.authenticateViaFederation).not.toHaveBeenCalled();
      });

      it('should throw when locked federated user attempts login', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        bruteForce.checkLocked.mockReturnValue({ locked: true });

        await expect(
          service.validateCredentials(realm, 'ldapuser', 'ldap-password'),
        ).rejects.toThrow('Account is temporarily locked');

        expect(federation.authenticateViaFederation).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — federation failed
    // -----------------------------------------------------------------------

    describe('federation authentication failed', () => {
      it('should record failure and throw when federation rejects credentials', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: false,
        });

        await expect(
          service.validateCredentials(
            realm,
            'ldapuser',
            'bad-password',
            '10.0.0.5',
          ),
        ).rejects.toThrow(UnauthorizedException);

        expect(bruteForce.recordFailure).toHaveBeenCalledWith(
          realm,
          federatedUser.id,
          '10.0.0.5',
        );
      });

      it('should not reset failures when federation auth fails', async () => {
        prisma.user.findUnique.mockResolvedValue(federatedUser);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: false,
        });

        await expect(
          service.validateCredentials(realm, 'ldapuser', 'bad-password'),
        ).rejects.toThrow(UnauthorizedException);

        expect(bruteForce.resetFailures).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — user not found locally, federation available (LDAP import)
    // -----------------------------------------------------------------------

    describe('user not found locally but federation available', () => {
      it('should try LDAP import and return the imported user', async () => {
        const importedUser = {
          ...dbUser,
          id: 'imported-user-1',
          username: 'newldapuser',
          federationLink: 'federation-1',
        };

        prisma.user.findUnique
          .mockResolvedValueOnce(null) // first lookup: user not found
          .mockResolvedValueOnce(importedUser); // second lookup: after federation import
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          userId: importedUser.id,
        });

        const result = await service.validateCredentials(
          realm,
          'newldapuser',
          'ldap-password',
        );

        expect(result).toEqual(importedUser);
        expect(federation.authenticateViaFederation).toHaveBeenCalledWith(
          realm.id,
          'newldapuser',
          'ldap-password',
        );
      });

      it('should throw when LDAP auth succeeds but imported user is not found', async () => {
        prisma.user.findUnique
          .mockResolvedValueOnce(null) // first lookup: user not found
          .mockResolvedValueOnce(null); // second lookup: still not found after import
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          userId: 'missing-user-id',
        });

        await expect(
          service.validateCredentials(realm, 'newldapuser', 'ldap-password'),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should throw when LDAP auth fails for unknown user', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(null);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: false,
        });

        await expect(
          service.validateCredentials(realm, 'newldapuser', 'wrong-password'),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should throw when LDAP auth succeeds but no userId returned', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(null);
        federation.authenticateViaFederation.mockResolvedValue({
          authenticated: true,
          // no userId
        });

        await expect(
          service.validateCredentials(realm, 'newldapuser', 'ldap-password'),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — user not found, no federation
    // -----------------------------------------------------------------------

    describe('user not found, no federation', () => {
      it('should throw UnauthorizedException when user does not exist and no federation', async () => {
        // Create service without federation
        const serviceNoFed = new LoginService(
          prisma as any,
          crypto as any,
          bruteForce as any,
          undefined, // no federation service
        );

        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          serviceNoFed.validateCredentials(
            realm,
            'nonexistent',
            'any-password',
          ),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should not call federation service when it is not injected', async () => {
        const serviceNoFed = new LoginService(
          prisma as any,
          crypto as any,
          bruteForce as any,
          undefined,
        );

        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          serviceNoFed.validateCredentials(
            realm,
            'nonexistent',
            'any-password',
          ),
        ).rejects.toThrow(UnauthorizedException);

        expect(federation.authenticateViaFederation).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — user with no passwordHash (non-federated)
    // -----------------------------------------------------------------------

    describe('user with no passwordHash and no federationLink', () => {
      it('should throw UnauthorizedException when user has no password hash', async () => {
        prisma.user.findUnique.mockResolvedValue({
          ...dbUser,
          passwordHash: null,
        });

        await expect(
          service.validateCredentials(realm, 'testuser', 'any-password'),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    // -----------------------------------------------------------------------
    // validateCredentials — federation user without federation service
    // -----------------------------------------------------------------------

    describe('federation user without federation service injected', () => {
      it('should fall through to local password check if federation service is missing', async () => {
        const serviceNoFed = new LoginService(
          prisma as any,
          crypto as any,
          bruteForce as any,
          undefined,
        );

        // User has federationLink but the service has no federation provider
        // Since user.federationLink && this.federationService is false,
        // it falls to the local check (user.enabled && user.passwordHash)
        const fedUserWithPassword = {
          ...federatedUser,
          passwordHash: '$argon2id$hashed',
          enabled: true,
        };
        prisma.user.findUnique.mockResolvedValue(fedUserWithPassword);
        crypto.verifyPassword.mockResolvedValue(true);

        const result = await serviceNoFed.validateCredentials(
          realm,
          'ldapuser',
          'password',
        );

        expect(result).toEqual(fedUserWithPassword);
      });
    });
  });

  // -----------------------------------------------------------------------
  // createLoginSession
  // -----------------------------------------------------------------------

  describe('createLoginSession', () => {
    it('should return the raw token', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      const token = await service.createLoginSession(realm, dbUser);

      expect(token).toBe(FAKE_TOKEN_RAW);
    });

    it('should generate a 32-byte secret for the token', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      await service.createLoginSession(realm, dbUser);

      expect(crypto.generateSecret).toHaveBeenCalledWith(32);
    });

    it('should hash the token before storing it', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      await service.createLoginSession(realm, dbUser);

      expect(crypto.sha256).toHaveBeenCalledWith(FAKE_TOKEN_RAW);
    });

    it('should persist the session with correct data', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      await service.createLoginSession(
        realm,
        dbUser,
        '192.168.1.1',
        'Mozilla/5.0',
      );

      expect(prisma.loginSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: dbUser.id,
          realmId: realm.id,
          tokenHash: FAKE_TOKEN_HASH,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });

    it('should set expiresAt based on realm.refreshTokenLifespan', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      const before = Date.now();
      await service.createLoginSession(realm, dbUser);
      const after = Date.now();

      const createCall = prisma.loginSession.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;

      const expectedMin = before + realm.refreshTokenLifespan * 1000;
      const expectedMax = after + realm.refreshTokenLifespan * 1000;

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it('should allow undefined ip and userAgent', async () => {
      prisma.loginSession.create.mockResolvedValue({ id: 'session-1' });

      await service.createLoginSession(realm, dbUser);

      expect(prisma.loginSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: undefined,
          userAgent: undefined,
        }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // validateLoginSession
  // -----------------------------------------------------------------------

  describe('validateLoginSession', () => {
    const validSession = {
      id: 'session-1',
      userId: dbUser.id,
      realmId: realm.id,
      tokenHash: FAKE_TOKEN_HASH,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
      user: { ...dbUser },
    };

    it('should return the user for a valid session', async () => {
      prisma.loginSession.findUnique.mockResolvedValue(validSession);

      const result = await service.validateLoginSession(
        realm,
        'raw-session-token',
      );

      expect(result).toEqual(dbUser);
    });

    it('should hash the session token before lookup', async () => {
      prisma.loginSession.findUnique.mockResolvedValue(validSession);

      await service.validateLoginSession(realm, 'raw-session-token');

      expect(crypto.sha256).toHaveBeenCalledWith('raw-session-token');
      expect(prisma.loginSession.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: FAKE_TOKEN_HASH },
        include: { user: true },
      });
    });

    it('should return null when session does not exist', async () => {
      prisma.loginSession.findUnique.mockResolvedValue(null);

      const result = await service.validateLoginSession(
        realm,
        'nonexistent-token',
      );

      expect(result).toBeNull();
    });

    it('should return null when session belongs to a different realm', async () => {
      prisma.loginSession.findUnique.mockResolvedValue({
        ...validSession,
        realmId: 'different-realm-id',
      });

      const result = await service.validateLoginSession(
        realm,
        'raw-session-token',
      );

      expect(result).toBeNull();
    });

    it('should return null when session is expired', async () => {
      prisma.loginSession.findUnique.mockResolvedValue({
        ...validSession,
        expiresAt: new Date(Date.now() - 1000), // expired
      });

      const result = await service.validateLoginSession(
        realm,
        'raw-session-token',
      );

      expect(result).toBeNull();
    });

    it('should return null when the session user is disabled', async () => {
      prisma.loginSession.findUnique.mockResolvedValue({
        ...validSession,
        user: { ...dbUser, enabled: false },
      });

      const result = await service.validateLoginSession(
        realm,
        'raw-session-token',
      );

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // findUserById
  // -----------------------------------------------------------------------

  describe('findUserById', () => {
    it('should return the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.findUserById('user-1');

      expect(result).toEqual(dbUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should return null when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findUserById('nonexistent-id');

      expect(result).toBeNull();
    });
  });
});
