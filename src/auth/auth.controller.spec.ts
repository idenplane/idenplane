jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { AuthController } from './auth.controller.js';
import type { Realm } from '@prisma/client';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: { handleTokenRequest: jest.Mock };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  const req = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
    socket: { remoteAddress: '127.0.0.1' },
    connection: { remoteAddress: '127.0.0.1' },
  };

  const res = {
    set: jest.fn(),
  };

  beforeEach(() => {
    mockAuthService = {
      handleTokenRequest: jest.fn(),
    };

    controller = new AuthController(mockAuthService as any);
  });

  describe('token', () => {
    it('should call authService.handleTokenRequest with correct arguments', () => {
      const body = {
        grant_type: 'password',
        username: 'user',
        password: 'pass',
      };

      controller.token(realm, body, req as any, res as any);

      expect(mockAuthService.handleTokenRequest).toHaveBeenCalledWith(
        realm,
        body,
        '127.0.0.1',
        'test-agent',
      );
    });

    it('should return the result from authService.handleTokenRequest', async () => {
      const expected = { access_token: 'tok', token_type: 'Bearer' };
      mockAuthService.handleTokenRequest.mockResolvedValue(expected);

      const result = await controller.token(realm, {}, req as any, res as any);

      expect(result).toEqual(expected);
    });

    it('should pass the exact body object without modification', () => {
      const body = {
        grant_type: 'client_credentials',
        client_id: 'my-client',
        client_secret: 's3cret',
      };

      controller.token(realm, body, req as any, res as any);

      expect(mockAuthService.handleTokenRequest).toHaveBeenCalledTimes(1);
      const [passedRealm, passedBody] =
        mockAuthService.handleTokenRequest.mock.calls[0];
      expect(passedRealm).toBe(realm);
      expect(passedBody).toBe(body);
    });
  });
});
