import { Global, Module } from '@nestjs/common';
import {
  BruteForceController,
  BruteForceAttackDetectionController,
} from './brute-force.controller.js';
import { BruteForceService } from './brute-force.service.js';
import { LoginService } from '../login/login.service.js';
import { StepUpService } from '../step-up/step-up.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Global()
@Module({
  controllers: [BruteForceController, BruteForceAttackDetectionController],
  providers: [BruteForceService, LoginService, StepUpService, CryptoService, PrismaService],
  exports: [BruteForceService],
})
export class BruteForceModule {}
