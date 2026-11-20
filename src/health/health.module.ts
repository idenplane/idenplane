import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { HeapHealthIndicator } from './heap-health.indicator.js';
import { PrismaHealthIndicator } from './prisma-health.indicator.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, HeapHealthIndicator],
})
export class HealthModule {}
