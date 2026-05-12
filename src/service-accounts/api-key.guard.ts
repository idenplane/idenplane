import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { ServiceAccountsService } from './service-accounts.service.js';

/**
 * Guard that validates API keys passed via the `X-Api-Key` header.
 * The header value must be the full plain key returned at creation time.
 * The first 8 characters are used as a lookup prefix; the full value is
 * verified against the stored Argon2 hash.
 *
 * On success the resolved ApiKey record (with its ServiceAccount) is
 * attached to `request.apiKey` for downstream use.
 *
 * If the API key has `requireIpRestriction` enabled, the client's IP
 * is validated against the configured `allowedIpRanges`. Both exact
 * IP addresses and CIDR notation (e.g. 10.0.0.0/8) are supported.
 *
 * If the API key has quotas configured (maxRequestsPerDay,
 * maxRequestsPerMonth, rateLimitPerMinute), these are checked and
 * enforced before allowing the request.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly serviceAccountsService: ServiceAccountsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const header = request.headers['x-api-key'];
    const plainKey = Array.isArray(header) ? header[0] : header;

    if (!plainKey || plainKey.length < 8) {
      throw new UnauthorizedException('Missing or malformed X-Api-Key header');
    }

    const keyPrefix = plainKey.slice(0, 8);
    const apiKey = await this.serviceAccountsService.validateApiKey(
      keyPrefix,
      plainKey,
    );

    // Validate IP restriction if configured
    if (apiKey.requireIpRestriction && apiKey.allowedIpRanges?.length > 0) {
      const clientIp = resolveClientIp(request);
      const isAllowed = apiKey.allowedIpRanges.some((range) =>
        ipMatchesRange(clientIp, range),
      );

      if (!isAllowed) {
        throw new ForbiddenException(
          `Access denied: client IP ${clientIp} is not in allowed ranges`,
        );
      }
    }

    // Check rate limit if configured
    if (apiKey.rateLimitPerMinute != null && apiKey.rateLimitPerMinute > 0) {
      const rateLimitResult = await this.serviceAccountsService.checkRateLimit(
        apiKey.id,
        apiKey.rateLimitPerMinute,
      );

      if (rateLimitResult?.exceeded) {
        response.setHeader(
          'Retry-After',
          rateLimitResult.retryAfterSeconds ?? 60,
        );
        response.setHeader(
          'X-RateLimit-Limit',
          apiKey.rateLimitPerMinute.toString(),
        );
        response.setHeader('X-RateLimit-Remaining', '0');
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: rateLimitResult.reason,
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Check daily quota if configured
    if (apiKey.maxRequestsPerDay != null && apiKey.maxRequestsPerDay > 0) {
      const dailyResult =
        await this.serviceAccountsService.checkAndIncrementDailyQuota(
          apiKey.id,
          apiKey.maxRequestsPerDay,
        );

      if (dailyResult?.exceeded) {
        response.setHeader(
          'X-RateLimit-Limit',
          apiKey.maxRequestsPerDay.toString(),
        );
        response.setHeader('X-RateLimit-Remaining', '0');
        response.setHeader('X-RateLimit-Reset', 'daily');
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: dailyResult.reason,
            error: 'Daily Quota Exceeded',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Check monthly quota if configured
    if (apiKey.maxRequestsPerMonth != null && apiKey.maxRequestsPerMonth > 0) {
      const quotaResult = await this.serviceAccountsService.checkQuotas(apiKey);

      if (quotaResult?.exceeded) {
        response.setHeader(
          'X-RateLimit-Limit',
          apiKey.maxRequestsPerMonth.toString(),
        );
        response.setHeader('X-RateLimit-Remaining', '0');
        response.setHeader('X-RateLimit-Reset', 'monthly');
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: quotaResult.reason,
            error: 'Monthly Quota Exceeded',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    (request as Request & { apiKey: typeof apiKey }).apiKey = apiKey;
    return true;
  }
}

/**
 * Check if an IP address matches a CIDR range or exact IP.
 * Supports both exact IP (e.g. "192.168.1.1") and CIDR notation (e.g. "10.0.0.0/8").
 */
function ipMatchesRange(ip: string, range: string): boolean {
  // Handle exact IP match
  if (!range.includes('/')) {
    return ip === range;
  }

  // Handle CIDR notation
  const [addr, prefixLenStr] = range.split('/');
  const prefixLen = parseInt(prefixLenStr, 10);

  if (!addr || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    return false;
  }

  const ipParts = ip.split('.').map((p) => parseInt(p, 10));
  const rangeParts = addr.split('.').map((p) => parseInt(p, 10));

  if (ipParts.length !== 4 || rangeParts.length !== 4) {
    return false;
  }

  for (const part of [...ipParts, ...rangeParts]) {
    if (isNaN(part) || part < 0 || part > 255) {
      return false;
    }
  }

  const ipNum =
    (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum =
    (rangeParts[0] << 24) |
    (rangeParts[1] << 16) |
    (rangeParts[2] << 8) |
    rangeParts[3];

  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;

  return (ipNum & mask) === (rangeNum & mask);
}
