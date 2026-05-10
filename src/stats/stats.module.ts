import { Module } from '@nestjs/common';
import { StatsService } from './stats.service.js';
import { StatsController } from './stats.controller.js';
import { ConsentModule } from '../consent/consent.module.js';

@Module({
  imports: [ConsentModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
