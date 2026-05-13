import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';
import { DevicePostureService } from './device-posture.service.js';
import { NetworkContextService } from './network-context.service.js';
import { BehavioralBiometricsService } from './behavioral-biometrics.service.js';
import { RiskPolicyService } from './risk-policy.service.js';
import { ImpossibleTravelService } from '../risk-assessment/impossible-travel.service.js';
import {
  ContinuousRiskSignal,
  ContinuousRiskAction,
  aggregateContinuousSignals,
  determineContinuousAction,
} from './continuous-risk-signals.js';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface SessionEvaluationJob {
  sessionId: string;
  userId: string;
  realmId: string;
  clientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  trigger: 'SCHEDULED' | 'EVENT' | 'MANUAL';
  reason?: string;
}

export interface SessionRiskEvaluationResult {
  sessionId: string;
  userId: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  trustScore: number;
  signals: ContinuousRiskSignal[];
  action: ContinuousRiskAction;
  deviceCompliance: boolean;
  networkRisk: boolean;
  behavioralAnomaly: boolean;
  evaluatedAt: Date;
  nextEvaluationAt: Date | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SessionRiskEvaluator {
  private readonly logger = new Logger(SessionRiskEvaluator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly continuousRiskService: ContinuousRiskAssessmentService,
    private readonly devicePostureService: DevicePostureService,
    private readonly networkContextService: NetworkContextService,
    private readonly biometricsService: BehavioralBiometricsService,
    private readonly policyService: RiskPolicyService,
    private readonly travelService: ImpossibleTravelService,
  ) {}

  /**
   * Evaluates risk for a single session and persists the result.
   * This is the main entry point for session risk evaluation jobs.
   */
  async evaluateSession(
    job: SessionEvaluationJob,
  ): Promise<SessionRiskEvaluationResult> {
    const now = new Date();

    this.logger.debug(
      `Evaluating session risk: sessionId=${job.sessionId} trigger=${job.trigger} reason=${job.reason ?? 'N/A'}`,
    );

    // Fetch or create session risk profile
    const profile = await this.getOrCreateProfile(
      job.sessionId,
      job.realmId,
      job.userId,
    );

    // Get realm thresholds
    const realmThresholds = await this.getRealmThresholds(job.realmId);

    // Gather all signal data
    const [devicePosture, networkContext, biometricData, travelCheck] =
      await Promise.all([
        this.gatherDevicePostureData(
          job.sessionId,
          job.realmId,
          job.userId,
          job.deviceFingerprint ?? null,
        ),
        this.gatherNetworkContextData(
          job.sessionId,
          job.realmId,
          job.userId,
          job.ipAddress,
        ),
        this.gatherBiometricData(job.sessionId, job.userId, job.realmId),
        this.performImpossibleTravelCheck(job.userId, job.ipAddress, now),
      ]);

    // Evaluate each signal
    const signals = this.evaluateAllSignals(
      devicePosture,
      networkContext,
      biometricData,
      travelCheck,
    );

    // Aggregate signals into risk score
    const riskScore = aggregateContinuousSignals(signals);
    const riskLevel = this.scoreToRiskLevel(riskScore);
    const _action = determineContinuousAction(riskScore, realmThresholds);

    // Get policy-based adjustments
    const policyAdjustment = await this.evaluatePolicyAdjustments(
      job.realmId,
      job.clientId,
      signals,
      riskScore,
    );

    const finalScore = Math.min(
      100,
      riskScore + policyAdjustment.scoreContribution,
    );
    const finalRiskLevel = this.scoreToRiskLevel(finalScore);
    const finalAction = determineContinuousAction(finalScore, realmThresholds);

    // Calculate trust score
    const trustScore = this.calculateTrustScore(
      profile.trustScore,
      finalRiskLevel,
      profile.lastEvaluatedAt ?? profile.createdAt,
      now,
    );

    // Persist the evaluation result
    await this.persistEvaluation(
      job,
      profile,
      signals,
      riskScore,
      finalScore,
      riskLevel,
      finalRiskLevel,
      finalAction,
      trustScore,
      now,
    );

    this.logger.debug(
      `Session risk evaluation complete: sessionId=${job.sessionId} score=${finalScore} level=${finalRiskLevel} action=${finalAction}`,
    );

    return {
      sessionId: job.sessionId,
      userId: job.userId,
      riskScore: finalScore,
      riskLevel: finalRiskLevel,
      trustScore,
      signals,
      action: finalAction,
      deviceCompliance: !devicePosture.nonCompliant,
      networkRisk: networkContext.isRisky,
      behavioralAnomaly: biometricData.isAnomalous,
      evaluatedAt: now,
      nextEvaluationAt: this.calculateNextEvaluation(
        finalAction,
        finalRiskLevel,
      ),
    };
  }

  /**
   * Evaluates risk for multiple sessions in batch.
   * Returns statistics about the batch evaluation.
   */
  async evaluateSessionsBatch(
    sessionIds: string[],
    trigger: 'SCHEDULED' | 'EVENT' | 'MANUAL' = 'SCHEDULED',
    reason?: string,
  ): Promise<{ total: number; evaluated: number; errors: number }> {
    const _now = new Date();
    let evaluated = 0;
    let errors = 0;

    this.logger.debug(
      `Starting batch session evaluation for ${sessionIds.length} session(s)`,
    );

    for (const sessionId of sessionIds) {
      try {
        // Fetch session details
        const session = await this.prisma.session.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            userId: true,
            realmId: true,
            clientId: true,
            ipAddress: true,
            userAgent: true,
          },
        });

        if (!session) {
          this.logger.debug(`Session not found: ${sessionId}`);
          continue;
        }

        const job: SessionEvaluationJob = {
          sessionId: session.id,
          userId: session.userId,
          realmId: session.realmId,
          clientId: session.clientId,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          deviceFingerprint: null,
          trigger,
          reason,
        };

        await this.evaluateSession(job);
        evaluated++;
      } catch (error) {
        errors++;
        this.logger.warn(
          `Failed to evaluate session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.debug(
      `Batch session evaluation complete: ${evaluated} evaluated, ${errors} errors`,
    );

    return { total: sessionIds.length, evaluated, errors };
  }

  /**
   * Immediately evaluates a session and returns the result.
   * Use this for event-driven evaluation (e.g., after login).
   */
  async evaluateSessionNow(
    sessionId: string,
    reason?: string,
  ): Promise<SessionRiskEvaluationResult> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        realmId: true,
        clientId: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const job: SessionEvaluationJob = {
      sessionId: session.id,
      userId: session.userId,
      realmId: session.realmId,
      clientId: session.clientId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      deviceFingerprint: null,
      trigger: 'EVENT',
      reason,
    };

    return this.evaluateSession(job);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getOrCreateProfile(
    sessionId: string,
    realmId: string,
    userId: string,
  ) {
    const existing = await this.prisma.sessionRiskProfile.findUnique({
      where: { sessionId },
    });
    if (existing) return existing;

    return this.prisma.sessionRiskProfile.create({
      data: {
        sessionId,
        realmId,
        userId,
        riskScore: 0,
        riskLevel: 'LOW',
        trustScore: 100,
        stepUpRequired: false,
        terminateSession: false,
      },
    });
  }

  private async getRealmThresholds(realmId: string) {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        riskThresholdStepUp: true,
        riskThresholdBlock: true,
      },
    });

    return {
      alertThreshold: 30,
      stepUpThreshold: realm?.riskThresholdStepUp ?? 50,
      blockThreshold: realm?.riskThresholdBlock ?? 80,
    };
  }

  private async gatherDevicePostureData(
    sessionId: string,
    realmId: string,
    userId: string,
    deviceFingerprint: string | null,
  ) {
    const latestRecord = await this.prisma.devicePostureRecord.findFirst({
      where: { sessionId },
      orderBy: { reportedAt: 'desc' },
    });

    const isTrusted = deviceFingerprint
      ? await this.devicePostureService.isDeviceTrusted(
          realmId,
          userId,
          deviceFingerprint,
        )
      : false;

    return {
      record: latestRecord,
      isTrusted,
      nonCompliant: latestRecord
        ? latestRecord.complianceStatus === 'NON_COMPLIANT' ||
          latestRecord.jailbroken
        : false,
    };
  }

  private async gatherNetworkContextData(
    sessionId: string,
    realmId: string,
    userId: string,
    ipAddress: string | null | undefined,
  ) {
    if (!ipAddress) {
      return {
        isRisky: false,
        details: null,
      };
    }

    const context = await this.networkContextService.captureNetworkContext(
      sessionId,
      realmId,
      userId,
      ipAddress,
    );

    const isRisky =
      context.isVpn ||
      context.isProxy ||
      context.isTor ||
      context.ipReputation === 'BAD' ||
      context.ipReputation === 'SUSPICIOUS';

    return {
      isRisky,
      details: context,
    };
  }

  private async gatherBiometricData(
    sessionId: string,
    userId: string,
    realmId: string,
  ) {
    const summary = await this.biometricsService.getBehavioralSummary(
      sessionId,
      userId,
      realmId,
    );

    const isAnomalous =
      summary !== null &&
      summary.sampleCount >= 5 &&
      summary.riskSignal.triggered &&
      summary.riskSignal.score >= 30;

    return {
      isAnomalous,
      summary,
    };
  }

  private async performImpossibleTravelCheck(
    userId: string,
    ipAddress: string | null | undefined,
    timestamp: Date,
  ) {
    if (!ipAddress) {
      return { isAnomalous: false, details: null };
    }

    const lastLogin = await this.getLastKnownLocation(userId);
    if (!lastLogin) {
      return { isAnomalous: false, details: null };
    }

    const currentCoords = await this.travelService.lookupCoords(ipAddress);
    if (!currentCoords) {
      return { isAnomalous: false, details: null };
    }

    // Calculate distance and time difference
    const timeDiff = timestamp.getTime() - lastLogin.timestamp.getTime();
    const distanceKm = this.calculateDistance(
      lastLogin.lat,
      lastLogin.lon,
      currentCoords.lat,
      currentCoords.lon,
    );

    // Impossible travel: > 500 km/h average speed
    const hoursElapsed = timeDiff / (1000 * 60 * 60);
    const avgSpeedKmh = hoursElapsed > 0 ? distanceKm / hoursElapsed : 0;
    const isAnomalous = avgSpeedKmh > 500;

    return {
      isAnomalous,
      details: {
        lastLocation: lastLogin.location,
        currentLocation: await this.travelService.lookupLocation(ipAddress),
        distanceKm: Math.round(distanceKm),
        avgSpeedKmh: Math.round(avgSpeedKmh),
        timeDiffHours: Math.round(hoursElapsed * 100) / 100,
      },
    };
  }

  private async getLastKnownLocation(userId: string) {
    const lastAssessment = await this.prisma.loginRiskAssessment.findFirst({
      where: { userId, action: { not: 'BLOCK' } },
      orderBy: { createdAt: 'desc' },
      select: { ipAddress: true, createdAt: true },
    });

    if (!lastAssessment?.ipAddress) return null;

    const coords = await this.travelService.lookupCoords(
      lastAssessment.ipAddress,
    );
    const location = await this.travelService.lookupLocation(
      lastAssessment.ipAddress,
    );

    if (!coords) return null;

    return {
      lat: coords.lat,
      lon: coords.lon,
      location: location ?? 'Unknown',
      timestamp: lastAssessment.createdAt,
    };
  }

  private evaluateAllSignals(
    devicePosture: {
      record: unknown;
      isTrusted: boolean;
      nonCompliant: boolean;
    },
    networkContext: { isRisky: boolean; details: unknown },
    biometricData: { isAnomalous: boolean; summary: unknown },
    travelCheck: { isAnomalous: boolean; details: unknown },
  ): ContinuousRiskSignal[] {
    const signals: ContinuousRiskSignal[] = [];

    // Device posture signal
    if (devicePosture.record) {
      const _postureRecord = devicePosture.record as {
        jailbroken?: boolean;
        complianceStatus?: string | null;
      };
      signals.push({
        name: 'device_posture',
        score: devicePosture.nonCompliant
          ? 25
          : devicePosture.isTrusted
            ? 0
            : 5,
        weight: 1.5,
        reason: devicePosture.nonCompliant
          ? 'Device is non-compliant or jailbroken'
          : devicePosture.isTrusted
            ? 'Device is trusted'
            : 'Device posture unknown',
        triggered: devicePosture.nonCompliant,
      });
    }

    // Network context signal
    if (networkContext.isRisky) {
      signals.push({
        name: 'network_context',
        score: 30,
        weight: 1.25,
        reason: 'Suspicious network context detected',
        triggered: true,
      });
    }

    // Behavioral biometrics signal
    if (biometricData.isAnomalous) {
      signals.push({
        name: 'behavioral_biometrics',
        score: 20,
        weight: 1.25,
        reason: 'Behavioral patterns deviate from baseline',
        triggered: true,
      });
    }

    // Impossible travel signal
    if (travelCheck.isAnomalous) {
      signals.push({
        name: 'impossible_travel',
        score: 40,
        weight: 2,
        reason: `Impossible travel detected: ${(travelCheck.details as { distanceKm?: number }).distanceKm ?? '?'} km at abnormal speed`,
        triggered: true,
      });
    }

    // Add baseline monitor signal if no anomalies
    if (signals.length === 0) {
      signals.push({
        name: 'baseline_monitor',
        score: 0,
        weight: 1,
        reason: 'All signals within normal parameters',
        triggered: false,
      });
    }

    return signals;
  }

  private async evaluatePolicyAdjustments(
    realmId: string,
    clientId: string | null | undefined,
    signals: ContinuousRiskSignal[],
    _riskScore: number,
  ) {
    const policies = await this.policyService.findAllPolicies({
      id: realmId,
    } as Realm);

    let scoreContribution = 0;
    const triggeredPolicies: string[] = [];

    for (const policy of policies) {
      if (!policy.enabled) continue;

      const signalNames = signals.filter((s) => s.triggered).map((s) => s.name);
      const matchesCondition =
        policy.conditions &&
        typeof policy.conditions === 'object' &&
        'signal' in policy.conditions &&
        signalNames.includes(policy.conditions.signal as string);

      if (matchesCondition) {
        scoreContribution += policy.riskScoreContribution;
        triggeredPolicies.push(policy.name);
      }
    }

    return {
      scoreContribution,
      triggeredPolicies,
    };
  }

  private async persistEvaluation(
    job: SessionEvaluationJob,
    profile: {
      id: string;
      riskScore: number;
      riskLevel: string;
      trustScore: number;
    },
    signals: ContinuousRiskSignal[],
    riskScore: number,
    finalScore: number,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    finalRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    action: ContinuousRiskAction,
    trustScore: number,
    now: Date,
  ): Promise<void> {
    // Update session risk profile
    await this.prisma.sessionRiskProfile.update({
      where: { id: profile.id },
      data: {
        riskScore: finalScore,
        riskLevel: finalRiskLevel,
        trustScore,
        stepUpRequired: action === 'STEP_UP',
        stepUpReason: action === 'STEP_UP' ? 'Risk threshold exceeded' : null,
        stepUpExpiresAt:
          action === 'STEP_UP'
            ? new Date(now.getTime() + 15 * 60 * 1000)
            : null,
        terminateSession: action === 'TERMINATE',
        terminationReason:
          action === 'TERMINATE' ? 'Critical risk detected' : null,
        lastEvaluatedAt: now,
        nextEvaluationAt: this.calculateNextEvaluation(action, finalRiskLevel),
      },
    });

    // Create continuous risk event
    await this.prisma.continuousRiskEvent.create({
      data: {
        sessionId: job.sessionId,
        realmId: job.realmId,
        userId: job.userId,
        clientId: job.clientId ?? null,
        evaluationType: job.trigger,
        triggerReason: job.reason ?? null,
        riskScoreBefore: profile.riskScore,
        riskScoreAfter: finalScore,
        riskLevelBefore: profile.riskLevel as
          | 'LOW'
          | 'MEDIUM'
          | 'HIGH'
          | 'CRITICAL',
        riskLevelAfter: finalRiskLevel,
        trustScoreBefore: profile.trustScore,
        trustScoreAfter: trustScore,
        signals: signals as unknown as Prisma.InputJsonValue,
        policyEvaluations: [],
        action: this.actionToDbAction(action),
        actionReason: action !== 'MONITOR' ? `Risk action: ${action}` : null,
        evaluatedAt: now,
      },
    });
  }

  private scoreToRiskLevel(
    score: number,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }

  private calculateTrustScore(
    currentTrust: number,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    lastEvaluatedAt: Date,
    now: Date,
  ): number {
    const hoursSinceLastEval =
      (now.getTime() - lastEvaluatedAt.getTime()) / (1000 * 60 * 60);
    const decay = Math.min(hoursSinceLastEval * 0.05, 0.5);

    let riskAdjustment = 0;
    if (riskLevel === 'CRITICAL') riskAdjustment = -30;
    else if (riskLevel === 'HIGH') riskAdjustment = -15;
    else if (riskLevel === 'MEDIUM') riskAdjustment = -5;
    else riskAdjustment = 2;

    const newTrust = currentTrust * (1 - decay) + riskAdjustment;
    return Math.max(0, Math.min(100, Math.round(newTrust)));
  }

  private calculateNextEvaluation(
    action: ContinuousRiskAction,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  ): Date {
    let intervalMinutes = 60;

    if (action === 'TERMINATE') {
      intervalMinutes = 5;
    } else if (action === 'STEP_UP') {
      intervalMinutes = 15;
    } else if (riskLevel === 'CRITICAL') {
      intervalMinutes = 10;
    } else if (riskLevel === 'HIGH') {
      intervalMinutes = 30;
    } else if (riskLevel === 'MEDIUM') {
      intervalMinutes = 45;
    }

    return new Date(Date.now() + intervalMinutes * 60 * 1000);
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    // Haversine formula for calculating distance between two coordinates
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private actionToDbAction(action: ContinuousRiskAction): string {
    switch (action) {
      case 'MONITOR':
        return 'NO_ACTION';
      case 'ALERT':
        return 'NOTIFY';
      case 'STEP_UP':
        return 'STEP_UP_REQUIRED';
      case 'TERMINATE':
        return 'TERMINATE_SESSION';
    }
  }
}
