import type { Request, Response } from 'express';
import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from '../../admin-auth/admin-auth.service.js';
import { RateLimitService } from '../../rate-limit/rate-limit.service.js';
import { resolveClientIp } from '../../common/utils/proxy-ip.util.js';
import { createHash, timingSafeEqual } from 'crypto';

type AuthRequest = Request & {
  adminUser?: { userId: string; roles: string[] };
  res?: Response;
};

@Injectable()
export class GraphQLAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly adminAuthService: AdminAuthService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = this.getRequest(context);
    if (!request) {
      return true;
    }

    // Check Bearer token
    const authHeader = request.headers?.['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const adminUser = await this.adminAuthService.validateAdminToken(token);
        request.adminUser = adminUser;
        return true;
      } catch {
        // Fall through to API key check
      }
    }

    // Check API key
    const expectedKey = this.configService.get<string>('ADMIN_API_KEY');
    const providedApiKey = request.headers?.['x-admin-api-key'];
    if (expectedKey && typeof providedApiKey === 'string') {
      const ip = resolveClientIp(request);
      const rateLimitResult =
        await this.rateLimitService.checkAdminApiKeyLimit(ip);
      const headers = this.rateLimitService.computeHeaders(rateLimitResult);
      for (const [name, value] of Object.entries(headers)) {
        request.res?.setHeader(name, value);
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
        request.adminUser = {
          userId: `api-key:${keyFingerprint}`,
          roles: ['super-admin'],
        };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid or missing admin credentials');
  }

  private getRequest(context: ExecutionContext): AuthRequest | null {
    try {
      return context.switchToHttp().getRequest<AuthRequest>();
    } catch {
      // Try GraphQL context
      try {
        const args = context.getArgs();
        const req = (args[0] as { req?: AuthRequest })?.req;
        return req ?? null;
      } catch {
        return null;
      }
    }
  }

  handleRequest(
    err: unknown,
    user: { userId: string; roles: string[] } | null,
  ): { userId: string; roles: string[] } {
    if (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(
              // eslint-disable-next-line @typescript-eslint/no-base-to-string
              String(err),
            );
      throw error;
    }
    if (!user) {
      throw new UnauthorizedException('Invalid or missing admin credentials');
    }

    return user;
  }
}
