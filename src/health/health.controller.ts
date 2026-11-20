import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator.js';
import { HeapHealthIndicator } from './heap-health.indicator.js';
import { PrismaHealthIndicator } from './prisma-health.indicator.js';
import { RedisHealthIndicator } from '../redis/redis.health.js';

@ApiTags('Health')
@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly heap: HeapHealthIndicator,
    private readonly db: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  liveness() {
    return this.health.check([]);
  }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness check (alias)' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  livenessAlias() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness check (database + memory + redis)' })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies unhealthy',
  })
  readiness() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.heap.isHealthy('memory_heap'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
