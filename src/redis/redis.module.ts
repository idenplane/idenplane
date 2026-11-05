import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RedisService } from './redis.service.js';
import { RedisHealthIndicator } from './redis.health.js';

@Global()
@Module({
  // RedisHealthIndicator injects terminus's HealthIndicatorService.
  imports: [TerminusModule],
  providers: [RedisService, RedisHealthIndicator],
  exports: [RedisService, RedisHealthIndicator],
})
export class RedisModule {}
