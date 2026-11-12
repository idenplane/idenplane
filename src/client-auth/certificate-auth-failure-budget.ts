import { Inject, Injectable } from '@nestjs/common';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';

/**
 * MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE: failed certificate authentications
 * per (realm, certificate thumbprint) per minute, after which the
 * certificate is refused with 429 until the window ends. Independent of the
 * realm's own rate limits, which may be off.
 */
@Injectable()
export class CertificateAuthFailureBudget {
  constructor(
    private readonly rateLimits: RateLimitService,
    @Inject(MTLS_CONFIG) private readonly config: MtlsConfig,
  ) {}

  private key(realmId: string, x5tS256: string): string {
    return `mtls:${realmId}:${x5tS256}`;
  }

  /** Seconds to wait when the budget is spent, else `null`. */
  async retryAfter(realmId: string, x5tS256: string): Promise<number | null> {
    const budget = await this.rateLimits.failureBudget(
      this.key(realmId, x5tS256),
      this.config.authFailureLimitPerMinute,
    );
    return budget.exhausted ? budget.retryAfter : null;
  }

  async recordFailure(realmId: string, x5tS256: string): Promise<void> {
    await this.rateLimits.recordFailure(this.key(realmId, x5tS256));
  }
}
