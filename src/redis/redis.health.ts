import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { RedisService } from './redis.service.js';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.redis.isAvailable()) {
      // Redis is optional — report degraded but don't fail readiness
      return this.getStatus(key, true, { status: 'disabled' });
    }

    const alive = await this.redis.ping();
    if (alive) {
      return this.getStatus(key, true);
    }

    throw new HealthCheckError(
      'Redis ping failed',
      this.getStatus(key, false, { message: 'ping returned false' }),
    );
  }
}
