import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';

export const RATE_LIMIT_TYPE_KEY = 'rateLimitType';
export const RATE_LIMIT_REALM_KEY = 'rateLimitRealm';

export type RateLimitType = 'client' | 'user' | 'ip';

/**
 * Decorator to configure rate limit type on a controller or handler.
 *
 * @example @RateLimitByClient()
 * @example @RateLimitByUser()
 * @example @RateLimitByIp()
 */
export const RateLimitByClient = () =>
  SetMetadata(RATE_LIMIT_TYPE_KEY, 'client');
export const RateLimitByUser = () => SetMetadata(RATE_LIMIT_TYPE_KEY, 'user');
export const RateLimitByIp = () => SetMetadata(RATE_LIMIT_TYPE_KEY, 'ip');

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly metricsService: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = this.reflector.getAllAndOverride<RateLimitType>(
      RATE_LIMIT_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!type) {
      // No rate limit type configured — skip
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract realm ID from the request.  RealmGuard populates request.realm
    // for realm-scoped controllers; admin controllers may use request.params.
    const realmObj = (request as unknown as Record<string, unknown>)[
      'realm'
    ] as { id: string } | undefined;
    const effectiveRealmId: string | undefined =
      realmObj?.id ?? (request.params as Record<string, string>)['realmId'];

    if (!effectiveRealmId) {
      // Cannot determine realm — skip per-realm rate limiting.
      return true;
    }

    let result;

    switch (type) {
      case 'client': {
        const clientId = this.extractClientId(request);
        if (!clientId) return true;
        result = await this.rateLimitService.checkClientLimit(
          clientId,
          effectiveRealmId,
        );
        break;
      }
      case 'user': {
        const userId = this.extractUserId(request);
        if (!userId) return true;
        result = await this.rateLimitService.checkUserLimit(
          userId,
          effectiveRealmId,
        );
        break;
      }
      case 'ip': {
        const ip = this.extractIp(request);
        result = await this.rateLimitService.checkIpLimit(ip, effectiveRealmId);
        break;
      }
      default:
        return true;
    }

    // Attach rate-limit headers to the response
    const headers = this.rateLimitService.computeHeaders(result);
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }

    if (!result.allowed) {
      this.metricsService.rateLimitHitsTotal.inc({
        type,
        realm: effectiveRealmId,
      });

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private extractClientId(request: Request): string | undefined {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    return (
      (body['client_id'] as string | undefined) ??
      (query['client_id'] as string | undefined)
    );
  }

  private extractUserId(request: Request): string | undefined {
    type AuthenticatedRequest = Request & {
      user?: { sub?: string };
      adminUser?: { userId?: string };
    };
    const req = request as AuthenticatedRequest;
    return req.user?.sub ?? req.adminUser?.userId;
  }

  private extractIp(request: Request): string {
    return resolveClientIp(request);
  }
}
