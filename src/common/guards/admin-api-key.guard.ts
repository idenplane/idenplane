import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { REQUIRE_ADMIN_AUTH_KEY } from '../decorators/require-admin-auth.decorator.js';
import { AdminAuthService } from '../../admin-auth/admin-auth.service.js';
import { RateLimitService } from '../../rate-limit/rate-limit.service.js';
import type { RateLimitResult } from '../../rate-limit/rate-limit.dto.js';
import { resolveClientIp } from '../utils/proxy-ip.util.js';
import { CertificateBindingError } from '../../mtls/certificate-binding.js';

/** Reads metadata from a handler or class; nothing for anything else. */
function metadataOf(key: string, target: unknown): unknown {
  return typeof target === 'function' || (typeof target === 'object' && target)
    ? Reflect.getMetadata(key, target)
    : undefined;
}

/** `admin` or `admin/...`, ignoring leading slashes and case. */
function isAdminPath(path: string): boolean {
  let start = 0;
  while (path[start] === '/') start += 1;
  const normalized = path.slice(start).toLowerCase();
  return normalized === 'admin' || normalized.startsWith('admin/');
}

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  /**
   * Whether this request needs admin credentials. Fails closed: any one of
   * these is enough.
   *
   * 1. The request path, in lower case, is `/admin` or under `/admin/`.
   *    Express matches routes case-insensitively, so `/ADMIN/realms`
   *    reaches the `/admin/realms` handler with `request.path` unchanged.
   * 2. The matched controller is declared under `admin` — whatever form the
   *    URL took, the handler that runs is an admin handler.
   * 3. The handler or controller has `@RequireAdminAuth()`.
   * 4. The handler or controller names this guard in `@UseGuards(...)`: an
   *    explicit `@UseGuards(AdminApiKeyGuard)` always means admin auth,
   *    whatever the path (it used to do nothing off `/admin`).
   *
   * `@Public()` is checked before this and still wins.
   */
  private mustEnforce(context: ExecutionContext, request: Request): boolean {
    const handler: unknown = context.getHandler();
    const controller: unknown = context.getClass();

    // 1. The URL.
    if (isAdminPath(request.path ?? '')) return true;

    // 2. The controller's declared path (a string or an array of them).
    const declared = metadataOf(PATH_METADATA, controller);
    const paths = Array.isArray(declared) ? declared : [declared];
    if (paths.some((p) => typeof p === 'string' && isAdminPath(p))) {
      return true;
    }

    // 3. @RequireAdminAuth().
    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_ADMIN_AUTH_KEY, [
        handler as never,
        controller as never,
      ]) === true
    ) {
      return true;
    }

    // 4. An explicit @UseGuards(AdminApiKeyGuard), as the class or an instance.
    for (const target of [handler, controller]) {
      const guards = metadataOf(GUARDS_METADATA, target);
      if (
        Array.isArray(guards) &&
        guards.some(
          (g: unknown) =>
            g === AdminApiKeyGuard ||
            g instanceof AdminApiKeyGuard ||
            (typeof g === 'function' &&
              g.prototype instanceof AdminApiKeyGuard),
        )
      ) {
        return true;
      }
    }

    return false;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly adminAuthService: AdminAuthService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    if (!this.mustEnforce(context, request)) {
      return true;
    }

    type AdminRequest = Request & {
      adminUser?: { userId: string; roles: string[] };
    };
    const adminReq = request as AdminRequest;

    // Try Bearer token (admin JWT) first
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const adminUser = await this.adminAuthService.validateAdminToken(
          token,
          request,
        );
        adminReq.adminUser = adminUser;
        return true;
      } catch (err) {
        // A certificate-bound token without its certificate is refused
        // outright with its RFC 6750 challenge (RFC 8705 §3).
        if (err instanceof CertificateBindingError) throw err;
        // Fall through to API key check
      }
    }

    // Fallback: static API key
    const expectedKey = this.configService.get<string>('ADMIN_API_KEY');
    const providedApiKey = request.headers['x-admin-api-key'];
    if (expectedKey && typeof providedApiKey === 'string') {
      const ip = resolveClientIp(request);
      // This guard can run twice for a single request — it is registered both
      // globally (APP_GUARD) and in per-controller @UseGuards. Compute the
      // admin-key rate limit once per request and reuse it; otherwise one call
      // increments the counter twice and halves the effective limit.
      const rlReq = request as AdminRequest & {
        __adminApiKeyRateLimit?: RateLimitResult;
      };
      let rateLimitResult = rlReq.__adminApiKeyRateLimit;
      if (!rateLimitResult) {
        rateLimitResult = await this.rateLimitService.checkAdminApiKeyLimit(ip);
        rlReq.__adminApiKeyRateLimit = rateLimitResult;
      }
      const headers = this.rateLimitService.computeHeaders(rateLimitResult);
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
      }
      if (!rateLimitResult.allowed) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Admin API key rate limit exceeded. Please slow down.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (
        providedApiKey.length === expectedKey.length &&
        timingSafeEqual(Buffer.from(providedApiKey), Buffer.from(expectedKey))
      ) {
        // There is a single configured ADMIN_API_KEY, so a key-derived
        // fingerprint would always be the same constant — and hashing the key
        // (request- or config-sourced) trips CodeQL js/insufficient-password-hash.
        // Use a stable static identifier; the `api-key:` prefix is what
        // downstream consumers branch on (impersonation/mfa/brute-force).
        adminReq.adminUser = {
          userId: 'api-key:admin',
          roles: ['super-admin'],
        };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid or missing admin credentials');
  }
}
