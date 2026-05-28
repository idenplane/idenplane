jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { UnauthorizedException } from '@nestjs/common';
import { TokensController } from './tokens.controller.js';
import type { Realm } from '@prisma/client';

describe('TokensController', () => {
  let controller: TokensController;
  let mockTokensService: {
    introspect: jest.Mock;
    revoke: jest.Mock;
    logout: jest.Mock;
    logoutByIdToken: jest.Mock;
    validatePostLogoutRedirectUri: jest.Mock;
    invalidateLoginSession: jest.Mock;
    userinfo: jest.Mock;
    assertTokenBelongsToClient: jest.Mock;
  };
  let mockPrisma: {
    client: { findUnique: jest.Mock };
  };
  let mockCrypto: {
    verifyPassword: jest.Mock;
  };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  const publicClient = {
    id: 'c1',
    clientId: 'public-app',
    clientType: 'PUBLIC',
    clientSecret: null,
    enabled: true,
  };

  const confidentialClient = {
    id: 'c2',
    clientId: 'confidential-app',
    clientType: 'CONFIDENTIAL',
    clientSecret: 'hashed-secret',
    enabled: true,
  };

  beforeEach(() => {
    mockTokensService = {
      introspect: jest.fn(),
      revoke: jest.fn(),
      logout: jest.fn(),
      logoutByIdToken: jest.fn().mockResolvedValue(undefined),
      validatePostLogoutRedirectUri: jest.fn().mockResolvedValue(undefined),
      invalidateLoginSession: jest.fn().mockResolvedValue(undefined),
      userinfo: jest.fn(),
      assertTokenBelongsToClient: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue(publicClient),
      },
    };

    mockCrypto = {
      verifyPassword: jest.fn().mockResolvedValue(true),
    };

    controller = new TokensController(
      mockTokensService as any,
      mockPrisma as any,
      mockCrypto as any,
    );
  });

  const mockReq = (overrides: Record<string, unknown> = {}) =>
    ({
      ip: '127.0.0.1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      connection: { remoteAddress: '127.0.0.1' },
      ...overrides,
    }) as any;

  describe('introspect', () => {
    it('should authenticate client and call tokensService.introspect', async () => {
      const body = { token: 'some-token', client_id: 'public-app' };
      mockTokensService.introspect.mockResolvedValue({
        active: true,
        sub: 'user-1',
      });

      const result = await controller.introspect(realm, body, mockReq());

      expect(mockPrisma.client.findUnique).toHaveBeenCalled();
      expect(mockTokensService.introspect).toHaveBeenCalledWith(
        realm,
        'some-token',
      );
      expect(result).toEqual({ active: true, sub: 'user-1' });
    });

    it('should reject requests without client_id', async () => {
      await expect(
        controller.introspect(realm, { token: 'tok' }, mockReq()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should authenticate confidential client with secret', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(confidentialClient);
      mockTokensService.introspect.mockResolvedValue({
        active: true,
        azp: 'confidential-app',
      });
      const body = {
        token: 'tok',
        client_id: 'confidential-app',
        client_secret: 'raw-secret',
      };

      await controller.introspect(realm, body, mockReq());

      expect(mockCrypto.verifyPassword).toHaveBeenCalledWith(
        'hashed-secret',
        'raw-secret',
      );
      expect(mockTokensService.introspect).toHaveBeenCalled();
    });

    it('should support HTTP Basic authentication', async () => {
      mockTokensService.introspect.mockResolvedValue({
        active: true,
        azp: 'public-app',
      });
      const basicAuth = Buffer.from('public-app:').toString('base64');
      const req = mockReq({ headers: { authorization: `Basic ${basicAuth}` } });

      await controller.introspect(realm, { token: 'tok' }, req);

      expect(mockTokensService.introspect).toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('should authenticate client and call tokensService.revoke', async () => {
      const body = {
        token: 'some-token',
        token_type_hint: 'refresh_token' as const,
        client_id: 'public-app',
      };

      await controller.revoke(realm, body, mockReq());

      expect(mockTokensService.revoke).toHaveBeenCalledWith(
        realm,
        'some-token',
        'refresh_token',
      );
    });

    it('should reject revoke without client authentication', async () => {
      await expect(
        controller.revoke(realm, { token: 'some-token' }, mockReq()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should call tokensService.logout with realm, ip, and refresh_token', () => {
      const body = { refresh_token: 'rt-123' };
      const req = mockReq();

      controller.logout(realm, body, req);

      expect(mockTokensService.logout).toHaveBeenCalledWith(
        realm,
        '127.0.0.1',
        'rt-123',
      );
    });
  });

  describe('logoutGet (RP-initiated logout)', () => {
    const mockRes = () =>
      ({
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        clearCookie: jest.fn(),
      }) as any;

    it('invalidates the SSO session and clears IDENPLANE_SESSION with the matching path', async () => {
      const req = mockReq({ cookies: { IDENPLANE_SESSION: 'sso-token-abc' } });
      const res = mockRes();

      await controller.logoutGet(
        realm,
        'id-token-hint',
        undefined,
        undefined,
        req,
        res,
      );

      expect(mockTokensService.invalidateLoginSession).toHaveBeenCalledWith(
        'sso-token-abc',
      );
      // The cookie was set with path `/realms/<name>`; clearing with any other
      // path silently no-ops in the browser, so assert the path explicitly.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'IDENPLANE_SESSION',
        expect.objectContaining({ path: `/realms/${realm.name}` }),
      );
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('still clears the cookie when redirecting to a post_logout_redirect_uri', async () => {
      const req = mockReq({ cookies: { IDENPLANE_SESSION: 'sso-token-abc' } });
      const res = mockRes();

      await controller.logoutGet(
        realm,
        'id-token-hint',
        'https://app.example.com/after-logout',
        'xyz',
        req,
        res,
      );

      expect(
        mockTokensService.validatePostLogoutRedirectUri,
      ).toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith(
        'IDENPLANE_SESSION',
        expect.objectContaining({ path: `/realms/${realm.name}` }),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.example.com/after-logout?state=xyz',
      );
    });

    it('skips SSO invalidation when no session cookie is present', async () => {
      const req = mockReq();
      const res = mockRes();

      await controller.logoutGet(
        realm,
        'id-token-hint',
        undefined,
        undefined,
        req,
        res,
      );

      expect(mockTokensService.invalidateLoginSession).not.toHaveBeenCalled();
    });
  });

  describe('userinfo', () => {
    it('should extract Bearer token and call tokensService.userinfo', async () => {
      const req = mockReq({ headers: { authorization: 'Bearer abc-123' } });
      const expected = { sub: 'user-1', email: 'user@test.com' };
      mockTokensService.userinfo.mockResolvedValue(expected);

      const result = await controller.userinfo(realm, req);

      expect(mockTokensService.userinfo).toHaveBeenCalledWith(realm, 'abc-123');
      expect(result).toEqual(expected);
    });

    it('should throw UnauthorizedException when Authorization header is missing', () => {
      const req = mockReq();

      expect(() => controller.userinfo(realm, req)).toThrow(
        UnauthorizedException,
      );
      expect(mockTokensService.userinfo).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when Authorization header does not start with Bearer', () => {
      const req = mockReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });

      expect(() => controller.userinfo(realm, req)).toThrow(
        UnauthorizedException,
      );
      expect(mockTokensService.userinfo).not.toHaveBeenCalled();
    });
  });
});
