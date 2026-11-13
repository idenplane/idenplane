import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
// Mock modules that transitively import jose (ESM-only) to avoid parse errors
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import {
  AuthService,
  certificateBindingFor,
  withProtectedClaims,
} from './auth.service.js';
import { OAuthTokenError } from './oauth-token-error.js';
import {
  ClientAuthenticator,
  ClientAuthError,
} from '../client-auth/client-authenticator.js';
import { ClientCertificateResolverRegistry } from '../client-auth/client-certificate-resolver.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

/**
 * RFC 8705 §3 certificate-bound access tokens at the token endpoint: `cnf`
 * on every grant, set after mappers and plugins, refresh rebinding for
 * confidential clients and the same-certificate rule for public ones.
 */

const X5T = 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
const OTHER_X5T = 'AAAAgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
const cert = (x5tS256 = X5T) => ({ clientCert: { x5tS256 } as any });
const CNF = { 'x5t#S256': X5T };

const realm = {
  id: 'realm-1',
  name: 'test-realm',
  enabled: true,
  accessTokenLifespan: 300,
  refreshTokenLifespan: 1800,
  offlineTokenLifespan: 86400,
  mtlsClientAuthEnabled: true,
} as Realm;

const signingKey = {
  id: 'key-1',
  realmId: realm.id,
  kid: 'kid-1',
  publicKey: 'pub',
  privateKey: 'priv',
  active: true,
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
  updatedAt: new Date('2026-01-01'),
};

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const boundClient = {
  id: 'client-db-id',
  realmId: realm.id,
  clientId: 'bound-client',
  clientSecret: '$argon2id$hashed-secret',
  clientType: 'CONFIDENTIAL',
  enabled: true,
  grantTypes: [
    'password',
    'client_credentials',
    'refresh_token',
    'authorization_code',
    DEVICE_GRANT,
  ],
  redirectUris: ['https://app.example.com/callback'],
  serviceAccountUserId: null as string | null,
  tokenEndpointAuthMethod: null,
  tlsClientCertificateBoundAccessTokens: true,
};

const publicBoundClient = {
  ...boundClient,
  id: 'public-db-id',
  clientId: 'public-bound',
  clientType: 'PUBLIC',
  clientSecret: null as string | null,
};

const unboundClient = {
  ...boundClient,
  clientId: 'plain-client',
  tlsClientCertificateBoundAccessTokens: false,
};

async function expectOAuthError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  const err = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OAuthTokenError);
  expect((err as OAuthTokenError).code).toBe(code);
}

describe('certificate-bound access tokens (RFC 8705 §3)', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let signJwt: jest.Mock;
  let executeMappers: jest.Mock;
  let getScopeMappers: jest.Mock;
  let enrichToken: jest.Mock;
  let mfaService: Record<string, jest.Mock>;
  let smsOtp: { sendCode: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    signJwt = jest.fn().mockResolvedValue('signed.jwt.token');
    executeMappers = jest.fn().mockReturnValue({});
    getScopeMappers = jest.fn().mockResolvedValue([]);
    enrichToken = jest.fn(async (payload: Record<string, unknown>) => payload);
    mfaService = {
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      isMfaRequired: jest.fn().mockReturnValue(false),
      validateMfaChallengeWithAttemptCheck: jest.fn(),
      verifySecondFactor: jest.fn(),
      consumeMfaChallenge: jest.fn().mockResolvedValue(true),
    };
    const crypto = {
      verifyPassword: jest.fn().mockResolvedValue(true),
      generateSecret: jest.fn().mockReturnValue('raw-refresh-token'),
      sha256: jest.fn().mockReturnValue('refresh-token-hash'),
    };
    const scopesService = {
      parseAndValidate: jest.fn().mockReturnValue(['openid']),
      getClaimsForScopes: jest.fn().mockReturnValue(new Set(['sub'])),
      hasOpenidScope: jest.fn().mockReturnValue(false),
      toString: jest.fn((scopes: string[]) => scopes.join(' ')),
      getScopeMappers,
    };
    const lookups = lookupsBackedBy(prisma as any) as any;
    // Accepts exactly one certificate (X5T) for the self-signed client.
    const resolvers = new ClientCertificateResolverRegistry();
    resolvers.register({
      name: 'test',
      resolve: async ({ client, method, certificate }) =>
        certificate.x5tS256 === X5T
          ? { clientId: client.clientId, method, bindToCertificate: false }
          : { rejected: 'unknown certificate' },
    });
    smsOtp = {
      sendCode: jest.fn().mockResolvedValue({
        maskedPhone: '+1 ••• •• 42',
        expiresAt: new Date(Date.now() + 300_000),
        resendAvailableAt: new Date(Date.now() + 30_000),
      }),
    };

    prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
    prisma.userRole.findMany.mockResolvedValue([]);
    (prisma as any).userGroup.findMany.mockResolvedValue([]);
    prisma.session.create.mockResolvedValue({ id: 'session-1' });
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' });
    prisma.user.findUnique.mockResolvedValue(dbUser);

    service = new AuthService(
      lookups,
      prisma as any,
      crypto as any,
      { signJwt, computeAtHash: jest.fn() } as any,
      scopesService as any,
      {
        checkLocked: jest.fn().mockReturnValue({ locked: false }),
        resetFailures: jest.fn(),
      } as any,
      { isExpired: jest.fn().mockReturnValue(false) } as any,
      mfaService as any,
      { executeMappers } as any,
      { recordLoginEvent: jest.fn().mockResolvedValue(undefined) } as any,
      {
        authLoginTotal: { inc: jest.fn() },
        authTokenIssuedTotal: { inc: jest.fn() },
      } as any,
      { getOidcClaimsForUser: jest.fn().mockResolvedValue({}) } as any,
      { authenticateViaFederation: jest.fn() } as any,
      new ClientAuthenticator(
        lookups,
        {
          verify: (client: { clientSecret: string | null }, secret: string) =>
            crypto.verifyPassword(client.clientSecret, secret),
        } as any,
        resolvers,
        { enabled: true },
        { retryAfter: async () => null, recordFailure: async () => {} } as any,
      ),
      undefined,
      { enrichToken } as any,
      smsOtp as any,
    );
  });

  /** The payload of the access token, the first JWT signed. */
  const accessTokenPayload = () =>
    signJwt.mock.calls[0][0] as Record<string, unknown>;

  const useClient = (client: object) =>
    prisma.client.findUnique.mockResolvedValue(client as any);

  const secretOf = (client: { clientId: string; clientType: string }) =>
    client.clientType === 'PUBLIC'
      ? { client_id: client.clientId }
      : { client_id: client.clientId, client_secret: 'secret' };

  /** Prepares the mocks of each grant and returns its request body. */
  const grants: Record<
    string,
    (client: typeof boundClient) => Record<string, string>
  > = {
    password: (client) => ({
      grant_type: 'password',
      username: 'testuser',
      password: 'pw',
      ...secretOf(client),
    }),
    client_credentials: (client) => ({
      grant_type: 'client_credentials',
      ...secretOf(client),
    }),
    'client_credentials (service account)': (client) => {
      useClient({ ...client, serviceAccountUserId: dbUser.id });
      return { grant_type: 'client_credentials', ...secretOf(client) };
    },
    authorization_code: (client) => {
      prisma.authorizationCode.update.mockResolvedValue({
        id: 'code-1',
        code: 'the-code',
        clientId: client.id,
        userId: dbUser.id,
        redirectUri: 'https://app.example.com/callback',
        scope: 'openid',
        nonce: null,
        codeChallenge: null,
        codeChallengeMethod: null,
        amr: [],
        used: true,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      } as any);
      return {
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: 'https://app.example.com/callback',
        ...secretOf(client),
      };
    },
    refresh_token: (client) => {
      prisma.refreshToken.findUnique.mockResolvedValue(storedRefresh(client));
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      return {
        grant_type: 'refresh_token',
        refresh_token: 'raw-old',
        ...secretOf(client),
      };
    },
    device_code: (client) => {
      prisma.deviceCode.findUnique.mockResolvedValue({
        id: 'dc-1',
        deviceCode: 'dev-code',
        clientId: client.id,
        realmId: realm.id,
        scope: 'openid',
        userId: dbUser.id,
        approved: true,
        denied: false,
        interval: 5,
        lastPolledAt: null,
        expiresAt: new Date(Date.now() + 600_000),
      } as any);
      prisma.deviceCode.update.mockResolvedValue({} as any);
      prisma.deviceCode.delete.mockResolvedValue({} as any);
      return {
        grant_type: DEVICE_GRANT,
        device_code: 'dev-code',
        ...secretOf(client),
      };
    },
    mfa_otp: (client) => {
      mfaService.validateMfaChallengeWithAttemptCheck.mockResolvedValue({
        userId: dbUser.id,
        realmId: realm.id,
        clientId: client.clientId,
      });
      mfaService.verifySecondFactor.mockResolvedValue({
        verified: true,
        factor: 'otp',
      });
      return {
        grant_type: 'mfa_otp',
        mfa_token: 'mfa-token',
        otp: '123456',
        ...secretOf(client),
      };
    },
  };

  function storedRefresh(
    client: { clientId: string },
    cnfX5tS256: string | null = null,
  ) {
    return {
      id: 'rt-1',
      sessionId: 'session-1',
      tokenHash: 'refresh-token-hash',
      clientId: client.clientId,
      scope: 'openid',
      revoked: false,
      isOffline: false,
      cnfX5tS256,
      expiresAt: new Date(Date.now() + 3600_000),
      session: {
        id: 'session-1',
        user: dbUser,
        satisfiedAcr: null,
        amr: [],
        createdAt: new Date(),
      },
    } as any;
  }

  describe.each(Object.keys(grants))('the %s grant', (grant) => {
    it('binds the access token to the presented certificate', async () => {
      useClient(boundClient);
      const body = grants[grant](boundClient);

      await service.handleTokenRequest(realm, body, '127.0.0.1', 'ua', cert());

      expect(accessTokenPayload()['cnf']).toEqual(CNF);
    });

    it('is invalid_client for a bound client without a certificate', async () => {
      useClient(boundClient);
      const body = grants[grant](boundClient);

      await expectOAuthError(
        service.handleTokenRequest(realm, body, '127.0.0.1', 'ua', {}),
        'invalid_client',
      );
      expect(signJwt).not.toHaveBeenCalled();
    });

    it('leaves an unbound client’s token unbound, certificate or not', async () => {
      useClient(unboundClient);
      const body = grants[grant](unboundClient);

      await service.handleTokenRequest(realm, body, '127.0.0.1', 'ua', cert());

      expect(accessTokenPayload()).not.toHaveProperty('cnf');
    });
  });

  it('binds the token of a secret-authenticated client sent with HTTP Basic', async () => {
    useClient(boundClient);
    const basic = Buffer.from('bound-client:secret').toString('base64');

    await service.handleTokenRequest(
      realm,
      { grant_type: 'client_credentials' },
      undefined,
      undefined,
      { authorization: `Basic ${basic}`, ...cert() },
    );

    expect(accessTokenPayload()['cnf']).toEqual(CNF);
  });

  describe('mappers and plugins', () => {
    beforeEach(() => {
      useClient({ ...boundClient, serviceAccountUserId: dbUser.id });
      getScopeMappers.mockResolvedValue([{ id: 'mapper-1' }]);
    });

    const issue = () =>
      service.handleTokenRequest(
        realm,
        {
          grant_type: 'client_credentials',
          client_id: 'bound-client',
          client_secret: 'secret',
        },
        undefined,
        undefined,
        cert(),
      );

    it('cannot rebind the token through a mapper claim', async () => {
      executeMappers.mockReturnValue({ cnf: { 'x5t#S256': OTHER_X5T } });
      await issue();
      expect(accessTokenPayload()['cnf']).toEqual(CNF);
    });

    it('cannot rebind or remove the binding in a plugin', async () => {
      enrichToken.mockImplementation(async (payload) => ({
        ...payload,
        cnf: { 'x5t#S256': OTHER_X5T },
      }));
      await issue();
      expect(accessTokenPayload()['cnf']).toEqual(CNF);

      signJwt.mockClear();
      enrichToken.mockImplementation(async (payload) => {
        const { cnf: _cnf, ...rest } = payload as Record<string, unknown>;
        return rest;
      });
      await issue();
      expect(accessTokenPayload()['cnf']).toEqual(CNF);
    });

    it('cannot add the certificate resolver claims (nhi_cid, nhi_crt) through a mapper or plugin', async () => {
      executeMappers.mockReturnValue({ nhi_cid: 'forged' });
      enrichToken.mockImplementation(async (payload) => ({
        ...payload,
        nhi_crt: { iss: 'x', sn: '1' },
      }));
      await issue();
      expect(accessTokenPayload()).not.toHaveProperty('nhi_cid');
      expect(accessTokenPayload()).not.toHaveProperty('nhi_crt');
    });

    it('cannot bind an unbound client’s token through a mapper', async () => {
      useClient({ ...unboundClient, serviceAccountUserId: dbUser.id });
      executeMappers.mockReturnValue({ cnf: { 'x5t#S256': OTHER_X5T } });
      await service.handleTokenRequest(
        realm,
        {
          grant_type: 'client_credentials',
          client_id: 'plain-client',
          client_secret: 'secret',
        },
        undefined,
        undefined,
        cert(),
      );
      expect(accessTokenPayload()).not.toHaveProperty('cnf');
    });
  });

  describe('/mfa/sms for a certificate-authenticated client', () => {
    const tlsClient = {
      ...unboundClient,
      clientId: 'tls-client',
      clientSecret: null,
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    };
    const realmOn = { ...realm, mtlsClientAuthEnabled: true } as Realm;

    beforeEach(() => {
      useClient(tlsClient);
      mfaService.getMfaChallenge = jest.fn().mockResolvedValue({
        userId: dbUser.id,
        realmId: realm.id,
        clientId: 'tls-client',
      });
    });

    it('authenticates the client with its certificate and sends the code', async () => {
      const result = await service.sendMfaSms(
        realmOn,
        { client_id: 'tls-client', mfa_token: 'mfa-token' },
        '127.0.0.1',
        cert(),
      );
      expect(result.masked_phone).toBe('+1 ••• •• 42');
      expect(smsOtp.sendCode).toHaveBeenCalledWith(
        expect.objectContaining({ userId: dbUser.id, binding: 'mfa-token' }),
      );
    });

    it.each([
      ['no certificate', {}],
      ['an unknown certificate', cert(OTHER_X5T)],
    ])('is invalid_client with %s', async (_label, ctx) => {
      await expect(
        service.sendMfaSms(
          realmOn,
          { client_id: 'tls-client', mfa_token: 'mfa-token' },
          undefined,
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'invalid_client' });
      expect(smsOtp.sendCode).not.toHaveBeenCalled();
    });

    it('takes the client_id from HTTP Basic, as the token endpoint does', async () => {
      useClient({ ...unboundClient, clientId: 'tls-client' });
      const basic = Buffer.from('tls-client:secret').toString('base64');
      await service.sendMfaSms(realmOn, { mfa_token: 'mfa-token' }, undefined, {
        authorization: `Basic ${basic}`,
      });
      expect(smsOtp.sendCode).toHaveBeenCalled();
    });
  });

  describe('refresh (RFC 8705 §3.1, §4)', () => {
    const refresh = (client: typeof boundClient, x5t?: string) =>
      service.handleTokenRequest(
        realm,
        {
          grant_type: 'refresh_token',
          refresh_token: 'raw-old',
          ...secretOf(client),
        },
        undefined,
        undefined,
        x5t ? cert(x5t) : {},
      );

    it('rebinds a confidential client’s access token to the certificate presented now', async () => {
      useClient(boundClient);
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefresh(boundClient),
      );
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await refresh(boundClient, OTHER_X5T);

      expect(accessTokenPayload()['cnf']).toEqual({ 'x5t#S256': OTHER_X5T });
      // A confidential client's refresh token is not itself bound.
      expect(
        prisma.refreshToken.create.mock.calls[0][0].data,
      ).not.toHaveProperty('cnfX5tS256');
    });

    it('binds a public client’s refresh token at issuance', async () => {
      // The device grant: a public client's typical way in, without PKCE.
      useClient(publicBoundClient);
      const body = grants['device_code'](publicBoundClient);
      await service.handleTokenRequest(
        realm,
        body,
        undefined,
        undefined,
        cert(),
      );

      const session = prisma.session.create.mock.calls[0][0].data;
      expect(session.refreshTokens.create.cnfX5tS256).toBe(X5T);
    });

    it('refreshes a public client’s bound token with the same certificate', async () => {
      useClient(publicBoundClient);
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefresh(publicBoundClient, X5T),
      );
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await refresh(publicBoundClient, X5T);

      expect(accessTokenPayload()['cnf']).toEqual(CNF);
      expect(prisma.refreshToken.create.mock.calls[0][0].data.cnfX5tS256).toBe(
        X5T,
      );
    });

    it.each([
      ['another certificate', OTHER_X5T],
      ['no certificate', undefined],
    ])(
      'is invalid_grant for a public client’s bound token with %s, without spending it',
      async (_label, x5t) => {
        useClient(publicBoundClient);
        prisma.refreshToken.findUnique.mockResolvedValue(
          storedRefresh(publicBoundClient, X5T),
        );

        await expectOAuthError(
          refresh(publicBoundClient, x5t),
          x5t ? 'invalid_grant' : 'invalid_client',
        );
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(signJwt).not.toHaveBeenCalled();
      },
    );

    it('keeps a bound refresh token bound after the client flag is turned off', async () => {
      const turnedOff = {
        ...publicBoundClient,
        tlsClientCertificateBoundAccessTokens: false,
      };
      useClient(turnedOff);
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefresh(turnedOff, X5T),
      );

      await expectOAuthError(refresh(turnedOff), 'invalid_grant');
      await expectOAuthError(refresh(turnedOff, OTHER_X5T), 'invalid_grant');
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('certificateBindingFor', () => {
  const base = {
    client: { ...unboundClient } as any,
    x5tS256: null,
    certificate: null,
    bindToCertificate: false,
  };

  it('is null for a client without the flag', () => {
    expect(
      certificateBindingFor({ ...base, certificate: { x5tS256: X5T } as any }),
    ).toBeNull();
  });

  it('binds when a certificate resolver asks for it', () => {
    expect(
      certificateBindingFor({
        ...base,
        bindToCertificate: true,
        x5tS256: X5T,
      }),
    ).toEqual({ x5tS256: X5T, refreshToken: false });
  });

  it('binds a public client’s refresh token too', () => {
    expect(
      certificateBindingFor({
        ...base,
        client: publicBoundClient as any,
        certificate: { x5tS256: X5T } as any,
      }),
    ).toEqual({ x5tS256: X5T, refreshToken: true });
  });

  it("carries the resolver's binding claims", () => {
    expect(
      certificateBindingFor({
        ...base,
        bindToCertificate: true,
        x5tS256: X5T,
        bindingClaims: { nhi_cid: 'cred-1' },
      }),
    ).toEqual({
      x5tS256: X5T,
      refreshToken: false,
      claims: { nhi_cid: 'cred-1' },
    });
  });

  it('protects the binding claims from mappers and plugins', () => {
    expect(
      withProtectedClaims(
        { nhi_cid: 'forged', nhi_crt: 'forged', other: 1 },
        { nhi_cid: 'cred-1' },
      ),
    ).toEqual({ nhi_cid: 'cred-1', other: 1 });
  });

  it('refuses a bound client without a certificate', () => {
    expect(() =>
      certificateBindingFor({ ...base, client: boundClient as any }),
    ).toThrow(ClientAuthError);
  });
});
