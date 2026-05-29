jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { OAuthTokenError } from './oauth-token-error.js';
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

  let res: {
    set: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
  };

  beforeEach(() => {
    mockAuthService = {
      handleTokenRequest: jest.fn(),
    };

    res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
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

  describe('token - RFC 6749 §5.2 error serialization', () => {
    it('serializes unsupported_grant_type as 400 { error } with no description', async () => {
      mockAuthService.handleTokenRequest.mockRejectedValue(
        new OAuthTokenError('unsupported_grant_type', undefined, 400),
      );

      await controller.token(
        realm,
        { grant_type: 'banana' },
        req as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'unsupported_grant_type' });
    });

    it('serializes invalid_grant as 400 { error, error_description }', async () => {
      mockAuthService.handleTokenRequest.mockRejectedValue(
        new OAuthTokenError(
          'invalid_grant',
          'Invalid or expired refresh token',
          400,
        ),
      );

      await controller.token(
        realm,
        { grant_type: 'refresh_token', refresh_token: 'bad' },
        req as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Invalid or expired refresh token',
      });
    });

    it('serializes invalid_client as 401 with a WWW-Authenticate header', async () => {
      mockAuthService.handleTokenRequest.mockRejectedValue(
        new OAuthTokenError('invalid_client', 'Invalid client credentials', 401),
      );

      await controller.token(
        realm,
        { grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' },
        req as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
      expect(res.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Basic realm="test-realm", error="invalid_client"',
      );
    });

    it('passes through an mfa_required HttpException body with its status', async () => {
      mockAuthService.handleTokenRequest.mockRejectedValue(
        new HttpException(
          {
            error: 'mfa_required',
            error_description: 'MFA verification is required',
            mfa_token: 'mfa-tok-123',
          },
          HttpStatus.UNAUTHORIZED,
        ),
      );

      await controller.token(
        realm,
        { grant_type: 'password', username: 'u', password: 'p' },
        req as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'mfa_required',
        error_description: 'MFA verification is required',
        mfa_token: 'mfa-tok-123',
      });
      // mfa_required is not invalid_client — no WWW-Authenticate header.
      expect(res.set).not.toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.anything(),
      );
    });

    it('re-throws unexpected errors for the global filter to handle', async () => {
      const unexpected = new Error('database is on fire');
      mockAuthService.handleTokenRequest.mockRejectedValue(unexpected);

      await expect(
        controller.token(
          realm,
          { grant_type: 'password' },
          req as any,
          res as any,
        ),
      ).rejects.toThrow(unexpected);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('sets the no-store / no-cache headers on every token response', async () => {
      mockAuthService.handleTokenRequest.mockResolvedValue({
        access_token: 'tok',
      });

      await controller.token(
        realm,
        { grant_type: 'client_credentials' },
        req as any,
        res as any,
      );

      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
    });
  });
});
