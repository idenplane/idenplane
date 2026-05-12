import { UnauthorizedException } from '@nestjs/common';

// Mock JwkService and ScopesService modules to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));
jest.mock('../scopes/scopes.service.js', () => ({
  ScopesService: jest.fn(),
}));

import { TokensService } from './tokens.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('TokensService', () => {
  let service: TokensService;
  let prisma: MockPrismaService;
  let cryptoService: {
    sha256: jest.Mock;
    hashPassword: jest.Mock;
    verifyPassword: jest.Mock;
    generateSecret: jest.Mock;
  };
  let jwkService: { verifyJwt: jest.Mock; signJwt: jest.Mock };
  let scopesService: {
    parseAndValidate: jest.Mock;
    getClaimsForScopes: jest.Mock;
  };

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Realm;

  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    kid: 'kid-1',
    algorithm: 'RS256',
    publicKey: 'public-key-pem',
    privateKey: 'private-key-pem',
    active: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    cryptoService = {
      sha256: jest.fn(),
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
      generateSecret: jest.fn(),
    };
    jwkService = {
      verifyJwt: jest.fn(),
      signJwt: jest.fn(),
    };
    scopesService = {
      parseAndValidate: jest.fn(),
      getClaimsForScopes: jest.fn(),
    };
    const blacklistService = {
      isBlacklisted: jest.fn().mockReturnValue(false),
      blacklistToken: jest.fn(),
    };
    const backchannelLogoutService = {
      sendLogoutTokens: jest.fn(),
    };
    const eventsService = {
      recordLoginEvent: jest.fn().mockResolvedValue(undefined),
      recordAdminEvent: jest.fn().mockResolvedValue(undefined),
    };
    const customAttributesService = {
      getOidcClaimsForUser: jest.fn().mockResolvedValue({}),
    };

    service = new TokensService(
      prisma as any,
      cryptoService as any,
      jwkService as any,
      scopesService as any,
      blacklistService as any,
      backchannelLogoutService as any,
      eventsService as any,
      customAttributesService as any,
    );
  });

  describe('introspect', () => {
    it('should return active=true with claims for a valid token', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        enabled: true,
      });
      jwkService.verifyJwt.mockResolvedValue({
        sub: 'user-1',
        iss: 'https://authme/realm-1',
        aud: 'my-app',
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        scope: 'openid profile',
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: { roles: ['admin'] },
        resource_access: {},
      });

      const result = await service.introspect(mockRealm, 'valid-jwt-token');

      expect(result.active).toBe(true);
      expect(result.sub).toBe('user-1');
      expect(result.iss).toBe('https://authme/realm-1');
      expect(result.aud).toBe('my-app');
      expect(result.scope).toBe('openid profile');
      expect(result.preferred_username).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      expect(result.realm_access).toEqual({ roles: ['admin'] });
    });

    it('should return active=false when no signing key exists', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const result = await service.introspect(mockRealm, 'some-token');

      expect(result).toEqual({ active: false });
    });

    it('should return active=false for an expired or invalid token', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('Token expired'));

      const result = await service.introspect(mockRealm, 'expired-token');

      expect(result).toEqual({ active: false });
    });

    it('should return active=false when verification throws (revoked/tampered)', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('Invalid signature'));

      const result = await service.introspect(mockRealm, 'tampered-token');

      expect(result).toEqual({ active: false });
    });
  });

  describe('revoke', () => {
    it('should revoke an existing refresh token', async () => {
      const tokenHash = 'hashed-token';
      cryptoService.sha256.mockReturnValue(tokenHash);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash,
        revoked: false,
      });
      prisma.refreshToken.update.mockResolvedValue({});

      await service.revoke(mockRealm, 'refresh-token-value', 'refresh_token');

      expect(cryptoService.sha256).toHaveBeenCalledWith('refresh-token-value');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
      });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
    });

    it('should be a no-op when the refresh token does not exist', async () => {
      cryptoService.sha256.mockReturnValue('nonexistent-hash');
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.revoke(mockRealm, 'unknown-token', 'refresh_token');

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should attempt refresh token revocation when tokenTypeHint is not provided', async () => {
      cryptoService.sha256.mockReturnValue('some-hash');
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-2',
        tokenHash: 'some-hash',
        revoked: false,
      });
      prisma.refreshToken.update.mockResolvedValue({});

      await service.revoke(mockRealm, 'some-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-2' },
        data: { revoked: true },
      });
    });

    it('should attempt to blacklist an access token by jti', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        jti: 'token-jti-1',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      await service.revoke(mockRealm, 'access-token', 'access_token');

      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('userinfo', () => {
    const mockUser = {
      id: 'user-1',
      username: 'testuser',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
    };

    it('should return scope-filtered claims for a valid token', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        sub: 'user-1',
        scope: 'openid profile email',
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      scopesService.parseAndValidate.mockReturnValue([
        'openid',
        'profile',
        'email',
      ]);
      scopesService.getClaimsForScopes.mockReturnValue(
        new Set([
          'sub',
          'preferred_username',
          'given_name',
          'family_name',
          'name',
          'email',
          'email_verified',
        ]),
      );

      const result = await service.userinfo(mockRealm, 'valid-access-token');

      expect(result).toBeDefined();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          username: true,
          email: true,
          emailVerified: true,
          firstName: true,
          lastName: true,
        },
      });
      expect(scopesService.parseAndValidate).toHaveBeenCalledWith(
        'openid profile email',
      );
      expect(scopesService.getClaimsForScopes).toHaveBeenCalledWith([
        'openid',
        'profile',
        'email',
      ]);
    });

    it('should default to openid scope when no scopes are in the token', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        sub: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      scopesService.parseAndValidate.mockReturnValue([]);
      scopesService.getClaimsForScopes.mockReturnValue(
        new Set(['sub', 'preferred_username']),
      );

      await service.userinfo(mockRealm, 'token-no-scopes');

      expect(scopesService.getClaimsForScopes).toHaveBeenCalledWith(['openid']);
    });

    it('should throw UnauthorizedException when no signing key exists', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(service.userinfo(mockRealm, 'some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for an invalid access token', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('Invalid token'));

      await expect(service.userinfo(mockRealm, 'bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'deleted-user' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.userinfo(mockRealm, 'valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke all session tokens and delete the session', async () => {
      const tokenHash = 'hashed-refresh';
      cryptoService.sha256.mockReturnValue(tokenHash);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash,
        sessionId: 'session-1',
        revoked: false,
        session: { id: 'session-1', userId: 'user-1' },
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.session.delete.mockResolvedValue({});

      await service.logout(mockRealm, '127.0.0.1', 'refresh-token-value');

      expect(cryptoService.sha256).toHaveBeenCalledWith('refresh-token-value');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
        include: { session: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', isOffline: false },
        data: { revoked: true },
      });
      expect(prisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('should throw UnauthorizedException when refresh token is not found', async () => {
      cryptoService.sha256.mockReturnValue('nonexistent-hash');
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.logout(mockRealm, '127.0.0.1', 'invalid-refresh'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
