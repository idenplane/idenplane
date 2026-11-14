import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AdminApiKeyGuard } from './admin-api-key.guard.js';
import { CertificateBindingError } from '../../mtls/certificate-binding.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { REQUIRE_ADMIN_AUTH_KEY } from '../decorators/require-admin-auth.decorator.js';

function createMockExecutionContext(
  headers: Record<string, string> = {},
  path = '/admin/realms',
) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ headers, path }),
      getResponse: jest.fn().mockReturnValue({ setHeader: jest.fn() }),
    }),
  } as any;
}

function createMockAdminAuthService() {
  return {
    validateAdminToken: jest.fn(),
  };
}

function createMockRateLimitService() {
  return {
    checkAdminApiKeyLimit: jest.fn().mockResolvedValue({
      allowed: true,
      limit: 15,
      remaining: 14,
      resetAt: 0,
    }),
    computeHeaders: jest.fn().mockReturnValue({}),
  };
}

describe('AdminApiKeyGuard', () => {
  let guard: AdminApiKeyGuard;
  let configService: { get: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let adminAuthService: ReturnType<typeof createMockAdminAuthService>;
  let rateLimitService: ReturnType<typeof createMockRateLimitService>;

  beforeEach(() => {
    configService = { get: jest.fn() };
    reflector = { getAllAndOverride: jest.fn() };
    adminAuthService = createMockAdminAuthService();
    rateLimitService = createMockRateLimitService();
    guard = new AdminApiKeyGuard(
      configService as unknown as ConfigService,
      reflector as unknown as Reflector,
      adminAuthService as any,
      rateLimitService as any,
    );
  });

  it('should allow requests to public (non-admin) routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockExecutionContext();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should allow non-admin paths without any auth', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = createMockExecutionContext(
      {},
      '/realms/test/protocol/openid-connect/token',
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should block admin routes when no credentials are provided', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue('super-secret-key');
    const ctx = createMockExecutionContext({});

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should block admin routes when the wrong API key is provided', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue('super-secret-key');
    const ctx = createMockExecutionContext({
      'x-admin-api-key': 'wrong-key',
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should allow admin routes when the correct API key is provided', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue('super-secret-key');
    const ctx = createMockExecutionContext({
      'x-admin-api-key': 'super-secret-key',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('counts the admin-key rate limit only once when run twice for one request (finding #3)', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue('super-secret-key');
    const ctx = createMockExecutionContext({
      'x-admin-api-key': 'super-secret-key',
    });

    // The guard is registered both globally (APP_GUARD) and per-controller, so
    // it runs twice for a single request — but must consume only one slot.
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(rateLimitService.checkAdminApiKeyLimit).toHaveBeenCalledTimes(1);
  });

  it('should allow admin routes when a valid Bearer token is provided', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    adminAuthService.validateAdminToken.mockResolvedValue({
      userId: 'admin-1',
      roles: ['super-admin'],
    });
    const ctx = createMockExecutionContext({
      authorization: 'Bearer valid-jwt-token',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(adminAuthService.validateAdminToken).toHaveBeenCalledWith(
      'valid-jwt-token',
      expect.anything(),
    );
  });

  it('refuses a certificate-bound token without its certificate, even with an API key (RFC 8705 §3)', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    adminAuthService.validateAdminToken.mockRejectedValue(
      new CertificateBindingError('missing'),
    );
    configService.get.mockReturnValue('my-key');
    const ctx = createMockExecutionContext({
      authorization: 'Bearer bound-token',
      'x-admin-api-key': 'my-key',
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      CertificateBindingError,
    );
  });

  it('should fall back to API key when Bearer token is invalid', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    adminAuthService.validateAdminToken.mockRejectedValue(
      new Error('Invalid token'),
    );
    configService.get.mockReturnValue('my-key');
    const ctx = createMockExecutionContext({
      authorization: 'Bearer bad-token',
      'x-admin-api-key': 'my-key',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should throw UnauthorizedException with a descriptive message', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    configService.get.mockReturnValue('correct-key');
    const ctx = createMockExecutionContext({
      'x-admin-api-key': 'bad-key',
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Invalid or missing admin credentials',
    );
  });
  describe('@RequireAdminAuth() outside /admin', () => {
    function metadata(values: Record<string, boolean>) {
      reflector.getAllAndOverride.mockImplementation(
        (key: string) => values[key] ?? undefined,
      );
    }

    it('rejects a non-admin path without credentials', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      configService.get.mockReturnValue('super-secret-key');
      const ctx = createMockExecutionContext({}, '/setup-wizard/state');

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a non-admin path with the wrong API key', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      configService.get.mockReturnValue('super-secret-key');
      const ctx = createMockExecutionContext(
        { 'x-admin-api-key': 'nope' },
        '/setup-wizard/complete',
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts the API key and sets a super-admin principal', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      configService.get.mockReturnValue('super-secret-key');
      const ctx = createMockExecutionContext(
        { 'x-admin-api-key': 'super-secret-key' },
        '/setup-wizard/state',
      );

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      const req = ctx.switchToHttp().getRequest();
      expect(req.adminUser).toEqual({
        userId: 'api-key:admin',
        roles: ['super-admin'],
      });
    });

    it('accepts a valid admin JWT', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      adminAuthService.validateAdminToken.mockResolvedValue({
        userId: 'u1',
        roles: ['view-only'],
      });
      const ctx = createMockExecutionContext(
        { authorization: 'Bearer good' },
        '/setup-wizard/state',
      );

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('is enforced whatever the path casing', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      configService.get.mockReturnValue('super-secret-key');
      const ctx = createMockExecutionContext({}, '/SETUP-WIZARD/state');

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when ADMIN_API_KEY is not configured', async () => {
      metadata({ [REQUIRE_ADMIN_AUTH_KEY]: true });
      configService.get.mockReturnValue(undefined);
      const ctx = createMockExecutionContext(
        { 'x-admin-api-key': 'anything' },
        '/setup-wizard/state',
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('leaves non-admin paths without the metadata open', async () => {
      metadata({ [IS_PUBLIC_KEY]: false });
      const ctx = createMockExecutionContext({}, '/realms/x/account');

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
