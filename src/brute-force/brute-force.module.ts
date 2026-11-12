import { Global, Module } from '@nestjs/common';
import { BruteForceService } from './brute-force.service.js';

// The admin endpoints live in BruteForceAdminModule.
@Global()
@Module({
  providers: [BruteForceService],
  exports: [BruteForceService],
})
export class BruteForceModule {}
