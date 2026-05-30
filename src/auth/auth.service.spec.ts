// Mock modules that transitively import jose (ESM-only) to avoid parse errors
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { AuthService } from './auth.service.js';
import { OAuthTokenError } from './oauth-token-error.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';
import { ACR_PASSWORD, ACR_MFA } from '../step-up/step-up.service.js';

/**
 * Assert that the given promise rejects with an {@link OAuthTokenError}
 * carrying the expected RFC 6749 §5.2 `error` code (and optional HTTP status).
 */
async function expectOAuthError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedStatus?: number,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(OAuthTokenError);
  try {
    await promise;
  } catch (err) {
    const tokenError = err as OAuthTokenError;
    expect(tokenError.code).toBe(expectedCode);
    expect((tokenError.getResponse() as { error: string }).error).toBe(
      expectedCode,
    );
    if (expectedStatus !== undefined) {
      expect(tokenError.httpStatus).toBe(expectedStatus);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

const FAKE_ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.fake-access-token';
const FAKE_ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.fake-id-token';
const FAKE_REFRESH_TOKEN_RAW = 'aabbccdd00112233';
const FAKE_REFRESH_TOKEN_HASH = 'hashed-refresh-token';
const FAKE_AT_HASH = 'at-hash-value';

const realm = {
  id: 'realm-1',
  name: 'test-realm',
  displayName: 'Test Realm',
  enabled: true,
  accessTokenLifespan: 300,
  refreshTokenLifespan: 1800,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
} as Realm;

const signingKey = {
  id: 'key-1',
  realmId: realm.id,
  kid: 'kid-1',
  algorithm: 'RS256',
  publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
  privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  active: true,
  createdAt: new Date('2025-01-01'),
};

const dbUser = {
  id: 'user-1',
  realmId: realm.id,
  username: 'testuser',
  email: 'test@example.com',
  emailVerified: true,
  firstName: 'Test',
  lastName: 'User',
  enabled: true,
  passwordHash: '$argon2id$hashed',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const dbClient = {
  id: 'client-db-id',
  realmId: realm.id,
  clientId: 'my-client',
  clientSecret: '$argon2id$hashed-secret',
  clientType: 'CONFIDENTIAL',
  enabled: true,
  grantTypes: [
    'password',
    'client_credentials',
    'refresh_token',
    'authorization_code',
  ],
  redirectUris: ['https://app.example.com/callback'],
  webOrigins: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const publicClient = {
  ...dbClient,
  id: 'public-client-db-id',
  clientId: 'public-client',
  clientType: 'PUBLIC',
  clientSecret: null as string | null,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockCryptoService() {
  return {
    hashPassword: jest.fn(),
    verifyPassword: jest.fn(),
    generateSecret: jest.fn().mockReturnValue(FAKE_REFRESH_TOKEN_RAW),
    sha256: jest.fn().mockReturnValue(FAKE_REFRESH_TOKEN_HASH),
  };
}

function createMockJwkService() {
  return {
    signJwt: jest.fn().mockResolvedValue(FAKE_ACCESS_TOKEN),
    computeAtHash: jest.fn().mockReturnValue(FAKE_AT_HASH),
    computeChash: jest.fn().mockReturnValue('fake-c-hash'),
    generateRsaKeyPair: jest.fn(),
    verifyJwt: jest.fn(),
    publicKeyToJwk: jest.fn(),
  };
}

function createMockScopesService() {
  return {
    parseAndValidate: jest.fn().mockReturnValue(['openid']),
    getClaimsForScopes: jest.fn().mockReturnValue(new Set(['sub'])),
    hasOpenidScope: jest.fn().mockReturnValue(true),
    toString: jest
      .fn()
      .mockImplementation((scopes: string[]) => scopes.join(' ')),
    getClientEffectiveScopes: jest.fn().mockResolvedValue(['openid']),
    getScopeMappers: jest.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let crypto: ReturnType<typeof createMockCryptoService>;
  let jwkService: ReturnType<typeof createMockJwkService>;
  let scopesService: ReturnType<typeof createMockScopesService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = createMockCryptoService();
    jwkService = createMockJwkService();
    scopesService = createMockScopesService();

    const bruteForceService = {
      checkLocked: jest.fn().mockReturnValue({ locked: false }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      resetFailures: jest.fn().mockResolvedValue(undefined),
    };
    const passwordPolicyService = {
      isExpired: jest.fn().mockReturnValue(false),
      validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };
    const mfaService = {
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      isMfaRequired: jest.fn().mockReturnValue(false),
      createMfaChallenge: jest.fn(),
      validateMfaChallenge: jest.fn(),
      verifyTotp: jest.fn(),
      verifyRecoveryCode: jest.fn(),
    };
    const protocolMapperExecutor = {
      executeMappers: jest.fn().mockResolvedValue({}),
    };

    const eventsService = {
      recordLoginEvent: jest.fn().mockResolvedValue(undefined),
      recordAdminEvent: jest.fn().mockResolvedValue(undefined),
    };
    const metricsService = {
      authLoginTotal: { inc: jest.fn() },
      authTokenIssuedTotal: { inc: jest.fn() },
      activeSessionsTotal: { inc: jest.fn(), dec: jest.fn() },
    };

    const customAttributesService = {
      getOidcClaimsForUser: jest.fn().mockResolvedValue({}),
    };

    const userFederationService = {
      authenticateViaFederation: jest
        .fn()
        .mockResolvedValue({ authenticated: false }),
    };

    service = new AuthService(
      prisma as any,
      crypto as any,
      jwkService as any,
      scopesService as any,
      bruteForceService as any,
      passwordPolicyService as any,
      mfaService as any,
      protocolMapperExecutor as any,
      eventsService as any,
      metricsService as any,
      customAttributesService as any,
      userFederationService as any,
    );
  });

  // -----------------------------------------------------------------------
  // Common setup helpers
  // -----------------------------------------------------------------------

  /** Set up the mocks so client validation passes for the confidential client. */
  function setupValidClient(client = dbClient) {
    prisma.client.findUnique.mockResolvedValue(client);
    crypto.verifyPassword.mockResolvedValue(true);
  }

  /** Set up signing key so issueTokens can proceed. */
  function setupSigningKey() {
    prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
  }

  /** Set up roles query to return empty arrays. */
  function setupEmptyRoles() {
    prisma.userRole.findMany.mockResolvedValue([]);
    (prisma as any).userGroup.findMany.mockResolvedValue([]);
  }

  /** Set up session creation. */
  function setupSessionCreate(sessionId = 'session-1') {
    prisma.session.create.mockResolvedValue({ id: sessionId });
  }

  /** Set up refresh token creation. */
  function setupRefreshTokenCreate() {
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
  }

  /** Convenience: set up everything needed for a successful token issue. */
  function setupForTokenIssuance(client = dbClient) {
    setupValidClient(client);
    setupSigningKey();
    setupEmptyRoles();
    setupSessionCreate();
    setupRefreshTokenCreate();
  }

  // -----------------------------------------------------------------------
  // Unsupported grant type
  // -----------------------------------------------------------------------

  describe('handleTokenRequest - unsupported grant type', () => {
    it('should throw unsupported_grant_type for an unknown grant_type', async () => {
      await expectOAuthError(
        service.handleTokenRequest(realm, { grant_type: 'magic' }),
        'unsupported_grant_type',
        400,
      );
    });

    it('should throw invalid_request when grant_type is missing', async () => {
      await expectOAuthError(
        service.handleTokenRequest(realm, {}),
        'invalid_request',
        400,
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateClient
  // -----------------------------------------------------------------------

  describe('validateClient (via password grant)', () => {
    it('should throw invalid_client when client_id is missing', async () => {
      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: '',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw invalid_client when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'nonexistent',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw invalid_client when client is disabled', async () => {
      prisma.client.findUnique.mockResolvedValue({
        ...dbClient,
        enabled: false,
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'secret',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw invalid_client when client_secret is wrong for a confidential client', async () => {
      prisma.client.findUnique.mockResolvedValue(dbClient);
      crypto.verifyPassword.mockResolvedValue(false);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'wrong-secret',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw invalid_client when confidential client has no secret configured', async () => {
      prisma.client.findUnique.mockResolvedValue({
        ...dbClient,
        clientSecret: null,
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'some-secret',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw invalid_client when confidential client receives no client_secret', async () => {
      prisma.client.findUnique.mockResolvedValue(dbClient);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_client',
        401,
      );
    });

    it('should throw unauthorized_client when grant type is not allowed for the client', async () => {
      prisma.client.findUnique.mockResolvedValue({
        ...dbClient,
        grantTypes: ['client_credentials'],
      });
      crypto.verifyPassword.mockResolvedValue(true);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'secret',
          username: 'testuser',
          password: 'pass',
        }),
        'unauthorized_client',
        400,
      );
    });

    it('should succeed for a valid confidential client', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid',
      });

      expect(result.access_token).toBeDefined();
    });

    it('includes acr in the access token (RFC 9068, finding #12)', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid',
      });

      // signJwt is called for the access token first, then the id_token.
      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload).toHaveProperty('acr');
    });

    it('should not require client_secret for a public client', async () => {
      setupForTokenIssuance(publicClient as any);
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'public-client',
        username: 'testuser',
        password: 'pass',
        scope: 'openid',
      });

      expect(result.access_token).toBeDefined();
      // verifyPassword called once for user password only, not for client
      expect(crypto.verifyPassword).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // password grant
  // -----------------------------------------------------------------------

  describe('password grant', () => {
    it('should return a valid token response for correct credentials', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.handleTokenRequest(
        realm,
        {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
          scope: 'openid',
        },
        '127.0.0.1',
        'jest-agent',
      );

      expect(result).toEqual(
        expect.objectContaining({
          access_token: FAKE_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: realm.accessTokenLifespan,
          refresh_token: FAKE_REFRESH_TOKEN_RAW,
          scope: 'openid',
          id_token: FAKE_ACCESS_TOKEN, // signJwt mock returns same value for both calls
        }),
      );
      // OIDC Session Management: a session_state is now emitted.
      expect(result).toHaveProperty('session_state');

      // Verify session was created with ip and user agent
      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: dbUser.id,
            ipAddress: '127.0.0.1',
            userAgent: 'jest-agent',
          }),
        }),
      );

      // Verify refresh token was persisted
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tokenHash: FAKE_REFRESH_TOKEN_HASH,
          }),
        }),
      );
    });

    it('should throw invalid_request when username is missing', async () => {
      setupValidClient();

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          password: 'pass',
        }),
        'invalid_request',
        400,
      );
    });

    it('should throw invalid_request when password is missing', async () => {
      setupValidClient();

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
        }),
        'invalid_request',
        400,
      );
    });

    it('should throw invalid_grant when user does not exist', async () => {
      setupValidClient();
      prisma.user.findUnique.mockResolvedValue(null);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'nonexistent',
          password: 'pass',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when user is disabled', async () => {
      setupValidClient();
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, enabled: false });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when user has no passwordHash', async () => {
      setupValidClient();
      prisma.user.findUnique.mockResolvedValue({
        ...dbUser,
        passwordHash: null,
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when password is incorrect', async () => {
      prisma.client.findUnique.mockResolvedValue(dbClient);
      prisma.user.findUnique.mockResolvedValue(dbUser);
      // First call: client secret check (true), second: password check (false)
      crypto.verifyPassword
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'wrong-password',
        }),
        'invalid_grant',
        400,
      );
    });
  });

  // -----------------------------------------------------------------------
  // client_credentials grant
  // -----------------------------------------------------------------------

  describe('client_credentials grant', () => {
    it('should return a token without refresh_token for valid client credentials', async () => {
      setupValidClient();
      setupSigningKey();

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'client_credentials',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        scope: 'openid',
      });

      expect(result).toEqual({
        access_token: FAKE_ACCESS_TOKEN,
        token_type: 'Bearer',
        expires_in: realm.accessTokenLifespan,
        scope: 'openid',
      });

      // Should NOT create a session or refresh token
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should default scope to "openid" when no scope is supplied', async () => {
      setupValidClient();
      setupSigningKey();

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'client_credentials',
        client_id: 'my-client',
        client_secret: 'correct-secret',
      });

      expect(result.scope).toBe('openid');
    });

    it('should throw invalid_client when client_secret is wrong', async () => {
      prisma.client.findUnique.mockResolvedValue(dbClient);
      crypto.verifyPassword.mockResolvedValue(false);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'client_credentials',
          client_id: 'my-client',
          client_secret: 'wrong-secret',
        }),
        'invalid_client',
        401,
      );
    });

    it('should sign the JWT with the correct payload shape', async () => {
      setupValidClient();
      setupSigningKey();

      await service.handleTokenRequest(realm, {
        grant_type: 'client_credentials',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        scope: 'openid profile',
      });

      expect(jwkService.signJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: dbClient.id,
          aud: 'my-client',
          azp: 'my-client',
          typ: 'Bearer',
          scope: 'openid profile',
        }),
        signingKey.privateKey,
        signingKey.kid,
        realm.accessTokenLifespan,
      );
    });
  });

  // -----------------------------------------------------------------------
  // refresh_token grant
  // -----------------------------------------------------------------------

  describe('refresh_token grant', () => {
    const storedRefreshToken = {
      id: 'rt-1',
      sessionId: 'session-1',
      tokenHash: FAKE_REFRESH_TOKEN_HASH,
      clientId: 'my-client', // Must match the requesting client
      revoked: false,
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      session: {
        id: 'session-1',
        user: dbUser,
        satisfiedAcr: null as string | null,
        amr: [] as string[],
      },
    };

    it('should rotate the refresh token and return new tokens', async () => {
      setupValidClient();
      setupSigningKey();
      setupEmptyRoles();
      setupRefreshTokenCreate();

      prisma.refreshToken.findUnique.mockResolvedValue(storedRefreshToken);
      prisma.refreshToken.update.mockResolvedValue({
        ...storedRefreshToken,
        revoked: true,
      });

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'refresh_token',
        refresh_token: 'orig-opaque-rt',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        scope: 'openid',
      });

      expect(result.access_token).toBe(FAKE_ACCESS_TOKEN);
      expect(result.refresh_token).toBe(FAKE_REFRESH_TOKEN_RAW);
      expect(result.token_type).toBe('Bearer');

      // Old token should be revoked
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: storedRefreshToken.id },
        data: { revoked: true },
      });

      // New refresh token should be created
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('preserves the session acr/amr across refresh (no downgrade to password)', async () => {
      setupValidClient();
      setupSigningKey();
      setupEmptyRoles();
      setupRefreshTokenCreate();

      const mfaToken = {
        ...storedRefreshToken,
        session: {
          ...storedRefreshToken.session,
          satisfiedAcr: ACR_MFA,
          amr: ['pwd', 'otp'],
        },
      };
      prisma.refreshToken.findUnique.mockResolvedValue(mfaToken);
      prisma.refreshToken.update.mockResolvedValue({
        ...mfaToken,
        revoked: true,
      });

      await service.handleTokenRequest(realm, {
        grant_type: 'refresh_token',
        refresh_token: 'orig-opaque-rt',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        scope: 'openid',
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.acr).toBe(ACR_MFA);
      expect(accessTokenPayload.amr).toEqual(['pwd', 'otp']);
    });

    it('should throw invalid_request when refresh_token is missing', async () => {
      setupValidClient();

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_request',
        400,
      );
    });

    it('should throw invalid_grant when refresh token does not exist', async () => {
      setupValidClient();
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          refresh_token: 'nonexistent-token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when refresh token is expired', async () => {
      setupValidClient();
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedRefreshToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          refresh_token: 'expired-token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant and revoke entire session when a revoked token is reused (reuse detection)', async () => {
      setupValidClient();
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedRefreshToken,
        revoked: true,
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          refresh_token: 'reused-token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_grant',
        400,
      );

      // All tokens for the session should be revoked
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { sessionId: storedRefreshToken.sessionId },
        data: { revoked: true },
      });
    });

    it('should not revoke session tokens when a non-revoked expired token is used', async () => {
      setupValidClient();
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedRefreshToken,
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          refresh_token: 'expired-token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_grant',
        400,
      );

      // updateMany should NOT be called because token was not revoked
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should hash the incoming refresh_token to look it up', async () => {
      setupValidClient();
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'refresh_token',
          refresh_token: 'some-opaque-token',
          client_id: 'my-client',
          client_secret: 'correct-secret',
        }),
        'invalid_grant',
        400,
      );

      expect(crypto.sha256).toHaveBeenCalledWith('some-opaque-token');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: FAKE_REFRESH_TOKEN_HASH },
        include: { session: { include: { user: true } } },
      });
    });
  });

  // -----------------------------------------------------------------------
  // authorization_code grant
  // -----------------------------------------------------------------------

  describe('authorization_code grant', () => {
    const futureDate = new Date(Date.now() + 60_000);

    const authCode = {
      id: 'authcode-1',
      code: 'valid-auth-code',
      clientId: dbClient.id,
      userId: dbUser.id,
      redirectUri: 'https://app.example.com/callback',
      scope: 'openid profile',
      nonce: 'test-nonce',
      codeChallenge: null,
      codeChallengeMethod: null,
      acrValues: null as string | null,
      satisfiedAcr: null as string | null,
      amr: [] as string[],
      used: false,
      expiresAt: futureDate,
      createdAt: new Date(),
    };

    // Helper: simulate Prisma P2025 "record not found" error (thrown by update
    // when no row matches the compound where clause).
    function makePrismaP2025() {
      const err = new Error('Record to update not found.');
      (err as any).code = 'P2025';
      return err;
    }

    it('should return tokens for a valid authorization code', async () => {
      setupForTokenIssuance();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        used: true,
      });
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.handleTokenRequest(
        realm,
        {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        },
        '127.0.0.1',
        'jest-agent',
      );

      expect(result.access_token).toBe(FAKE_ACCESS_TOKEN);
      expect(result.refresh_token).toBe(FAKE_REFRESH_TOKEN_RAW);
      expect(result.token_type).toBe('Bearer');

      // Code should be atomically marked as used via a compound-where update
      expect(prisma.authorizationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            code: 'valid-auth-code',
            used: false,
          }),
          data: { used: true },
        }),
      );
    });

    it('reflects the satisfied MFA context (acr/amr) when the code carries it', async () => {
      setupForTokenIssuance();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        satisfiedAcr: ACR_MFA,
        amr: ['pwd', 'otp'],
        used: true,
      });
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.handleTokenRequest(
        realm,
        {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        },
        '127.0.0.1',
        'jest-agent',
      );

      // signJwt[0] = access token payload, signJwt[1] = id token payload
      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      const idTokenPayload = jwkService.signJwt.mock.calls[1][0];
      expect(accessTokenPayload.acr).toBe(ACR_MFA);
      expect(accessTokenPayload.amr).toEqual(['pwd', 'otp']);
      expect(idTokenPayload.acr).toBe(ACR_MFA);
      expect(idTokenPayload.amr).toContain('otp');

      // The satisfied context is also persisted on the new session so refresh
      // can preserve it.
      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            satisfiedAcr: ACR_MFA,
            amr: ['pwd', 'otp'],
          }),
        }),
      );
    });

    it('defaults to password-level acr/amr when the code carries no satisfied context', async () => {
      setupForTokenIssuance();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        satisfiedAcr: null,
        amr: [],
        used: true,
      });
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.handleTokenRequest(
        realm,
        {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        },
        '127.0.0.1',
        'jest-agent',
      );

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.acr).toBe(ACR_PASSWORD);
      expect(accessTokenPayload.amr).toEqual(['pwd']);
    });

    it('should throw invalid_request when code is missing', async () => {
      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_request',
        400,
      );
    });

    it('should throw invalid_grant when code does not exist', async () => {
      setupValidClient();
      // update throws P2025 because no row matches (code doesn't exist)
      prisma.authorizationCode.update.mockRejectedValue(makePrismaP2025());

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'nonexistent-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when code is expired', async () => {
      setupValidClient();
      // update throws P2025 because the expiresAt filter excludes the expired row
      prisma.authorizationCode.update.mockRejectedValue(makePrismaP2025());

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'expired-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when code was already used', async () => {
      setupValidClient();
      // update throws P2025 because used:false filter excludes the already-used row
      prisma.authorizationCode.update.mockRejectedValue(makePrismaP2025());

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'used-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when code belongs to a different client', async () => {
      setupValidClient();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        clientId: 'some-other-client-db-id',
        used: true,
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'stolen-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when redirect_uri does not match', async () => {
      setupValidClient();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        used: true,
      });

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://evil.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    it('should throw invalid_grant when user is not found for the code', async () => {
      setupValidClient();
      setupSigningKey();
      setupSessionCreate();
      prisma.authorizationCode.update.mockResolvedValue({
        ...authCode,
        used: true,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
        }),
        'invalid_grant',
        400,
      );
    });

    describe('PKCE', () => {
      const pkceAuthCode = {
        ...authCode,
        codeChallenge: 'expected-challenge',
        codeChallengeMethod: 'S256',
      };

      it('should throw invalid_request when code has PKCE but code_verifier is missing', async () => {
        setupValidClient();
        // update succeeds (code exists, not used, not expired) and returns the pkce code
        prisma.authorizationCode.update.mockResolvedValue({
          ...pkceAuthCode,
          used: true,
        });

        await expectOAuthError(
          service.handleTokenRequest(realm, {
            grant_type: 'authorization_code',
            code: 'valid-auth-code',
            client_id: 'my-client',
            client_secret: 'correct-secret',
            redirect_uri: 'https://app.example.com/callback',
          }),
          'invalid_request',
          400,
        );
      });

      it('should throw invalid_grant when code_verifier does not match', async () => {
        setupValidClient();
        // update succeeds and returns the pkce code
        prisma.authorizationCode.update.mockResolvedValue({
          ...pkceAuthCode,
          used: true,
        });
        // sha256 returns a hex string; the base64url of its buffer will not match the stored challenge
        crypto.sha256.mockReturnValue('aabbccdd');

        await expectOAuthError(
          service.handleTokenRequest(realm, {
            grant_type: 'authorization_code',
            code: 'valid-auth-code',
            client_id: 'my-client',
            client_secret: 'correct-secret',
            redirect_uri: 'https://app.example.com/callback',
            code_verifier: 'wrong-verifier',
          }),
          'invalid_grant',
          400,
        );
      });

      it('should succeed when code_verifier is valid', async () => {
        const hexHash = 'aabbccdd';
        const expectedChallenge = Buffer.from(hexHash, 'hex').toString(
          'base64url',
        );

        setupForTokenIssuance();
        prisma.authorizationCode.update.mockResolvedValue({
          ...pkceAuthCode,
          codeChallenge: expectedChallenge,
          used: true,
        });
        prisma.user.findUnique.mockResolvedValue(dbUser);
        crypto.sha256.mockReturnValue(hexHash);

        const result = await service.handleTokenRequest(realm, {
          grant_type: 'authorization_code',
          code: 'valid-auth-code',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          redirect_uri: 'https://app.example.com/callback',
          code_verifier: 'correct-verifier',
        });

        expect(result.access_token).toBeDefined();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Device code grant — polling interval enforcement (RFC 8628 §3.5)
  // -----------------------------------------------------------------------

  describe('handleTokenRequest - device_code grant', () => {
    const deviceClientId = 'device-client';
    const deviceClientSecret = 'device-secret';

    const deviceClient = {
      ...dbClient,
      clientId: deviceClientId,
      clientSecret: '$argon2id$hashed-device-secret',
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
    };

    function makeDeviceCode(overrides: Record<string, unknown> = {}) {
      return {
        id: 'dc-1',
        deviceCode: 'test-device-code',
        userCode: 'ABCD-EFGH',
        clientId: deviceClient.id,
        realmId: realm.id,
        scope: 'openid',
        userId: dbUser.id,
        approved: true,
        denied: false,
        interval: 5,
        lastPolledAt: null as Date | null,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date(),
        ...overrides,
      };
    }

    function setupDeviceClient() {
      prisma.client.findUnique.mockResolvedValue(deviceClient as any);
      crypto.verifyPassword.mockResolvedValue(true);
    }

    it('should throw slow_down when polled before the interval elapses', async () => {
      setupDeviceClient();
      prisma.deviceCode.findUnique.mockResolvedValue(
        makeDeviceCode({
          // lastPolledAt is only 2 seconds ago — interval is 5 s, so too soon
          lastPolledAt: new Date(Date.now() - 2_000),
        }) as any,
      );
      prisma.deviceCode.update.mockResolvedValue({} as any);

      const promise = service.handleTokenRequest(realm, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'test-device-code',
        client_id: deviceClientId,
        client_secret: deviceClientSecret,
      });
      await expectOAuthError(promise, 'slow_down', 400);
      // RFC 8628 §3.5 codes carry no error_description.
      try {
        await promise;
      } catch (err) {
        expect((err as OAuthTokenError).getResponse()).toEqual({
          error: 'slow_down',
        });
      }
    });

    it('should increase the polling interval by 5 seconds when returning slow_down', async () => {
      setupDeviceClient();
      const dc = makeDeviceCode({
        lastPolledAt: new Date(Date.now() - 2_000),
        interval: 5,
      });
      prisma.deviceCode.findUnique.mockResolvedValue(dc as any);
      prisma.deviceCode.update.mockResolvedValue({} as any);

      await expect(
        service.handleTokenRequest(realm, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: 'test-device-code',
          client_id: deviceClientId,
          client_secret: deviceClientSecret,
        }),
      ).rejects.toThrow('slow_down');

      // The update must bump the interval by 5
      expect(prisma.deviceCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            interval: 10,
            lastPolledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should not throw slow_down when polled after the full interval has elapsed', async () => {
      setupForTokenIssuance(deviceClient);
      const dc = makeDeviceCode({
        // 6 seconds ago — safely past the 5 s interval
        lastPolledAt: new Date(Date.now() - 6_000),
      });
      prisma.deviceCode.findUnique.mockResolvedValue(dc as any);
      prisma.deviceCode.update.mockResolvedValue({} as any);
      prisma.user.findUnique.mockResolvedValue(dbUser as any);

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'test-device-code',
        client_id: deviceClientId,
        client_secret: deviceClientSecret,
      });

      expect(result.access_token).toBeDefined();
    });

    it('should not throw slow_down on the very first poll (no lastPolledAt)', async () => {
      setupForTokenIssuance(deviceClient);
      const dc = makeDeviceCode({ lastPolledAt: null });
      prisma.deviceCode.findUnique.mockResolvedValue(dc as any);
      prisma.deviceCode.update.mockResolvedValue({} as any);
      prisma.user.findUnique.mockResolvedValue(dbUser as any);

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'test-device-code',
        client_id: deviceClientId,
        client_secret: deviceClientSecret,
      });

      expect(result.access_token).toBeDefined();
    });

    it('should record the poll timestamp on a normal (non-slow) poll', async () => {
      setupForTokenIssuance(deviceClient);
      const dc = makeDeviceCode({ lastPolledAt: null });
      prisma.deviceCode.findUnique.mockResolvedValue(dc as any);
      prisma.deviceCode.update.mockResolvedValue({} as any);
      prisma.user.findUnique.mockResolvedValue(dbUser as any);

      await service.handleTokenRequest(realm, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'test-device-code',
        client_id: deviceClientId,
        client_secret: deviceClientSecret,
      });

      // The first update call must set lastPolledAt without changing interval
      expect(prisma.deviceCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastPolledAt: expect.any(Date) }),
        }),
      );
    });

    it('should throw authorization_pending when not yet approved', async () => {
      setupDeviceClient();
      prisma.deviceCode.findUnique.mockResolvedValue(
        makeDeviceCode({ approved: false, userId: null }) as any,
      );
      prisma.deviceCode.update.mockResolvedValue({} as any);

      const promise = service.handleTokenRequest(realm, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'test-device-code',
        client_id: deviceClientId,
        client_secret: deviceClientSecret,
      });
      await expectOAuthError(promise, 'authorization_pending', 400);
      try {
        await promise;
      } catch (err) {
        expect((err as OAuthTokenError).getResponse()).toEqual({
          error: 'authorization_pending',
        });
      }
    });

    it('should throw access_denied when device is denied', async () => {
      setupDeviceClient();
      prisma.deviceCode.findUnique.mockResolvedValue(
        makeDeviceCode({ denied: true }) as any,
      );
      prisma.deviceCode.update.mockResolvedValue({} as any);

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: 'test-device-code',
          client_id: deviceClientId,
          client_secret: deviceClientSecret,
        }),
        'access_denied',
        400,
      );
    });

    it('should throw expired_token when device code is expired', async () => {
      setupDeviceClient();
      prisma.deviceCode.findUnique.mockResolvedValue(
        makeDeviceCode({ expiresAt: new Date(Date.now() - 1_000) }) as any,
      );

      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: 'test-device-code',
          client_id: deviceClientId,
          client_secret: deviceClientSecret,
        }),
        'expired_token',
        400,
      );
    });

    it('should throw invalid_request when device_code parameter is missing', async () => {
      await expectOAuthError(
        service.handleTokenRequest(realm, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: deviceClientId,
          client_secret: deviceClientSecret,
        }),
        'invalid_request',
        400,
      );
    });
  });

  // -----------------------------------------------------------------------
  // issueTokens - ID token generation and scope filtering
  // -----------------------------------------------------------------------

  describe('issueTokens', () => {
    it('should include id_token when openid scope is present', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.hasOpenidScope.mockReturnValue(true);

      // signJwt returns different tokens for access vs. id
      jwkService.signJwt
        .mockResolvedValueOnce(FAKE_ACCESS_TOKEN)
        .mockResolvedValueOnce(FAKE_ID_TOKEN);

      const result = await service.handleTokenRequest(
        realm,
        {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
          scope: 'openid',
        },
        '127.0.0.1',
      );

      expect(result.id_token).toBe(FAKE_ID_TOKEN);
      // signJwt should be called twice: access token + id token
      expect(jwkService.signJwt).toHaveBeenCalledTimes(2);

      // The second call (id token) should include at_hash and typ: 'ID'
      const idTokenPayload = jwkService.signJwt.mock.calls[1][0];
      expect(idTokenPayload).toEqual(
        expect.objectContaining({
          typ: 'ID',
          at_hash: FAKE_AT_HASH,
        }),
      );
    });

    it('should not include id_token when openid scope is absent', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.hasOpenidScope.mockReturnValue(false);

      const result = await service.handleTokenRequest(
        realm,
        {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
          scope: 'profile',
        },
        '127.0.0.1',
      );

      expect(result.id_token).toBeUndefined();
      // signJwt should be called only once (access token)
      expect(jwkService.signJwt).toHaveBeenCalledTimes(1);
    });

    it('should include nonce in id_token when provided via authorization_code grant', async () => {
      const codeWithNonce = {
        id: 'authcode-1',
        code: 'valid-auth-code',
        clientId: dbClient.id,
        userId: dbUser.id,
        redirectUri: 'https://app.example.com/callback',
        scope: 'openid',
        nonce: 'my-nonce-value',
        codeChallenge: null,
        codeChallengeMethod: null,
        acrValues: null,
        satisfiedAcr: null,
        amr: [] as string[],
        used: false,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      };

      setupForTokenIssuance();
      prisma.authorizationCode.findUnique.mockResolvedValue(codeWithNonce);
      prisma.authorizationCode.update.mockResolvedValue({
        ...codeWithNonce,
        used: true,
      });
      prisma.user.findUnique.mockResolvedValue(dbUser);
      jwkService.signJwt
        .mockResolvedValueOnce(FAKE_ACCESS_TOKEN)
        .mockResolvedValueOnce(FAKE_ID_TOKEN);

      await service.handleTokenRequest(realm, {
        grant_type: 'authorization_code',
        code: 'valid-auth-code',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        redirect_uri: 'https://app.example.com/callback',
      });

      // The second signJwt call (id token) should include the nonce
      const idTokenPayload = jwkService.signJwt.mock.calls[1][0];
      expect(idTokenPayload).toEqual(
        expect.objectContaining({
          nonce: 'my-nonce-value',
        }),
      );
    });

    it('should default scopes to ["openid"] when no scope is provided', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.parseAndValidate.mockReturnValue([]);
      scopesService.toString.mockReturnValue('openid');

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
      });

      expect(result.scope).toBe('openid');
      expect(scopesService.getClaimsForScopes).toHaveBeenCalledWith(['openid']);
    });

    it('should throw when no active signing key exists', async () => {
      setupValidClient();
      setupSessionCreate();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(
        service.handleTokenRequest(realm, {
          grant_type: 'password',
          client_id: 'my-client',
          client_secret: 'correct-secret',
          username: 'testuser',
          password: 'pass',
          scope: 'openid',
        }),
      ).rejects.toThrow('No active signing key found for realm');
    });

    it('should include realm_access and resource_access when roles scope grants them', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      scopesService.getClaimsForScopes.mockReturnValue(
        new Set(['sub', 'realm_access', 'resource_access']),
      );

      prisma.userRole.findMany.mockResolvedValue([
        {
          userId: dbUser.id,
          roleId: 'role-1',
          role: { id: 'role-1', name: 'admin', clientId: null, client: null },
        },
        {
          userId: dbUser.id,
          roleId: 'role-2',
          role: {
            id: 'role-2',
            name: 'viewer',
            clientId: dbClient.id,
            client: { clientId: 'my-client' },
          },
        },
      ]);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid roles',
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.realm_access).toEqual({
        roles: ['admin'],
      });
      expect(accessTokenPayload.resource_access).toEqual({
        'my-client': { roles: ['viewer'] },
      });
    });

    it('should include roles by default when scope parameter is not provided', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.getClaimsForScopes.mockReturnValue(new Set(['sub']));
      scopesService.parseAndValidate.mockReturnValue([]);
      scopesService.toString.mockReturnValue('openid');

      prisma.userRole.findMany.mockResolvedValue([
        {
          userId: dbUser.id,
          roleId: 'role-1',
          role: { id: 'role-1', name: 'user', clientId: null, client: null },
        },
      ]);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        // no scope parameter
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.realm_access).toEqual({
        roles: ['user'],
      });
    });

    it('should exclude roles when explicit scope is provided without roles scope', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.parseAndValidate.mockReturnValue(['openid', 'profile']);
      scopesService.toString.mockReturnValue('openid profile');
      scopesService.getClaimsForScopes.mockReturnValue(
        new Set(['sub', 'name', 'preferred_username']),
      );

      prisma.userRole.findMany.mockResolvedValue([
        {
          userId: dbUser.id,
          roleId: 'role-1',
          role: { id: 'role-1', name: 'admin', clientId: null, client: null },
        },
      ]);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid profile',
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      // scope is provided and realm_access is NOT in allowedClaims, so roles excluded
      expect(accessTokenPayload.realm_access).toBeUndefined();
      expect(accessTokenPayload.resource_access).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Scope filtering of claims
  // -----------------------------------------------------------------------

  describe('scope filtering of claims', () => {
    it('should pass the correct scopes through to getClaimsForScopes', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.parseAndValidate.mockReturnValue(['openid', 'email']);
      scopesService.toString.mockReturnValue('openid email');
      scopesService.getClaimsForScopes.mockReturnValue(
        new Set(['sub', 'email', 'email_verified']),
      );

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid email',
      });

      expect(scopesService.parseAndValidate).toHaveBeenCalledWith(
        'openid email',
      );
      expect(scopesService.getClaimsForScopes).toHaveBeenCalledWith([
        'openid',
        'email',
      ]);
    });

    it('should call getClaimsForScopes twice when openid scope triggers id token', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.parseAndValidate.mockReturnValue(['openid', 'profile']);
      scopesService.toString.mockReturnValue('openid profile');
      scopesService.getClaimsForScopes.mockReturnValue(
        new Set([
          'sub',
          'name',
          'preferred_username',
          'given_name',
          'family_name',
        ]),
      );
      scopesService.hasOpenidScope.mockReturnValue(true);

      jwkService.signJwt
        .mockResolvedValueOnce(FAKE_ACCESS_TOKEN)
        .mockResolvedValueOnce(FAKE_ID_TOKEN);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid profile',
      });

      // Called once for access token claims, once for id token claims
      expect(scopesService.getClaimsForScopes).toHaveBeenCalledTimes(2);
    });

    it('should set the validated scope string on the token response', async () => {
      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);
      scopesService.parseAndValidate.mockReturnValue(['openid', 'profile']);
      scopesService.toString.mockReturnValue('openid profile');

      const result = await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid profile bogus',
      });

      expect(result.scope).toBe('openid profile');
    });
  });

  // -----------------------------------------------------------------------
  // getIssuer
  // -----------------------------------------------------------------------

  describe('issuer', () => {
    it('should build the issuer from BASE_URL and realm name', async () => {
      process.env['BASE_URL'] = 'https://auth.example.com';

      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid',
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.iss).toBe(
        'https://auth.example.com/realms/test-realm',
      );

      delete process.env['BASE_URL'];
    });

    it('should default to http://localhost:3000 when BASE_URL is not set', async () => {
      delete process.env['BASE_URL'];

      setupForTokenIssuance();
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await service.handleTokenRequest(realm, {
        grant_type: 'password',
        client_id: 'my-client',
        client_secret: 'correct-secret',
        username: 'testuser',
        password: 'pass',
        scope: 'openid',
      });

      const accessTokenPayload = jwkService.signJwt.mock.calls[0][0];
      expect(accessTokenPayload.iss).toBe(
        'http://localhost:3000/realms/test-realm',
      );
    });
  });
});
