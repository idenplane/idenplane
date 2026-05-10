import { Module } from '@nestjs/common';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';
import { ContinuousVerificationController } from './continuous-verification.controller.js';
import { DevicePostureService } from './device-posture.service.js';
import { NetworkContextService } from './network-context.service.js';
import { BehavioralBiometricsService } from './behavioral-biometrics.service.js';
import { RiskPolicyService } from './risk-policy.service.js';
import { ContinuousVerificationScheduler } from './continuous-verification.scheduler.js';
import { SessionRiskEvaluator } from './session-risk-evaluator.js';
import { RiskPolicyController } from './risk-policy.controller.js';
import { SessionRiskController } from './session-risk.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailModule } from '../email/email.module.js';
import { ImpossibleTravelService } from '../risk-assessment/impossible-travel.service.js';

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [
    ContinuousRiskAssessmentService,
    DevicePostureService,
    NetworkContextService,
    BehavioralBiometricsService,
    RiskPolicyService,
    ContinuousVerificationScheduler,
    SessionRiskEvaluator,
    ImpossibleTravelService,
  ],
  controllers: [
    ContinuousVerificationController,
    RiskPolicyController,
    SessionRiskController,
  ],
  exports: [ContinuousRiskAssessmentService, DevicePostureService, NetworkContextService, BehavioralBiometricsService, RiskPolicyService],
})
export class ContinuousVerificationModule {}