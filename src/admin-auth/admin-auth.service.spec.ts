import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
import {
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { AdminAuthService } from './admin-auth.service.js';
import { CertificateBindingError } from '../mtls/certificate-binding.js';
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
  let adminMfa: Record<string, jest.Mock>;

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
    adminMfa = {
      methods: jest.fn().mockResolvedValue([]),
      policy: jest
        .fn()
        .mockResolvedValue({ required: false, source: 'setting' }),
      createChallenge: jest.fn().mockResolvedValue('mfa-token-dummy'),
      spendChallengeAttempt: jest.fn(),
      peekChallenge: jest.fn(),
      consumeChallenge: jest.fn().mockResolvedValue(true),
      verifyCode: jest.fn(),
      verifyPasskey: jest.fn(),
      passkeyOptions: jest.fn(),
      challengeBinding: jest.fn((t: string) => `admin-login:${t}`),
    };

    service = new AdminAuthService(
      lookupsBackedBy(prisma as any) as any,
      prisma as any,
      crypto as any,
      jwkService as any,
      rateLimitService as any,
      bruteForceService as any,
      adminMfa as any,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
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

      const result: any = await service.login('admin', 'password', '127.0.0.1');

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

      const result: any = await service.login('admin', 'password', '127.0.0.1');
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

      const result: any = await service.login('admin', 'password', '127.0.0.1');
      expect(result.access_token).toBe('jwt-token');
    });
  });

  // ─── console MFA ───────────────────────────────────────

  describe('login with a second factor', () => {
    const signedIn = () => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.user.findUnique.mockResolvedValue(adminUser);
      crypto.verifyPassword.mockResolvedValue(true);
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'super-admin' } },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.signJwt.mockResolvedValue('jwt-token');
    };

    it('returns an mfa_token and no token when the admin has a factor', async () => {
      signedIn();
      adminMfa.methods.mockResolvedValue(['totp', 'recovery']);

      const result: any = await service.login('admin', 'password', '1.2.3.4');

      expect(result).toMatchObject({
        mfa_required: true,
        mfa_token: 'mfa-token-dummy',
        methods: ['totp', 'recovery'],
      });
      expect(result.access_token).toBeUndefined();
      expect(jwkService.signJwt).not.toHaveBeenCalled();
      // The password alone does not clear the failure counter.
      expect(bruteForceService.resetFailures).not.toHaveBeenCalled();
    });

    it('treats leftover recovery codes alone as no factor', async () => {
      signedIn();
      adminMfa.methods.mockResolvedValue(['recovery']);
      const result: any = await service.login('admin', 'password');
      expect(result.access_token).toBe('jwt-token');
    });

    it('signs a password-only token with amr, acr and auth_time', async () => {
      signedIn();
      await service.login('admin', 'password');
      expect(jwkService.signJwt.mock.calls[0][0]).toMatchObject({
        typ: 'admin',
        amr: ['pwd'],
        acr: 'urn:idenplane:acr:password',
        auth_time: expect.any(Number),
      });
    });

    it('flags enrolment when MFA is required and the admin has no factor', async () => {
      signedIn();
      adminMfa.policy.mockResolvedValue({ required: true, source: 'setting' });
      const result: any = await service.login('admin', 'password');
      expect(result.access_token).toBe('jwt-token');
      expect(result.mfa_enrolment_required).toBe(true);
    });

    it('completes the second step with a code and signs MFA claims', async () => {
      signedIn();
      adminMfa.spendChallengeAttempt.mockResolvedValue({ userId: 'user-1' });
      adminMfa.verifyCode.mockResolvedValue({
        method: 'totp',
        amr: ['pwd', 'otp', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });

      const result = await service.completeMfaLogin(
        'mfa-token-dummy',
        'totp',
        '123456',
        '1.2.3.4',
      );

      expect(result.access_token).toBe('jwt-token');
      expect(adminMfa.verifyCode).toHaveBeenCalledWith(
        'user-1',
        'totp',
        '123456',
        '1.2.3.4',
      );
      expect(adminMfa.consumeChallenge).toHaveBeenCalledWith('mfa-token-dummy');
      expect(bruteForceService.resetFailures).toHaveBeenCalledWith(
        'master-id',
        'user-1',
      );
      expect(jwkService.signJwt.mock.calls[0][0]).toMatchObject({
        amr: ['pwd', 'otp', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
    });

    it('refuses a wrong code without consuming the challenge', async () => {
      adminMfa.spendChallengeAttempt.mockResolvedValue({ userId: 'user-1' });
      adminMfa.verifyCode.mockResolvedValue(null);
      await expect(
        service.completeMfaLogin('mfa-token-dummy', 'totp', '000000', 'ip'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(adminMfa.consumeChallenge).not.toHaveBeenCalled();
      expect(jwkService.signJwt).not.toHaveBeenCalled();
    });

    it('refuses a spent or unknown challenge before checking the code', async () => {
      adminMfa.spendChallengeAttempt.mockResolvedValue(null);
      await expect(
        service.completeMfaLogin('gone', 'totp', '123456', 'ip'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(adminMfa.verifyCode).not.toHaveBeenCalled();
    });

    it('completes only once when two correct answers race', async () => {
      signedIn();
      adminMfa.spendChallengeAttempt.mockResolvedValue({ userId: 'user-1' });
      adminMfa.verifyCode.mockResolvedValue({
        method: 'totp',
        amr: ['pwd', 'otp', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
      adminMfa.consumeChallenge.mockResolvedValue(false);
      await expect(
        service.completeMfaLogin('mfa-token-dummy', 'totp', '123456', 'ip'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwkService.signJwt).not.toHaveBeenCalled();
    });

    it('applies the per-IP sign-in limit to the second step', async () => {
      rateLimitService.checkAdminIpLimit.mockResolvedValue(rlDenied);
      await expect(
        service.completeMfaLogin('mfa-token-dummy', 'totp', '123456', 'ip'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(adminMfa.spendChallengeAttempt).not.toHaveBeenCalled();
    });

    it('steps up: a new token with a fresh proof, the old one revoked', async () => {
      signedIn();
      const revoke = jest.spyOn(service, 'revokeToken').mockResolvedValue();
      const proof = {
        method: 'passkey' as const,
        amr: ['pwd', 'hwk', 'mfa'],
        acr: 'urn:idenplane:acr:webauthn',
      };
      const token = await service.stepUp(
        { userId: 'user-1', roles: [] },
        'old-token',
        async () => proof,
      );
      expect(token.access_token).toBe('jwt-token');
      expect(revoke).toHaveBeenCalledWith('old-token');
      expect(jwkService.signJwt.mock.calls[0][0]).toMatchObject({
        acr: 'urn:idenplane:acr:webauthn',
      });
    });

    it('refuses a step-up for the API key and for a wrong code', async () => {
      await expect(
        service.stepUp(
          { userId: 'api-key:admin', roles: [] },
          undefined,
          jest.fn(),
        ),
      ).rejects.toThrow('no second factor');
      await expect(
        service.stepUp(
          { userId: 'user-1', roles: [] },
          'old',
          async () => null,
        ),
      ).rejects.toThrow('Invalid code');
    });
  });

  describe('validateAdminToken MFA claims', () => {
    beforeEach(() => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
    });

    it('returns acr, amr and auth_time from the token', async () => {
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'admin',
        sub: 'user-1',
        realm_access: { roles: ['super-admin'] },
        acr: 'urn:idenplane:acr:mfa',
        amr: ['pwd', 'otp', 'mfa', 7],
        auth_time: 1700000000,
      });
      await expect(service.validateAdminToken('t')).resolves.toEqual({
        userId: 'user-1',
        roles: ['super-admin'],
        acr: 'urn:idenplane:acr:mfa',
        amr: ['pwd', 'otp', 'mfa'],
        authTime: 1700000000,
      });
    });

    it('leaves them out for a token from before 0.11.0', async () => {
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'admin',
        sub: 'user-1',
        realm_access: { roles: ['super-admin'] },
      });
      await expect(service.validateAdminToken('t')).resolves.toEqual({
        userId: 'user-1',
        roles: ['super-admin'],
      });
    });
  });

  // ─── validateAdminToken ───────────────────────────────

  describe('validateAdminToken with a certificate-bound token (RFC 8705 §3)', () => {
    const X5T = 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
    const req = { headers: {}, socket: {} } as any;
    const withSource = (fromRequest: jest.Mock) =>
      new AdminAuthService(
        lookupsBackedBy(prisma as any) as any,
        prisma as any,
        crypto as any,
        jwkService as any,
        rateLimitService as any,
        bruteForceService as any,
        adminMfa as any,
        { fromRequest } as any,
      );
    let other: AdminAuthService | undefined;

    beforeEach(() => {
      prisma.realm.findUnique.mockResolvedValue(masterRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      jwkService.verifyJwt.mockResolvedValue({
        typ: 'admin',
        sub: 'user-1',
        realm_access: { roles: ['super-admin'] },
        cnf: { 'x5t#S256': X5T },
      });
    });
    afterEach(() => other?.onModuleDestroy());

    it('accepts it with its certificate', async () => {
      other = withSource(jest.fn().mockReturnValue({ x5tS256: X5T }));
      await expect(other.validateAdminToken('t', req)).resolves.toEqual({
        userId: 'user-1',
        roles: ['super-admin'],
      });
    });

    it('refuses it with another certificate', async () => {
      other = withSource(
        jest.fn().mockReturnValue({ x5tS256: 'x'.repeat(43) }),
      );
      await expect(other.validateAdminToken('t', req)).rejects.toBeInstanceOf(
        CertificateBindingError,
      );
    });

    it('refuses it without a request or certificate source', async () => {
      await expect(service.validateAdminToken('t', req)).rejects.toBeInstanceOf(
        CertificateBindingError,
      );
      other = withSource(jest.fn().mockReturnValue({ x5tS256: X5T }));
      await expect(other.validateAdminToken('t')).rejects.toBeInstanceOf(
        CertificateBindingError,
      );
    });
  });

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
        'Not an admin token',
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

    describe("after the admin's credentials changed", () => {
      const now = Math.floor(Date.now() / 1000);
      const token = (iat: number) => ({
        typ: 'admin',
        sub: 'user-1',
        jti: 'jti-1',
        iat,
        realm_access: { roles: ['super-admin'] },
      });
      const userRevocation = (revokedAtSec: number) => ({
        jti: 'user:user-1',
        revokedAt: new Date(revokedAtSec * 1000),
        expiresAt: new Date((now + 3600) * 1000),
      });

      beforeEach(() => {
        prisma.realm.findUnique.mockResolvedValue(masterRealm);
        prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      });

      it('reads the token and the admin revocation in one query', async () => {
        jwkService.verifyJwt.mockResolvedValue(token(now));
        await service.validateAdminToken('t');
        expect(prisma.adminRevokedToken.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.adminRevokedToken.findMany).toHaveBeenCalledWith({
          where: { jti: { in: ['jti-1', 'user:user-1'] } },
        });
      });

      it('refuses a token issued before the revocation', async () => {
        jwkService.verifyJwt.mockResolvedValue(token(now - 120));
        prisma.adminRevokedToken.findMany.mockResolvedValue([
          userRevocation(now - 60),
        ]);
        await expect(service.validateAdminToken('t')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      });

      it('accepts a token issued after the revocation', async () => {
        jwkService.verifyJwt.mockResolvedValue(token(now));
        prisma.adminRevokedToken.findMany.mockResolvedValue([
          userRevocation(now - 60),
        ]);
        await expect(service.validateAdminToken('t')).resolves.toEqual({
          userId: 'user-1',
          roles: ['super-admin'],
        });
      });

      it('ignores a revocation that has expired', async () => {
        jwkService.verifyJwt.mockResolvedValue(token(now - 120));
        prisma.adminRevokedToken.findMany.mockResolvedValue([
          { ...userRevocation(now - 60), expiresAt: new Date(now * 1000 - 1) },
        ]);
        await expect(service.validateAdminToken('t')).resolves.toBeTruthy();
      });

      it('tells tokens from the same second apart by their millisecond issue time', async () => {
        const revokedAtMs = now * 1000 + 500;
        prisma.adminRevokedToken.findMany.mockResolvedValue([
          {
            jti: 'user:user-1',
            revokedAt: new Date(revokedAtMs),
            expiresAt: new Date((now + 3600) * 1000),
          },
        ]);
        jwkService.verifyJwt.mockResolvedValue({
          ...token(now),
          iat_ms: revokedAtMs + 1,
        });
        await expect(service.validateAdminToken('t')).resolves.toBeTruthy();
        jwkService.verifyJwt.mockResolvedValue({
          ...token(now),
          iat_ms: revokedAtMs - 1,
        });
        await expect(service.validateAdminToken('t')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        // A token from before 0.12.0 has no iat_ms: the same second is refused.
        jwkService.verifyJwt.mockResolvedValue(token(now));
        await expect(service.validateAdminToken('t')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      });

      it('still refuses a token revoked by its own jti', async () => {
        jwkService.verifyJwt.mockResolvedValue(token(now));
        prisma.adminRevokedToken.findMany.mockResolvedValue([
          {
            jti: 'jti-1',
            revokedAt: new Date(),
            expiresAt: new Date((now + 3600) * 1000),
          },
        ]);
        await expect(service.validateAdminToken('t')).rejects.toThrow(
          'Token has been revoked',
        );
      });
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
