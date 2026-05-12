import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { MetricsService } from './metrics.service.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';

@ApiTags('Metrics')
@Controller('admin/metrics')
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Prometheus metrics in text format',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — admin credentials required',
  })
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.registry.metrics();
  }
}
