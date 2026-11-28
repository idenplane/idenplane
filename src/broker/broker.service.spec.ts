import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));
// Provider calls go through the SSRF-safe client. These tests describe the
// provider's answers as fetch-like mocks on global.fetch, so the client is
// bridged to it; the SSRF policy itself is tested in safe-http-client.spec.
jest.mock('../common/security/safe-http-client.js', () => {
  const actual = jest.requireActual('../common/security/safe-http-client.js');
  const viaFetch = async (url: string, init: Record<string, unknown>) => {
    const r = await (global.fetch as unknown as jest.Mock)(url, init);
    const statusCode =
      typeof r.status === 'number' ? r.status : r.ok ? 200 : 500;
    const body =
      typeof r.json === 'function' ? JSON.stringify(await r.json()) : '';
    return { statusCode, body };
  };
  return {
    ...actual,
    safePost: jest.fn((url: string, body: string, headers: unknown) =>
      viaFetch(url, { method: 'POST', headers, body }),
    ),
    safeGet: jest.fn((url: string, headers: unknown) =>
      viaFetch(url, { headers }),
    ),
  };
});
import {
  safeGet,
  safePost,
  SsrfBlockedError,
} from '../common/security/safe-http-client.js';

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  BrokerService,
  FEDERATED_LINK_CONFLICT,
  FederatedLinkConflictException,
} from './broker.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';
import { CryptoService } from '../crypto/crypto.service.js';

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
  let samlBroker: { createStart: jest.Mock };
  let events: { recordLoginEvent: jest.Mock };

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
    samlBroker = {
      createStart: jest.fn(),
    };
    events = { recordLoginEvent: jest.fn().mockResolvedValue(undefined) };

    service = new BrokerService(
      lookupsBackedBy(prisma as any) as any,
      prisma as any,
      jwkService as any,
      idpService as any,
      new CryptoService(),
      samlBroker as any,
      events as any,
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
      codeChallenge: 'challenge-abc',
      codeChallengeMethod: 'S256',
    };

    const githubIdp = {
      ...mockIdp,
      alias: 'github',
      displayName: 'GitHub',
      userinfoUrl: 'https://api.github.com/user',
      defaultScopes: 'read:user user:email',
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

      // The broker no longer mints a code itself: it hands the user and the
      // original OAuth request to the shared login flow, which applies the
      // realm's MFA policy, consent and session like any other sign-in.
      expect(result).toEqual({
        user: mockUser,
        oauthParams: {
          response_type: 'code',
          client_id: 'my-app',
          redirect_uri: 'https://example.com/callback',
          scope: 'openid',
          state: 'client-state',
          nonce: 'client-nonce',
          // Finding #15: PKCE carried through the broker so the code→token
          // exchange can enforce it for public clients.
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
        },
      });
      expect(prisma.authorizationCode.create).not.toHaveBeenCalled();
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

      expect(result.user.id).toBe('new-user-1');
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

      expect(result.user).toBe(mockUser);
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

    it('does not link an existing account by an email the provider has not verified', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(brokerState);
      idpService.findByAlias.mockResolvedValue({
        ...mockIdp,
        trustEmail: true,
      });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'ext-access-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ ...externalUserInfo, email_verified: false }),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'new-user-9' });
      prisma.federatedIdentity.create.mockResolvedValue({});

      const result = await service.handleCallback(
        mockRealm,
        'google',
        'auth-code',
        'state-jwt',
      );

      // Not the existing account: registering someone else's address at the
      // provider must not be enough to sign in as them here.
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(result.user.id).toBe('new-user-9');
    });

    it('should not carry a state param when broker state has no state', async () => {
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

      expect(result.oauthParams).not.toHaveProperty('state');
      expect(result.oauthParams['client_id']).toBe('my-app');
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

    // The token and userinfo URLs are set by a realm admin: both go through
    // the SSRF-safe client, and a refused target fails the login cleanly.
    describe('outbound calls to the provider', () => {
      beforeEach(() => {
        (safePost as jest.Mock).mockClear();
        (safeGet as jest.Mock).mockClear();
        prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
        jwkService.verifyJwt.mockResolvedValue(brokerState);
      });

      it('sends the token exchange and userinfo through the SSRF-safe client', async () => {
        idpService.findByAlias.mockResolvedValue(mockIdp);
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            json: jest
              .fn()
              .mockResolvedValue({ access_token: 'ext-access-token' }),
          })
          .mockResolvedValueOnce({ ok: false, status: 401 });

        await expect(
          service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
        ).rejects.toThrow(UnauthorizedException);

        expect(safePost).toHaveBeenCalledWith(
          mockIdp.tokenUrl,
          expect.stringContaining('grant_type=authorization_code'),
          expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
          expect.anything(),
        );
        expect(safeGet).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ Authorization: 'Bearer ext-access-token' }),
          expect.objectContaining({ maxBytes: expect.any(Number) }),
        );
      });

      it('fails the login when the token URL points at a private or metadata address', async () => {
        idpService.findByAlias.mockResolvedValue({
          ...mockIdp,
          tokenUrl: 'http://169.254.169.254/latest/meta-data/iam',
        });
        (safePost as jest.Mock).mockRejectedValueOnce(
          new SsrfBlockedError(
            'Delivery blocked: target address is not publicly routable',
          ),
        );

        await expect(
          service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
        ).rejects.toThrow('Failed to exchange code with external provider');
        expect(safeGet).not.toHaveBeenCalled();
      });

      it('fails the login when the userinfo URL is refused', async () => {
        idpService.findByAlias.mockResolvedValue({
          ...mockIdp,
          userinfoUrl: 'http://10.0.0.5/admin',
        });
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'ext-access-token' }),
        });
        (safeGet as jest.Mock).mockRejectedValueOnce(
          new SsrfBlockedError(
            'Delivery blocked: target address is not publicly routable',
          ),
        );

        await expect(
          service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
        ).rejects.toThrow('Failed to fetch user info from external provider');
      });

      it('fails the login when the provider does not answer JSON', async () => {
        idpService.findByAlias.mockResolvedValue(mockIdp);
        (safePost as jest.Mock).mockResolvedValueOnce({
          statusCode: 200,
          body: '<html>not json</html>',
        });

        await expect(
          service.handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt'),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    // Finding #16: GitHub returns email=null for private emails; fall back to
    // /user/emails and pick the primary verified address.
    it('should resolve a GitHub private email via /user/emails and send a User-Agent', async () => {
      const githubState = { ...brokerState, alias: 'github' };
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(githubState);
      idpService.findByAlias.mockResolvedValue({
        ...githubIdp,
        trustEmail: true,
      });

      (global.fetch as jest.Mock)
        // 1. token exchange
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'gh-access-token' }),
        })
        // 2. /user (private email → null)
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ id: 4242, login: 'octocat', email: null }),
        })
        // 3. /user/emails
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue([
            { email: 'public@x.com', primary: false, verified: true },
            { email: 'x@y.com', primary: true, verified: true },
          ]),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'gh-user-1' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'github',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'x@y.com',
          emailVerified: true,
        }),
      });

      // The userinfo request (2nd fetch) must carry a User-Agent header.
      const userinfoCall = (global.fetch as jest.Mock).mock.calls[1];
      expect(userinfoCall[0]).toBe('https://api.github.com/user');
      expect(userinfoCall[1].headers['User-Agent']).toBe('Idenplane');

      // The /user/emails request (3rd fetch) must be made with GitHub headers.
      const emailsCall = (global.fetch as jest.Mock).mock.calls[2];
      expect(emailsCall[0]).toBe('https://api.github.com/user/emails');
      expect(emailsCall[1].headers['User-Agent']).toBe('Idenplane');
      expect(emailsCall[1].headers.Accept).toBe('application/vnd.github+json');
    });

    it('should leave email empty when GitHub /user/emails fails', async () => {
      const githubState = { ...brokerState, alias: 'github' };
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(githubState);
      idpService.findByAlias.mockResolvedValue(githubIdp);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'gh-access-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ id: 4242, login: 'octocat', email: null }),
        })
        // /user/emails returns 403 (e.g. missing scope) — must not crash login
        .mockResolvedValueOnce({ ok: false, status: 403 });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'gh-user-2' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'github',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: undefined }),
      });
    });

    // Finding #17: GitHub returns a single full `name`; split into first/last.
    it('should split a full name into firstName/lastName when given/family absent', async () => {
      const githubState = { ...brokerState, alias: 'github' };
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue(githubState);
      idpService.findByAlias.mockResolvedValue(githubIdp);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'gh-access-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            id: 4242,
            login: 'islam',
            email: 'islam@x.com',
            name: 'Islam Awad',
          }),
        });

      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...mockUser, id: 'gh-user-3' });
      prisma.federatedIdentity.create.mockResolvedValue({});
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.authorizationCode.create.mockResolvedValue({});

      await service.handleCallback(
        mockRealm,
        'github',
        'auth-code',
        'state-jwt',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: 'Islam',
          lastName: 'Awad',
          username: 'islam',
        }),
      });
    });
  });

  // ─── Custom-flow social steps ─────────────────────────────────

  describe('flow social steps', () => {
    const identity = (external: Record<string, unknown>, idp = mockIdp) => ({
      idp: idp as any,
      external: { sub: 'ext-1', ...external } as any,
    });

    it('initiateFlowLogin signs a state naming the transaction, step and nonce only', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.signJwt.mockResolvedValue('state-jwt');
      const url = new URL(
        await service.initiateFlowLogin(mockRealm, 'google', {
          txn: 'txn-1',
          step: 'social',
          nonce: 'n-1',
        }),
      );
      expect(url.searchParams.get('state')).toBe('state-jwt');
      const [payload] = jwkService.signJwt.mock.calls[0];
      expect(payload).toMatchObject({
        typ: 'broker_state',
        realmId: 'realm-1',
        alias: 'google',
        flow: { txn: 'txn-1', step: 'social', nonce: 'n-1' },
      });
      expect(payload.clientId).toBeUndefined();
    });

    it('fetchExternalIdentity refuses an answer without a subject', async () => {
      idpService.findByAlias.mockResolvedValue(mockIdp);
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'at' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'x@example.com' }),
        });
      await expect(
        service.fetchExternalIdentity(mockRealm, 'google', 'code'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('fetchExternalIdentity refuses a provider disabled since the redirect', async () => {
      idpService.findByAlias.mockResolvedValue({ ...mockIdp, enabled: false });
      await expect(
        service.fetchExternalIdentity(mockRealm, 'google', 'code'),
      ).rejects.toThrow(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('belongsToUser: an identity linked to the user', async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'user-1',
      });
      expect(await service.belongsToUser(identity({}), mockUser as any)).toBe(
        'linked',
      );
      expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
    });

    it('belongsToUser: an identity linked to someone else', async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        userId: 'other',
      });
      expect(
        await service.belongsToUser(
          identity(
            { email: 'test@example.com', emailVerified: true },
            {
              ...mockIdp,
              trustEmail: true,
            },
          ),
          mockUser as any,
        ),
      ).toBe('other_user');
      expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
    });

    it('belongsToUser: links through a verified email of a provider trusted for email', async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      expect(
        await service.belongsToUser(
          identity(
            { email: 'TEST@example.com', emailVerified: true },
            {
              ...mockIdp,
              trustEmail: true,
            },
          ),
          mockUser as any,
        ),
      ).toBe('linked');
      expect(prisma.federatedIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          identityProviderId: 'idp-1',
          externalUserId: 'ext-1',
        }),
      });
    });

    it.each([
      [
        'an untrusted provider',
        { email: 'test@example.com', emailVerified: true },
        false,
      ],
      [
        'an unverified email',
        { email: 'test@example.com', emailVerified: false },
        true,
      ],
      [
        'another email',
        { email: 'other@example.com', emailVerified: true },
        true,
      ],
    ])(
      'belongsToUser: not linked for %s, and nothing is created',
      async (_n, ext, trust) => {
        prisma.federatedIdentity.findUnique.mockResolvedValue(null);
        expect(
          await service.belongsToUser(
            identity(ext, { ...mockIdp, trustEmail: trust }),
            mockUser as any,
          ),
        ).toBe('not_linked');
        expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('an account already linked to the provider with another subject', () => {
    const conflictSetup = (idp: Record<string, unknown>) => {
      // No link for this external account; the user found by email already
      // has a link to the provider, for another external account.
      prisma.federatedIdentity.findUnique.mockImplementation(
        async (args: any) =>
          args.where.identityProviderId_externalUserId
            ? null
            : { externalUserId: 'old-subject' },
      );
      prisma.user.findFirst.mockResolvedValue(mockUser);
      return { ...mockIdp, trustEmail: true, ...idp } as any;
    };

    it.each([
      ['OIDC', { providerType: 'oidc' }],
      ['SAML', { providerType: 'saml', alias: 'okta', displayName: 'Okta' }],
    ])(
      '%s: refuses with a clear error and an event, and never relinks',
      async (_name, over) => {
        const idp = conflictSetup(over);
        await expect(
          service.resolveFederatedUser(mockRealm, {
            idp,
            external: {
              sub: 'new-subject',
              email: 'test@example.com',
              emailVerified: true,
            },
          }),
        ).rejects.toThrow(FederatedLinkConflictException);
        await expect(
          service.resolveFederatedUser(mockRealm, {
            idp,
            external: {
              sub: 'new-subject',
              email: 'test@example.com',
              emailVerified: true,
            },
          }),
        ).rejects.toThrow(/already linked to .* through a different/);
        expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(events.recordLoginEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            realmId: idp.realmId,
            userId: 'user-1',
            type: 'LOGIN_ERROR',
            error: FEDERATED_LINK_CONFLICT,
            details: expect.objectContaining({
              identityProvider: idp.alias,
              providerType: idp.providerType,
              externalUserId: 'new-subject',
              linkedExternalUserId: 'old-subject',
            }),
          }),
        );
      },
    );

    it('OIDC callback: the conflict is a 409, not a 500', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        realmId: 'realm-1',
        realmName: 'test-realm',
        alias: 'google',
        clientId: 'my-app',
        redirectUri: 'https://example.com/callback',
      });
      idpService.findByAlias.mockResolvedValue(conflictSetup({}));
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ access_token: 'at' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            sub: 'new-subject',
            email: 'test@example.com',
            email_verified: true,
          }),
        });
      const err = await service
        .handleCallback(mockRealm, 'google', 'auth-code', 'state-jwt')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FederatedLinkConflictException);
      expect((err as FederatedLinkConflictException).getStatus()).toBe(409);
    });

    it('belongsToUser (a pinned user) refuses the same way', async () => {
      const idp = conflictSetup({});
      await expect(
        service.belongsToUser(
          {
            idp,
            external: {
              sub: 'new-subject',
              email: 'test@example.com',
              emailVerified: true,
            },
          },
          mockUser as any,
        ),
      ).rejects.toThrow(FederatedLinkConflictException);
      expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
    });

    it('a concurrent link of the same external account is not a conflict', async () => {
      const idp = { ...mockIdp, trustEmail: true } as any;
      let linked = false;
      prisma.federatedIdentity.findUnique.mockImplementation(
        async (args: any) =>
          args.where.userId_identityProviderId && linked
            ? { externalUserId: 'same-subject' }
            : null,
      );
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.federatedIdentity.create.mockImplementation(async () => {
        linked = true;
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      });
      await expect(
        service.resolveFederatedUser(mockRealm, {
          idp,
          external: {
            sub: 'same-subject',
            email: 'test@example.com',
            emailVerified: true,
          },
        }),
      ).resolves.toBe(mockUser);
      expect(events.recordLoginEvent).not.toHaveBeenCalled();
    });
  });
});
