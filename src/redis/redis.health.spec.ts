import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health.js';
import { RedisService } from './redis.service.js';

describe('RedisHealthIndicator', () => {
  function build(redis: Partial<RedisService>) {
    return new RedisHealthIndicator(
      redis as RedisService,
      new HealthIndicatorService(),
    );
  }

  it('reports up (and disabled) when Redis is not configured, so readiness still passes', async () => {
    const indicator = build({ isAvailable: () => false });

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up', enabled: false },
    });
  });

  it('reports up when Redis answers the ping', async () => {
    const indicator = build({
      isAvailable: () => true,
      ping: jest.fn().mockResolvedValue(true),
    });

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('reports down when the ping fails', async () => {
    const indicator = build({
      isAvailable: () => true,
      ping: jest.fn().mockResolvedValue(false),
    });

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'down', message: 'ping returned false' },
    });
  });
});
