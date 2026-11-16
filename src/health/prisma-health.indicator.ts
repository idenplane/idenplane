import { Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return indicator.up();
    } catch (error) {
      // /health/ready is public: a driver error can name hosts, users and
      // databases, so it goes to the log and the response says only "down".
      this.logger.error(
        `Database health check failed: ${(error as Error).message}`,
      );
      return indicator.down({ message: 'Database unavailable' });
    }
  }
}
