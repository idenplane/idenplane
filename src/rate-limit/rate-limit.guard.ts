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
 * Decorators to configure one or more rate limit types on a controller/handler.
 * Stored value is normalized to an array — endpoints can stack limiters
 * (e.g. `/token` runs per-IP AND per-client checks).
 *
 * @example @RateLimitByClient()
 * @example @RateLimitByUser()
 * @example @RateLimitByIp()
 * @example @RateLimitBy('ip', 'client')
 */
export const RateLimitByClient = () =>
  SetMetadata(RATE_LIMIT_TYPE_KEY, ['client']);
export const RateLimitByUser = () => SetMetadata(RATE_LIMIT_TYPE_KEY, ['user']);
export const RateLimitByIp = () => SetMetadata(RATE_LIMIT_TYPE_KEY, ['ip']);
export const RateLimitBy = (...types: RateLimitType[]) =>
  SetMetadata(RATE_LIMIT_TYPE_KEY, types);

/** Normalize legacy single-string metadata to the array shape. */
function normalizeTypes(raw: unknown): RateLimitType[] {
  if (Array.isArray(raw)) return raw as RateLimitType[];
  if (typeof raw === 'string') return [raw as RateLimitType];
  return [];
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly metricsService: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<unknown>(RATE_LIMIT_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const types = normalizeTypes(raw);

    if (types.length === 0) {
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
      return true;
    }

    // Run every configured check, but only surface headers for the BINDING
    // one (the smallest `remaining`). Standard practice for stacked limiters
    // — surfacing the IP-headers when the per-client bucket is two requests
    // from exhaustion would mislead callers into thinking they have more
    // headroom than they do.
    let binding: { type: RateLimitType; result: Awaited<ReturnType<typeof this.runCheck>> } | undefined;
    for (const type of types) {
      const result = await this.runCheck(type, request, effectiveRealmId);
      if (!result) continue;

      if (!result.allowed) {
        const headers = this.rateLimitService.computeHeaders(result);
        for (const [name, value] of Object.entries(headers)) {
          response.setHeader(name, value);
        }

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

      if (!binding || result.remaining < binding.result!.remaining) {
        binding = { type, result };
      }
    }

    if (binding?.result) {
      const headers = this.rateLimitService.computeHeaders(binding.result);
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
      }
    }

    return true;
  }

  private async runCheck(
    type: RateLimitType,
    request: Request,
    realmId: string,
  ) {
    switch (type) {
      case 'client': {
        const clientId = this.extractClientId(request);
        if (!clientId) return undefined;
        return this.rateLimitService.checkClientLimit(clientId, realmId);
      }
      case 'user': {
        const userId = this.extractUserId(request);
        if (!userId) return undefined;
        return this.rateLimitService.checkUserLimit(userId, realmId);
      }
      case 'ip': {
        const ip = this.extractIp(request);
        return this.rateLimitService.checkIpLimit(ip, realmId);
      }
      default:
        return undefined;
    }
  }

  /**
   * Resolve the calling client_id from `/token`-style requests.
   *
   * RFC 6749 §2.3.1 confidential clients authenticate via Basic — the form
   * body has no `client_id` in that case, so without decoding the header the
   * per-client limiter would skip exactly the machine clients it most needs to
   * cap.
   */
  private extractClientId(request: Request): string | undefined {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const fromBody = body['client_id'] as string | undefined;
    if (fromBody) return fromBody;
    const fromQuery = query['client_id'] as string | undefined;
    if (fromQuery) return fromQuery;

    const auth = request.headers?.['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString();
        const colonIdx = decoded.indexOf(':');
        if (colonIdx > 0) {
          return decodeURIComponent(decoded.slice(0, colonIdx));
        }
      } catch {
        // malformed — fall through
      }
    }
    return undefined;
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
