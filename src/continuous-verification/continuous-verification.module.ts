import { Module } from '@nestjs/common';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';
import { ContinuousVerificationController } from './continuous-verification.controller.js';
import { DevicePostureService } from './device-posture.service.js';
import { NetworkContextService } from './network-context.service.js';
import { BehavioralBiometricsService } from './behavioral-biometrics.service.js';
import { RiskPolicyService } from './risk-policy.service.js';
import { ContinuousVerificationScheduler } from './continuous-verification.scheduler.js';
import { SessionRiskEvaluator } from './session-risk-evaluator.js';
import { SessionStepUpTrigger } from './session-step-up-trigger.js';
import { SessionTerminationService } from './session-termination.service.js';
import { RiskPolicyController } from './risk-policy.controller.js';
import { SessionRiskController } from './session-risk.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailModule } from '../email/email.module.js';
import { ImpossibleTravelService } from '../risk-assessment/impossible-travel.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { StepUpModule } from '../step-up/step-up.module.js';

@Module({
  imports: [PrismaModule, EmailModule, SessionsModule, StepUpModule],
  providers: [
    ContinuousRiskAssessmentService,
    DevicePostureService,
    NetworkContextService,
    BehavioralBiometricsService,
    RiskPolicyService,
    ContinuousVerificationScheduler,
    SessionRiskEvaluator,
    SessionStepUpTrigger,
    SessionTerminationService,
    ImpossibleTravelService,
  ],
  controllers: [
    ContinuousVerificationController,
    RiskPolicyController,
    SessionRiskController,
  ],
  exports: [
    ContinuousRiskAssessmentService,
    DevicePostureService,
    NetworkContextService,
    BehavioralBiometricsService,
    RiskPolicyService,
    SessionStepUpTrigger,
    SessionTerminationService,
  ],
})
export class ContinuousVerificationModule {}