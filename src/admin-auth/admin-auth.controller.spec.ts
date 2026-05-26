import {
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller.js';
import { resetTrustedProxyConfig } from '../common/utils/proxy-ip.util.js';

/** Build a minimal Express-like mock for req / res used by the login handler. */
function makeReqRes(
  overrides: Partial<{ ip: string; forwardedFor: string }> = {},
) {
  const req: any = {
    headers: overrides.forwardedFor
      ? { 'x-forwarded-for': overrides.forwardedFor }
      : {},
    socket: { remoteAddress: overrides.ip ?? '127.0.0.1' },
  };
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    _headers: headers,
  };
  return { req, res };
}

describe('AdminAuthController', () => {
  let controller: AdminAuthController;
  let adminAuthService: {
    login: jest.Mock;
    revokeToken: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    // Ensure no leftover TRUSTED_PROXIES env from other tests
    delete process.env['TRUSTED_PROXIES'];
    resetTrustedProxyConfig();
    adminAuthService = {
      login: jest.fn(),
      revokeToken: jest.fn(),
    };
    configService = { get: jest.fn() };
    controller = new AdminAuthController(
      adminAuthService as any,
      configService as any,
    );
  });

  afterEach(() => {
    delete process.env['TRUSTED_PROXIES'];
    resetTrustedProxyConfig();
  });

  describe('login', () => {
    it('should call adminAuthService.login with username, password, and extracted IP', async () => {
      const serviceResponse = {
        access_token: 'jwt-token',
        token_type: 'Bearer',
        expires_in: 3600,
        rateLimitHeaders: {
          'X-RateLimit-Limit': '5',
          'X-RateLimit-Remaining': '4',
          'X-RateLimit-Reset': '1700000060',
        },
      };
      adminAuthService.login.mockResolvedValue(serviceResponse);
      const { req, res } = makeReqRes({ ip: '10.0.0.1' });

      const result = await controller.login(
        { username: 'admin', password: 'password' },
        req,
        res,
      );

      expect(adminAuthService.login).toHaveBeenCalledWith(
        'admin',
        'password',
        '10.0.0.1',
      );
      // rateLimitHeaders must be forwarded to the response but NOT returned in body
      expect(result).toEqual({
        access_token: 'jwt-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
      expect(res._headers['X-RateLimit-Limit']).toBe('5');
      expect(res._headers['X-RateLimit-Remaining']).toBe('4');
    });

    it('should ignore X-Forwarded-For and use socket address when TRUSTED_PROXIES is not set', async () => {
      // Default behaviour: no trusted proxies configured.
      // X-Forwarded-For must be ignored to prevent IP spoofing.
      adminAuthService.login.mockResolvedValue({
        access_token: 'tok',
        token_type: 'Bearer',
        expires_in: 3600,
        rateLimitHeaders: {},
      });
      const { req, res } = makeReqRes({
        ip: '10.0.0.1',
        forwardedFor: '203.0.113.5, 10.0.0.1',
      });

      await controller.login({ username: 'admin', password: 'pass' }, req, res);

      // Must use the socket address, not the spoofable header value
      expect(adminAuthService.login).toHaveBeenCalledWith(
        'admin',
        'pass',
        '10.0.0.1',
      );
    });

    it('should use X-Forwarded-For when the peer is a TRUSTED_PROXIES entry', async () => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.1';
      resetTrustedProxyConfig();

      adminAuthService.login.mockResolvedValue({
        access_token: 'tok',
        token_type: 'Bearer',
        expires_in: 3600,
        rateLimitHeaders: {},
      });
      const { req, res } = makeReqRes({
        ip: '10.0.0.1',
        forwardedFor: '203.0.113.5, 10.0.0.1',
      });

      await controller.login({ username: 'admin', password: 'pass' }, req, res);

      // Peer is trusted — use first value from X-Forwarded-For
      expect(adminAuthService.login).toHaveBeenCalledWith(
        'admin',
        'pass',
        '203.0.113.5',
      );
    });

    it('should propagate rate-limit errors from service', async () => {
      adminAuthService.login.mockRejectedValue(
        new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      );
      const { req, res } = makeReqRes();

      await expect(
        controller.login({ username: 'admin', password: 'pass' }, req, res),
      ).rejects.toThrow(HttpException);
    });

    it('should propagate UnauthorizedException from service', async () => {
      adminAuthService.login.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );
      const { req, res } = makeReqRes();

      await expect(
        controller.login({ username: 'admin', password: 'wrong' }, req, res),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getDemoInfo', () => {
    it('returns { demo: false } when DEMO_MODE is not enabled', () => {
      configService.get.mockReturnValue(undefined);
      expect(controller.getDemoInfo()).toEqual({ demo: false });
    });

    it('returns the demo credentials when DEMO_MODE=true', () => {
      configService.get.mockImplementation((key: string, def?: string) => {
        const values: Record<string, string> = {
          DEMO_MODE: 'true',
          ADMIN_USER: 'demo',
          ADMIN_PASSWORD: 'idenplane-demo',
        };
        return values[key] ?? def;
      });
      expect(controller.getDemoInfo()).toEqual({
        demo: true,
        username: 'demo',
        password: 'idenplane-demo',
      });
    });
  });

  describe('getMe', () => {
    it('should return admin user from request', async () => {
      const adminUser = { userId: 'user-1', roles: ['super-admin'] };
      const req = { adminUser } as any;

      const result = await controller.getMe(req);
      expect(result).toEqual(adminUser);
    });

    it('should throw UnauthorizedException if no admin user on request', () => {
      const req = {} as any;

      expect(() => controller.getMe(req)).toThrow(UnauthorizedException);
      expect(() => controller.getMe(req)).toThrow('Not authenticated');
    });
  });
});
