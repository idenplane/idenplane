import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual, createHash } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AdminAuthService } from '../../admin-auth/admin-auth.service.js';
import { RateLimitService } from '../../rate-limit/rate-limit.service.js';
import { resolveClientIp } from '../utils/proxy-ip.util.js';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
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

    // Only enforce auth on admin routes: /admin exactly, or /admin/...
    const isAdminRoute =
      request.path === '/admin' || request.path.startsWith('/admin/');
    if (!isAdminRoute) {
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
        const adminUser = await this.adminAuthService.validateAdminToken(token);
        adminReq.adminUser = adminUser;
        return true;
      } catch {
        // Fall through to API key check
      }
    }

    // Fallback: static API key
    const expectedKey = this.configService.get<string>('ADMIN_API_KEY');
    const providedApiKey = request.headers['x-admin-api-key'];
    if (expectedKey && typeof providedApiKey === 'string') {
      const ip = resolveClientIp(request);
      const rateLimitResult =
        await this.rateLimitService.checkAdminApiKeyLimit(ip);
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
        const keyFingerprint = createHash('sha256')
          .update(providedApiKey)
          .digest('hex')
          .slice(0, 12);
        adminReq.adminUser = {
          userId: `api-key:${keyFingerprint}`,
          roles: ['super-admin'],
        };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid or missing admin credentials');
  }
}
