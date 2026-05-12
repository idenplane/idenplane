import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImpossibleTravelService } from '../risk-assessment/impossible-travel.service.js';
import {
  ContinuousRiskSignal,
  ContinuousRiskThresholds,
  ContinuousRiskAction,
  DevicePostureData,
  NetworkContextData,
  BehavioralBiometricData,
  BaselineProfile,
  evaluateDevicePosture,
  evaluateNetworkContext,
  evaluateBehavioralBiometrics,
  aggregateContinuousSignals,
  determineContinuousAction,
} from './continuous-risk-signals.js';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface ContinuousSessionContext {
  sessionId: string;
  userId: string;
  realmId: string;
  clientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  timestamp: Date;
}

export interface ContinuousRiskAssessmentResult {
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  trustScore: number;
  signals: ContinuousRiskSignal[];
  action: ContinuousRiskAction;
  devicePostureSignal: ContinuousRiskSignal;
  networkContextSignal: ContinuousRiskSignal;
  behavioralSignal: ContinuousRiskSignal;
}

export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  fired: boolean;
  action: string;
  riskScoreContribution: number;
  reason?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ContinuousRiskAssessmentService {
  private readonly logger = new Logger(ContinuousRiskAssessmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly travelService: ImpossibleTravelService,
  ) {}

  /**
   * Main entry point: computes a full continuous risk assessment for the given
   * session context, persists the result, and returns it.
   */
  async assessContinuousRisk(
    context: ContinuousSessionContext,
    evaluationType: 'PERIODIC' | 'EVENT_DRIVEN' | 'SCHEDULED' = 'PERIODIC',
    triggerReason?: string,
  ): Promise<ContinuousRiskAssessmentResult> {
    // Fetch session risk profile
    const profile = await this.getOrCreateProfile(
      context.sessionId,
      context.realmId,
      context.userId,
    );

    // Fetch realm thresholds
    const realm = await this.prisma.realm.findUnique({
      where: { id: context.realmId },
      select: {
        riskThresholdStepUp: true,
        riskThresholdBlock: true,
      },
    });

    const thresholds: ContinuousRiskThresholds = {
      alertThreshold: 30,
      stepUpThreshold: realm?.riskThresholdStepUp ?? 50,
      blockThreshold: realm?.riskThresholdBlock ?? 80,
    };

    // ── Gather signal data ──────────────────────────────────────────────────

    // Device posture data from latest record
    const postureRecord = await this.getLatestDevicePosture(context.sessionId);
    const postureData = this.buildDevicePostureData(postureRecord);

    // Network context data
    const networkData = await this.buildNetworkContextData(context.ipAddress);

    // Behavioral biometrics baseline and current data
    const biometricProfile = await this.getBehavioralBaseline(
      context.userId,
      context.realmId,
    );
    const currentBiometricData = await this.getCurrentBehavioralData(
      context.sessionId,
    );

    // Policy policies for this realm/client
    const policies = await this.getActivePolicies(
      context.realmId,
      context.clientId,
    );

    // ── Evaluate each continuous signal ──────────────────────────────────────

    const deviceSignal = evaluateDevicePosture(postureData, false, {
      minDaysSinceScan: 7,
      requireEncryption: true,
      requireLockScreen: true,
    });

    const networkSignal = evaluateNetworkContext(networkData, {
      allowVPNAcrossCountries: true,
      blockTorNodes: false,
      blockDatacenterIPs: false,
      allowedCountries: null,
      blockedASNs: null,
    });

    const behavioralSignal = evaluateBehavioralBiometrics(
      currentBiometricData,
      biometricProfile,
      0.7,
    );

    const signals: ContinuousRiskSignal[] = [
      deviceSignal,
      networkSignal,
      behavioralSignal,
    ];

    const riskScore = aggregateContinuousSignals(signals);
    const riskLevel = this.scoreToRiskLevel(riskScore);

    // ── Evaluate policies ─────────────────────────────────────────────────────

    const policyResults = await this.evaluatePolicies(
      context,
      signals,
      riskScore,
      policies,
      profile.lastEvaluatedAt ?? null,
    );

    const policyScoreContribution = policyResults
      .filter((r) => r.fired)
      .reduce((acc, r) => acc + r.riskScoreContribution, 0);

    const finalScore = Math.min(100, riskScore + policyScoreContribution);
    const finalRiskLevel = this.scoreToRiskLevel(finalScore);
    const action = determineContinuousAction(finalScore, thresholds);

    // ── Calculate trust score (decays over time) ─────────────────────────────

    const trustScore = this.calculateTrustScore(
      profile.trustScore,
      finalRiskLevel,
      profile.lastEvaluatedAt ?? profile.createdAt,
      context.timestamp,
    );

    // ── Persist assessment ────────────────────────────────────────────────────

    await this.updateProfile(profile.id, {
      riskScore: finalScore,
      riskLevel: finalRiskLevel,
      trustScore,
      devicePosture: postureData as unknown as Prisma.InputJsonValue,
      networkContext: networkData as unknown as Prisma.InputJsonValue,
      behavioralSignals:
        currentBiometricData as unknown as Prisma.InputJsonValue,
      stepUpRequired: action === 'STEP_UP',
      stepUpReason: action === 'STEP_UP' ? 'Risk threshold exceeded' : null,
      stepUpExpiresAt:
        action === 'STEP_UP'
          ? new Date(Date.now() + 15 * 60 * 1000) // 15 min
          : null,
      terminateSession: action === 'TERMINATE',
      terminationReason:
        action === 'TERMINATE' ? 'Critical risk threshold exceeded' : null,
      lastEvaluatedAt: context.timestamp,
      nextEvaluationAt: this.calculateNextEvaluation(action, finalRiskLevel),
    });

    // Persist risk event
    await this.prisma.continuousRiskEvent.create({
      data: {
        sessionId: context.sessionId,
        realmId: context.realmId,
        userId: context.userId,
        clientId: context.clientId ?? null,
        evaluationType,
        triggerReason: triggerReason ?? null,
        riskScoreBefore: profile.riskScore,
        riskScoreAfter: finalScore,
        riskLevelBefore: profile.riskLevel,
        riskLevelAfter: finalRiskLevel,
        trustScoreBefore: profile.trustScore,
        trustScoreAfter: trustScore,
        signals: signals as unknown as Prisma.InputJsonValue,
        policyEvaluations: policyResults as unknown as Prisma.InputJsonValue,
        action: this.actionToDbAction(action),
        actionReason: action !== 'MONITOR' ? `Risk action: ${action}` : null,
        evaluatedAt: context.timestamp,
      },
    });

    this.logger.debug(
      `Continuous risk assessment sessionId=${context.sessionId} score=${finalScore} level=${finalRiskLevel} action=${action}`,
    );

    return {
      riskScore: finalScore,
      riskLevel: finalRiskLevel,
      trustScore,
      signals,
      action,
      devicePostureSignal: deviceSignal,
      networkContextSignal: networkSignal,
      behavioralSignal: behavioralSignal,
    };
  }

  /**
   * Records a device posture report from SDK/client.
   */
  async recordDevicePosture(
    sessionId: string,
    realmId: string,
    userId: string,
    deviceFingerprint: string,
    posture: {
      osType?: string | null;
      osVersion?: string | null;
      osBuild?: string | null;
      securityPatchLevel?: string | null;
      lastUpdateDate?: Date | null;
      diskEncrypted?: boolean | null;
      encryptionType?: string | null;
      antivirusEnabled?: boolean | null;
      antivirusName?: string | null;
      firewallEnabled?: boolean | null;
      screenLockEnabled?: boolean;
      lockTimeoutSeconds?: number | null;
      managedDevice?: boolean;
      mdmEnrollmentId?: string | null;
      jailbroken?: boolean;
      deviceTrustTier?: string;
      complianceStatus?: string | null;
      complianceDetails?: unknown;
    },
  ): Promise<void> {
    await this.prisma.devicePostureRecord.create({
      data: {
        sessionId,
        realmId,
        userId,
        deviceFingerprint,
        osType: posture.osType ?? null,
        osVersion: posture.osVersion ?? null,
        osBuild: posture.osBuild ?? null,
        securityPatchLevel: posture.securityPatchLevel ?? null,
        lastUpdateDate: posture.lastUpdateDate ?? null,
        diskEncrypted: posture.diskEncrypted ?? null,
        encryptionType: posture.encryptionType ?? null,
        antivirusEnabled: posture.antivirusEnabled ?? null,
        antivirusName: posture.antivirusName ?? null,
        firewallEnabled: posture.firewallEnabled ?? null,
        screenLockEnabled: posture.screenLockEnabled ?? false,
        lockTimeoutSeconds: posture.lockTimeoutSeconds ?? null,
        managedDevice: posture.managedDevice ?? false,
        mdmEnrollmentId: posture.mdmEnrollmentId ?? null,
        jailbroken: posture.jailbroken ?? false,
        deviceTrustTier: posture.deviceTrustTier ?? 'UNKNOWN',
        complianceStatus: posture.complianceStatus ?? null,
        complianceDetails:
          (posture.complianceDetails as Prisma.InputJsonValue) ?? null,
      },
    });

    this.logger.debug(`Device posture recorded for sessionId=${sessionId}`);
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

  private async updateProfile(
    id: string,
    data: {
      riskScore?: number;
      riskLevel?: string;
      trustScore?: number;
      devicePosture?: Prisma.InputJsonValue;
      networkContext?: Prisma.InputJsonValue;
      behavioralSignals?: Prisma.InputJsonValue;
      stepUpRequired?: boolean;
      stepUpReason?: string | null;
      stepUpExpiresAt?: Date | null;
      terminateSession?: boolean;
      terminationReason?: string | null;
      lastEvaluatedAt?: Date;
      nextEvaluationAt?: Date | null;
    },
  ): Promise<void> {
    await this.prisma.sessionRiskProfile.update({
      where: { id },
      data,
    });
  }

  private async getLatestDevicePosture(sessionId: string) {
    return this.prisma.devicePostureRecord.findFirst({
      where: { sessionId },
      orderBy: { reportedAt: 'desc' },
    });
  }

  private buildDevicePostureData(
    record: {
      osVersion?: string | null;
      osBuild?: string | null;
      securityPatchLevel?: string | null;
      lastUpdateDate?: Date | null;
      diskEncrypted?: boolean | null;
      antivirusEnabled?: boolean | null;
      firewallEnabled?: boolean | null;
      screenLockEnabled?: boolean;
      managedDevice?: boolean;
      jailbroken?: boolean;
      complianceStatus?: string | null;
    } | null,
  ): DevicePostureData {
    if (!record) {
      return {
        osVersion: null,
        osBuild: null,
        patchLevel: null,
        encryptedDisk: false,
        screenLockEnabled: false,
        antivirusActive: false,
        firewallActive: false,
        jailbreakRoot: false,
        customFirmware: false,
        MDMEnrolled: false,
        lastSecurityScan: null,
        complianceStatus: 'UNKNOWN',
      };
    }

    const patchDate = record.securityPatchLevel
      ? new Date(record.securityPatchLevel)
      : record.lastUpdateDate;

    return {
      osVersion: record.osVersion ?? null,
      osBuild: record.osBuild ?? null,
      patchLevel: record.securityPatchLevel ?? null,
      encryptedDisk: record.diskEncrypted ?? false,
      screenLockEnabled: record.screenLockEnabled ?? false,
      antivirusActive: record.antivirusEnabled ?? false,
      firewallActive: record.firewallEnabled ?? false,
      jailbreakRoot: record.jailbroken ?? false,
      customFirmware: false,
      MDMEnrolled: record.managedDevice ?? false,
      lastSecurityScan: patchDate ?? null,
      complianceStatus:
        (record.complianceStatus as
          | 'COMPLIANT'
          | 'NON_COMPLIANT'
          | 'UNKNOWN') ?? 'UNKNOWN',
    };
  }

  private async buildNetworkContextData(
    ipAddress: string | null | undefined,
  ): Promise<NetworkContextData> {
    if (!ipAddress) {
      return {
        ipAddress: null,
        isp: null,
        asn: null,
        vpnDetected: false,
        proxyDetected: false,
        torExitNode: false,
        datacenter: false,
        asnReputation: 'NEUTRAL',
        country: null,
        city: null,
        latitude: null,
        longitude: null,
      };
    }

    const [location, coords] = await Promise.all([
      this.travelService.lookupLocation(ipAddress),
      this.travelService.lookupCoords(ipAddress),
    ]);

    return {
      ipAddress,
      isp: null,
      asn: null,
      vpnDetected: false,
      proxyDetected: false,
      torExitNode: false,
      datacenter: false,
      asnReputation: 'NEUTRAL',
      country: location ? (location.split(', ').pop() ?? null) : null,
      city: location ? (location.split(', ')[0] ?? null) : null,
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
    };
  }

  private async getBehavioralBaseline(
    userId: string,
    realmId: string,
  ): Promise<BaselineProfile> {
    const profile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return {
        avgTypingSpeed: 0,
        avgMouseSpeed: 0,
        avgMouseVariance: 0,
        avgClickFrequency: 0,
        avgErrorRate: 0,
        avgSessionDuration: 0,
        avgIdleTime: 0,
        sampleCount: 0,
      };
    }

    // Convert from DB model (chars/second) to expected format (chars/minute)
    return {
      avgTypingSpeed: profile.avgTypingSpeed * 60,
      avgMouseSpeed: profile.avgPointerSpeed,
      avgMouseVariance: profile.typingVariance,
      avgClickFrequency: profile.interactionFrequency,
      avgErrorRate: 0,
      avgSessionDuration: profile.avgSessionDuration / 60, // seconds to minutes
      avgIdleTime: 0,
      sampleCount: profile.sampleCount,
    };
  }

  private async getCurrentBehavioralData(
    sessionId: string,
  ): Promise<BehavioralBiometricData> {
    const samples = await this.prisma.behavioralSample.findMany({
      where: { sessionId },
      orderBy: { collectedAt: 'desc' },
      take: 10,
    });

    if (samples.length === 0) {
      return {
        typingSpeed: null,
        mouseMovementAvgSpeed: null,
        mouseMovementVariance: null,
        scrollSpeedAvg: null,
        clickFrequency: null,
        errorRateTyping: null,
        sessionDuration: null,
        idleTimeAvg: null,
      };
    }

    // Aggregate samples into current behavioral data
    const typingSamples = samples.filter((s) => s.interactionType === 'typing');
    const pointerSamples = samples.filter(
      (s) => s.interactionType === 'pointer',
    );

    const avgTypingSpeed =
      typingSamples.length > 0
        ? typingSamples.reduce((acc, s) => acc + (s.burstLength ?? 0), 0) /
          typingSamples.length /
          60
        : null;

    const avgPointerSpeed =
      pointerSamples.length > 0
        ? pointerSamples.reduce((acc, s) => acc + (s.velocity ?? 0), 0) /
          pointerSamples.length
        : null;

    return {
      typingSpeed: avgTypingSpeed,
      mouseMovementAvgSpeed: avgPointerSpeed,
      mouseMovementVariance: null,
      scrollSpeedAvg: null,
      clickFrequency: null,
      errorRateTyping: null,
      sessionDuration: null,
      idleTimeAvg: null,
    };
  }

  private async getActivePolicies(realmId: string, clientId?: string | null) {
    return this.prisma.continuousRiskPolicy.findMany({
      where: {
        realmId,
        enabled: true,
        OR: [{ clientId: clientId ?? null }, { clientId: null }],
      },
      orderBy: { priority: 'desc' },
    });
  }

  private async evaluatePolicies(
    context: ContinuousSessionContext,
    signals: ContinuousRiskSignal[],
    currentScore: number,
    policies: {
      id: string;
      name: string;
      conditions: unknown;
      action: string;
      riskScoreContribution: number;
      cooldownSeconds: number;
    }[],
    lastEvaluatedAt: Date | null,
  ): Promise<PolicyEvaluationResult[]> {
    const results: PolicyEvaluationResult[] = [];
    const signalMap = new Map(signals.map((s) => [s.name, s]));

    for (const policy of policies) {
      // Check cooldown
      if (lastEvaluatedAt) {
        const cooldownMs = policy.cooldownSeconds * 1000;
        const elapsed = Date.now() - lastEvaluatedAt.getTime();
        if (elapsed < cooldownMs) {
          results.push({
            policyId: policy.id,
            policyName: policy.name,
            fired: false,
            action: policy.action,
            riskScoreContribution: 0,
          });
          continue;
        }
      }

      // Simple condition evaluation (supports "all" and "any" operators)
      const fired = this.evaluateCondition(
        policy.conditions,
        signalMap,
        currentScore,
        context,
      );

      results.push({
        policyId: policy.id,
        policyName: policy.name,
        fired,
        action: policy.action,
        riskScoreContribution: fired ? policy.riskScoreContribution : 0,
        reason: fired ? `Policy ${policy.name} triggered` : undefined,
      });
    }

    return results;
  }

  private evaluateCondition(
    conditions: unknown,
    _signalMap: Map<string, ContinuousRiskSignal>,
    _currentScore: number,
    _context: ContinuousSessionContext,
  ): boolean {
    if (!conditions || typeof conditions !== 'object') return false;

    const cond = conditions as Record<string, unknown>;

    // Handle "all" condition (all must be true)
    if (cond.all && Array.isArray(cond.all)) {
      return (cond.all as unknown[]).every((sub) =>
        this.evaluateCondition(sub, _signalMap, _currentScore, _context),
      );
    }

    // Handle "any" condition (at least one must be true)
    if (cond.any && Array.isArray(cond.any)) {
      return (cond.any as unknown[]).some((sub) =>
        this.evaluateCondition(sub, _signalMap, _currentScore, _context),
      );
    }

    // Simple signal check
    if (cond.signal && typeof cond.signal === 'string') {
      // Basic signal name matching
      const signalName = cond.signal;
      const signalMatch =
        signalName === 'device_posture' ||
        signalName === 'network_context' ||
        signalName === 'behavioral_biometrics';
      return signalMatch;
    }

    return false;
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
    // Decay based on time elapsed
    const hoursSinceLastEval =
      (now.getTime() - lastEvaluatedAt.getTime()) / (1000 * 60 * 60);

    // Base decay rate: 5% per hour
    const decay = Math.min(hoursSinceLastEval * 0.05, 0.5);

    // Risk level affects trust adjustment
    let riskAdjustment = 0;
    if (riskLevel === 'CRITICAL') riskAdjustment = -30;
    else if (riskLevel === 'HIGH') riskAdjustment = -15;
    else if (riskLevel === 'MEDIUM') riskAdjustment = -5;
    else riskAdjustment = 2; // Small boost for LOW

    const newTrust = currentTrust * (1 - decay) + riskAdjustment;
    return Math.max(0, Math.min(100, Math.round(newTrust)));
  }

  private calculateNextEvaluation(
    action: ContinuousRiskAction,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  ): Date {
    // Determine next evaluation interval based on action and risk level
    let intervalMinutes = 60; // default 1 hour

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
