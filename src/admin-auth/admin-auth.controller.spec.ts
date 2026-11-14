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
    cookies: {},
  };
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const res: any = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    cookie: (name: string, value: string) => {
      cookies[name] = value;
    },
    clearCookie: (name: string) => {
      delete cookies[name];
    },
    _headers: headers,
    _cookies: cookies,
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
  let principals: { realmNames: jest.Mock };

  beforeEach(() => {
    // Ensure no leftover TRUSTED_PROXIES env from other tests
    delete process.env['TRUSTED_PROXIES'];
    resetTrustedProxyConfig();
    adminAuthService = {
      login: jest.fn(),
      revokeToken: jest.fn(),
    };
    configService = { get: jest.fn() };
    principals = { realmNames: jest.fn().mockResolvedValue([]) };
    controller = new AdminAuthController(
      adminAuthService as any,
      configService as any,
      principals as any,
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

  describe('getDemoInfo without ADMIN_PASSWORD', () => {
    it('never falls back to a default password', () => {
      configService.get.mockImplementation((key: string, def?: string) =>
        key === 'DEMO_MODE' ? 'true' : def,
      );
      const info = controller.getDemoInfo();
      expect(info).toEqual({ demo: true, username: 'admin' });
      expect(info).not.toHaveProperty('password');
    });
  });

  describe('getMe', () => {
    const principal = (roles: string[], realmIds: string[] = []) => ({
      kind: 'user',
      userId: 'user-1',
      username: 'sample-admin',
      roles,
      realmIds: new Set(realmIds),
    });

    it('describes a super-admin from the resolved principal', async () => {
      const req = { adminPrincipal: principal(['super-admin']) } as any;
      expect(await controller.getMe(req)).toEqual({
        userId: 'user-1',
        username: 'sample-admin',
        kind: 'user',
        roles: ['super-admin'],
        superAdmin: true,
        readAllRealms: true,
        writeAllRealms: true,
        managedRealms: [],
      });
    });

    it('lists the realms a realm-admin manages', async () => {
      principals.realmNames.mockResolvedValue(['realm-a']);
      const req = {
        adminPrincipal: principal(['realm-admin'], ['id-a']),
      } as any;
      const me = await controller.getMe(req);
      expect(me).toMatchObject({
        superAdmin: false,
        readAllRealms: false,
        writeAllRealms: false,
        managedRealms: ['realm-a'],
      });
      expect(principals.realmNames).toHaveBeenCalledWith(new Set(['id-a']));
    });

    it('reads all realms as view-only and changes none', async () => {
      const req = { adminPrincipal: principal(['view-only']) } as any;
      expect(await controller.getMe(req)).toMatchObject({
        readAllRealms: true,
        writeAllRealms: false,
        managedRealms: [],
      });
    });

    it('should throw UnauthorizedException without a resolved admin', async () => {
      const req = { adminUser: { userId: 'user-1', roles: [] } } as any;
      await expect(controller.getMe(req)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getMe(req)).rejects.toThrow('Not authenticated');
    });
  });
});
