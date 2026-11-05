import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from './redis.service.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.redis.isAvailable()) {
      // Redis is optional, so its absence must not fail readiness or flip the
      // overall status away from 'ok' (the Docker HEALTHCHECK and the admin
      // dashboard both key off it). Report it as up and say it is disabled.
      return indicator.up({ enabled: false });
    }

    const alive = await this.redis.ping();
    if (alive) {
      return indicator.up();
    }

    return indicator.down({ message: 'ping returned false' });
  }
}
