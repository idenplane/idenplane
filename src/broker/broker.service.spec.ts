jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { BrokerService } from './broker.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('BrokerService', () => {
  let service: BrokerService;
  let prisma: MockPrismaService;
  let jwkService: {
    signJwt: jest.Mock;
    verifyJwt: jest.Mock;
  };
  let idpService: {
    findByAlias: jest.Mock;
  };

  let originalFetch: typeof global.fetch;

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

  const mockIdp = {
    id: 'idp-1',
    realmId: 'realm-1',
    alias: 'google',
    displayName: 'Google',
    enabled: true,
    providerType: 'oidc',
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksUrl: null,
    issuer: null,
    defaultScopes: 'openid email profile',
    trustEmail: false,
    linkOnly: false,
    syncUserProfile: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockClient = {
    id: 'client-uuid-1',
    realmId: 'realm-1',
    clientId: 'my-app',
    clientType: 'CONFIDENTIAL',
    name: 'My App',
    enabled: true,
    redirectUris: ['https://example.com/callback'],
    webOrigins: [],
    grantTypes: ['authorization_code'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    kid: 'kid-1',
    publicKey: 'public-key-pem',
    privateKey: 'private-key-pem',
    active: true,
    createdAt: new Date(),
  };

  const mockUser = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'testuser',
    email: 'test@example.com',
    emailVerified: true,
    firstName: 'Test',
    lastName: 'User',
    enabled: true,
  };

  beforeEach(() => {
    originalFetch = global.fetch;

    prisma = createMockPrismaService();
    jwkService = {
      signJwt: jest.fn(),
      verifyJwt: jest.fn(),
    };
    idpService = {
      findByAlias: jest.fn(),
    };

    service = new BrokerService(
      prisma as any,
      jwkService as any,
      idpService as any,
    );

    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('initiateLogin', () => {
    const params = {
      client_id: 'my-app',
      redirect_uri: 'https://example.com/callback',
      scope: 'openid',
      state: 'client-state',
      nonce: 'client-nonce',
    };

    it('should build an external authorization URL with correct parameters', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.signJwt.mockResolvedValue('signed-state-jwt');

      const result = await service.initiateLogin(mockRealm, 'google', params);
      const url = new URL(result);

      expect(url.origin + url.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(url.searchParams.get('client_id')).toBe('google-client-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('state')).toBe('signed-state-jwt');
      expect(url.searchParams.get('redirect_uri')).toContain(
        '/realms/test-realm/broker/google/callback',
      );
    });

    it('should call signJwt with broker state payload', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.signJwt.mockResolvedValue('signed-state-jwt');

      await service.initiateLogin(mockRealm, 'google', params);

      expect(jwkService.signJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: 'realm-1',
          realmName: 'test-realm',
          alias: 'google',
          clientId: 'my-app',
          redirectUri: 'https://example.com/callback',
          scope: 'openid',
          state: 'client-state',
          nonce: 'client-nonce',
          typ: 'broker_state',
        }),
        'private-key-pem',
        'kid-1',
        600,
      );
    });

    it('should throw BadRequestException when identity provider is disabled', async () => {
      idpService.findByAlias.mockResolvedValue({ ...mockIdp, enabled: false });

      await expect(
        service.initiateLogin(mockRealm, 'google', params),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when client_id is invalid', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateLogin(mockRealm, 'google', params),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when client is disabled', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue({
        ...mockClient,
        enabled: false,
      });

      await expect(
        service.initiateLogin(mockRealm, 'google', params),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when redirect_uri is not registered', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue(mockClient);

      await expect(
        service.initiateLogin(mockRealm, 'google', {
          ...params,
          redirect_uri: 'https://evil.com/callback',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw Error when no active signing key exists', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(
        service.initiateLogin(mockRealm, 'google', params),
      ).rejects.toThrow('No active signing key found for realm');
    });
  });

  describe('handleCallback', () => {
    const brokerState = {
      realmId: 'realm-1',
      realmName: 'test-realm',
      alias: 'google',
      clientId: 'my-app',
      redirectUri: 'https://example.com/callback',
      scope: 'openid',
      state: 'client-state',
      nonce: 'client-nonce',
    };

    const externalUserInfo = {
      sub: 'ext-user-123',
      email: 'test@example.com',
      email_verified: true,
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      preferred_username: 'testuser',
    };

    function setupFetchMocks() {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            access_token: 'ext-access-token',
            id_token: 'ext-id-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(externalUserInfo),
        });
    }

    it('should handle callback with existing federated identity', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);
      setupFetchMocks();

      // Existing federated identity
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'user-1',
        identityProviderId: 'idp-1',
        externalUserId: 'ext-user-123',
        user: mockUser,
      });
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      const result = await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(result.redirectUrl).toContain('https://example.com/callback');
      expect(result.redirectUrl).toContain('code=');
      expect(result.redirectUrl).toContain('state=client-state');
      expect(prisma.authorizationCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-uuid-1',
          userId: 'user-1',
          redirectUri: 'https://example.com/callback',
          scope: 'openid',
          nonce: 'client-nonce',
        }),
      });
    });

    it('should sync user profile when syncUserProfile is enabled', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue({
        ...mockIdp,
        syncUserProfile: true,
      });
      setupFetchMocks();

      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'user-1',
        identityProviderId: 'idp-1',
        externalUserId: 'ext-user-123',
        user: mockUser,
      });
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        }),
      });
    });

    it('should create new user when no federated identity or email match exists', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);
      setupFetchMocks();

      // No existing federated identity
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      // trustEmail is false, so email matching is skipped
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'new-user-1' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      const result = await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(result.redirectUrl).toContain('https://example.com/callback');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          username: 'testuser',
          email: 'test@example.com',
          enabled: true,
        }),
      });
      expect(prisma.federatedIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'new-user-1',
          identityProviderId: 'idp-1',
          externalUserId: 'ext-user-123',
        }),
      });
    });

    it('should link existing user by email when trustEmail is true', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue({
        ...mockIdp,
        trustEmail: true,
      });
      setupFetchMocks();

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      const result = await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(result.redirectUrl).toContain('https://example.com/callback');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', email: 'test@example.com' },
      });
      expect(prisma.federatedIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          identityProviderId: 'idp-1',
          externalUserId: 'ext-user-123',
        }),
      });
      // Should NOT create a new user
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for link-only IdP with no matching user', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue({
        ...mockIdp,
        trustEmail: true,
        linkOnly: true,
      });
      setupFetchMocks();

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for link-only IdP with no email and no match', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue({
        ...mockIdp,
        trustEmail: false,
        linkOnly: true,
      });

      // External user with no email match path (trustEmail is false)
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            access_token: 'ext-access-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            sub: 'ext-user-123',
            preferred_username: 'testuser',
          }),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when broker state JWT is invalid', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('Invalid JWT'));

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'bad-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException when broker state alias does not match', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        ...brokerState,
        alias: 'github',
      });

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when broker state realmId does not match', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        ...brokerState,
        realmId: 'other-realm',
      });

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when client is not found after callback', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);
      setupFetchMocks();

      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'user-1',
        identityProviderId: 'idp-1',
        externalUserId: 'ext-user-123',
        user: mockUser,
      });
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not include state param in redirect when broker state has no state', async () => {
      const stateWithoutClientState = { ...brokerState, state: undefined };
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(stateWithoutClientState);
      idpService.findByAlias.mockResolvedValue(mockIdp);
      setupFetchMocks();

      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'user-1',
        identityProviderId: 'idp-1',
        externalUserId: 'ext-user-123',
        user: mockUser,
      });
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      const result = await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      const url = new URL(result.redirectUrl);
      expect(url.searchParams.has('state')).toBe(false);
      expect(url.searchParams.has('code')).toBe(true);
    });

    it('should use fallback username when preferredUsername and email are absent', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);

      // External user with no email and no preferredUsername
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            access_token: 'ext-access-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            sub: 'ext-user-456',
          }),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'new-user-2' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'google-ext-user-456',
        }),
      });
    });

    it('should use email prefix as username when preferredUsername is absent', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            access_token: 'ext-access-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            sub: 'ext-user-789',
            email: 'john@example.com',
          }),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'new-user-3' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'john',
        }),
      });
    });

    it('should throw UnauthorizedException when token exchange fails', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(
        service.handleCallback(mockRealm, 'google', 'bad-code', 'state-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when userinfo fetch fails', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue(mockIdp);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            access_token: 'ext-access-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

      await expect(
        service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
