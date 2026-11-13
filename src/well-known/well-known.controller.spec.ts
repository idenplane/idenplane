jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { WellKnownController } from './well-known.controller.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

function createMockCacheService() {
  return {
    getCachedClientConfig: jest.fn().mockResolvedValue(null),
    cacheClientConfig: jest.fn().mockResolvedValue(undefined),
    invalidateClientCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmConfig: jest.fn().mockResolvedValue(null),
    cacheRealmConfig: jest.fn().mockResolvedValue(undefined),
    invalidateRealmCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmByName: jest.fn().mockResolvedValue(null),
    cacheRealmByName: jest.fn().mockResolvedValue(undefined),
    getCachedJWKS: jest.fn().mockResolvedValue(null),
    cacheJWKS: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WellKnownController', () => {
  let controller: WellKnownController;
  let prisma: MockPrismaService;
  let mockJwkService: { publicKeyToJwk: jest.Mock };
  let mockCacheService: ReturnType<typeof createMockCacheService>;

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  beforeEach(() => {
    prisma = createMockPrismaService();
    mockJwkService = {
      publicKeyToJwk: jest.fn(),
    };
    mockCacheService = createMockCacheService();

    controller = new WellKnownController(
      prisma as any,
      mockJwkService as any,
      mockCacheService as any,
    );
    process.env['BASE_URL'] = 'https://auth.example.com';
  });

  afterEach(() => {
    delete process.env['BASE_URL'];
  });

  describe('discovery', () => {
    it('should return an OIDC discovery document with correct issuer', () => {
      const result = controller.discovery(realm);

      expect(result.issuer).toBe('https://auth.example.com/realms/test-realm');
    });

    it('should return correct endpoint URLs based on realm name', () => {
      const result = controller.discovery(realm);
      const protocolUrl =
        'https://auth.example.com/realms/test-realm/protocol/openid-connect';

      expect(result.token_endpoint).toBe(`${protocolUrl}/token`);
      expect(result.authorization_endpoint).toBe(`${protocolUrl}/auth`);
      expect(result.userinfo_endpoint).toBe(`${protocolUrl}/userinfo`);
      expect(result.jwks_uri).toBe(`${protocolUrl}/certs`);
      expect(result.introspection_endpoint).toBe(
        `${protocolUrl}/token/introspect`,
      );
      expect(result.revocation_endpoint).toBe(`${protocolUrl}/revoke`);
      expect(result.end_session_endpoint).toBe(`${protocolUrl}/logout`);
    });

    it('should include expected supported values', () => {
      const result = controller.discovery(realm);

      expect(result.response_types_supported).toEqual(['code']);
      expect(result.grant_types_supported).toContain('authorization_code');
      expect(result.grant_types_supported).toContain('client_credentials');
      expect(result.id_token_signing_alg_values_supported).toEqual(['RS256']);
    });
  });

  describe('RFC 8705 metadata', () => {
    const mtlsRealm = { ...realm, mtlsClientAuthEnabled: true } as Realm;
    const make = (mtls: { enabled: boolean; baseUrl?: string } | undefined) =>
      new WellKnownController(
        prisma as any,
        mockJwkService as any,
        mockCacheService as any,
        mtls,
      );

    it('advertises the certificate methods and aliases when both switches are on', () => {
      const result = make({
        enabled: true,
        baseUrl: 'https://mtls.example.com',
      }).discovery(mtlsRealm) as Record<string, any>;
      expect(result.token_endpoint_auth_methods_supported).toEqual([
        'client_secret_post',
        'client_secret_basic',
        'none',
        'tls_client_auth',
        'self_signed_tls_client_auth',
      ]);
      expect(result.mtls_endpoint_aliases).toEqual({
        token_endpoint:
          'https://mtls.example.com/realms/test-realm/protocol/openid-connect/token',
        introspection_endpoint:
          'https://mtls.example.com/realms/test-realm/protocol/openid-connect/token/introspect',
        revocation_endpoint:
          'https://mtls.example.com/realms/test-realm/protocol/openid-connect/revoke',
        userinfo_endpoint:
          'https://mtls.example.com/realms/test-realm/protocol/openid-connect/userinfo',
        device_authorization_endpoint:
          'https://mtls.example.com/realms/test-realm/protocol/openid-connect/auth/device',
      });
      expect(result.tls_client_certificate_bound_access_tokens).toBe(true);
    });

    it('advertises the methods without aliases when MTLS_BASE_URL is unset', () => {
      const result = make({ enabled: true }).discovery(mtlsRealm) as Record<
        string,
        any
      >;
      expect(result.token_endpoint_auth_methods_supported).toContain(
        'tls_client_auth',
      );
      expect(result).not.toHaveProperty('mtls_endpoint_aliases');
    });

    it.each([
      [
        'MTLS_ENABLED off',
        { enabled: false, baseUrl: 'https://m.example' },
        true,
      ],
      [
        'the realm flag off',
        { enabled: true, baseUrl: 'https://m.example' },
        false,
      ],
      ['no mTLS config', undefined, true],
    ])('advertises nothing with %s', (_label, mtls, realmFlag) => {
      const result = make(mtls).discovery({
        ...realm,
        mtlsClientAuthEnabled: realmFlag,
      } as Realm) as Record<string, any>;
      expect(result.token_endpoint_auth_methods_supported).toEqual([
        'client_secret_post',
        'client_secret_basic',
        'none',
      ]);
      expect(result).not.toHaveProperty('mtls_endpoint_aliases');
      expect(result).not.toHaveProperty(
        'tls_client_certificate_bound_access_tokens',
      );
    });

    it('advertises bound tokens without aliases when MTLS_BASE_URL is unset', () => {
      const result = make({ enabled: true }).discovery(mtlsRealm) as Record<
        string,
        any
      >;
      expect(result.tls_client_certificate_bound_access_tokens).toBe(true);
    });
  });

  describe('certs', () => {
    it('should query active signing keys and return them as JWKS', async () => {
      const signingKeys = [
        { publicKey: 'pk-1', kid: 'kid-1', realmId: 'realm-1', active: true },
        { publicKey: 'pk-2', kid: 'kid-2', realmId: 'realm-1', active: true },
      ];
      prisma.realmSigningKey.findMany.mockResolvedValue(signingKeys);
      mockJwkService.publicKeyToJwk
        .mockResolvedValueOnce({ kty: 'RSA', kid: 'kid-1', n: 'n1', e: 'AQAB' })
        .mockResolvedValueOnce({
          kty: 'RSA',
          kid: 'kid-2',
          n: 'n2',
          e: 'AQAB',
        });

      const result = await controller.certs(realm);

      expect(prisma.realmSigningKey.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', active: true },
      });
      expect(mockJwkService.publicKeyToJwk).toHaveBeenCalledWith(
        'pk-1',
        'kid-1',
      );
      expect(mockJwkService.publicKeyToJwk).toHaveBeenCalledWith(
        'pk-2',
        'kid-2',
      );
      expect(result).toEqual({
        keys: [
          { kty: 'RSA', kid: 'kid-1', n: 'n1', e: 'AQAB' },
          { kty: 'RSA', kid: 'kid-2', n: 'n2', e: 'AQAB' },
        ],
      });
    });

    it('should return an empty keys array when no signing keys exist', async () => {
      prisma.realmSigningKey.findMany.mockResolvedValue([]);

      const result = await controller.certs(realm);

      expect(result).toEqual({ keys: [] });
    });
  });
});
