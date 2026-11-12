import { Module } from '@nestjs/common';
import {
  BruteForceController,
  BruteForceAttackDetectionController,
} from './brute-force.controller.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';

/**
 * The brute-force admin endpoints. Kept apart from the global
 * BruteForceModule, which LoginService itself depends on.
 */
@Module({
  imports: [LoginCoreModule, StepUpCoreModule],
  controllers: [BruteForceController, BruteForceAttackDetectionController],
})
export class BruteForceAdminModule {}
