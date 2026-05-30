import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { RATE_LIMIT_TYPE_KEY, type RateLimitType } from './rate-limit.guard.js';

/**
 * Interceptor that adds rate-limit response headers (X-RateLimit-*) for
 * endpoints decorated with a rate limit type. The guard handles enforcement
 * (429); this interceptor handles informational headers on allowed requests.
 *
 * Note: The guard already sets headers before the handler runs, but this
 * interceptor also ensures headers are present on responses that bypass the
 * guard (e.g. when rate limiting is disabled for the realm).
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly metricsService: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const raw = this.reflector.getAllAndOverride<unknown>(RATE_LIMIT_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const types: RateLimitType[] = Array.isArray(raw)
      ? (raw as RateLimitType[])
      : typeof raw === 'string'
        ? [raw as RateLimitType]
        : [];

    if (types.length > 0) {
      const request = context.switchToHttp().getRequest<Request>();
      const realmId: string | undefined =
        (request as Request & { realm?: { id: string } })['realm']?.id ??
        (request.params as Record<string, string>)['realmId'];

      if (realmId) {
        for (const type of types) {
          this.metricsService.rateLimitChecksTotal.inc({
            type,
            realm: realmId,
          });
        }
      }
    }

    return next.handle();
  }
}
