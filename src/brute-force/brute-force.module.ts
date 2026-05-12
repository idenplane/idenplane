import { Global, Module } from '@nestjs/common';
import {
  BruteForceController,
  BruteForceAttackDetectionController,
} from './brute-force.controller.js';
import { BruteForceService } from './brute-force.service.js';

@Global()
@Module({
  controllers: [BruteForceController, BruteForceAttackDetectionController],
  providers: [BruteForceService],
  exports: [BruteForceService],
})
export class BruteForceModule {}
