import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BehavioralBiometricData,
  BaselineProfile,
  ContinuousRiskSignal,
  evaluateBehavioralBiometrics,
} from './continuous-risk-signals.js';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface BehavioralSampleInput {
  sessionId: string;
  realmId: string;
  userId: string;
  interactionType: 'typing' | 'pointer' | 'scroll' | 'keystroke';
  timestamp: Date;
  duration?: number;          // ms
  burstLength?: number;      // characters/keystrokes in burst
  velocity?: number;         // pixels/second
  acceleration?: number;     // px/s²
  idleTime?: number;         // ms between interactions
  errorCount?: number;       // backspaces/deletes in burst
  accuracy?: number;         // 0-1 ratio correct keystrokes
  cursorPositionDelta?: number;
  scrollAmount?: number;
}

export interface BehavioralBiometricSummary {
  sessionId: string;
  userId: string;
  sampleCount: number;
  baselineSampleCount: number;
  currentProfile: BehavioralBiometricData;
  baselineProfile: BaselineProfile | null;
  riskSignal: ContinuousRiskSignal;
  isAnomalous: boolean;
  anomalyReasons: string[];
}

export interface BaselineUpdateResult {
  profile: BaselineProfile;
  samplesUsed: number;
  significantChange: boolean;
  changeReason?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BehavioralBiometricsService {
  private readonly logger = new Logger(BehavioralBiometricsService.name);

  // Minimum samples needed before a baseline is considered reliable
  private readonly minBaselineSamples = 5;

  // Maximum age of samples to consider for baseline (30 days)
  private readonly baselineSampleMaxAge = 30 * 24 * 60 * 60 * 1000;

  // Sensitivity threshold for anomaly detection (0-1)
  private readonly defaultSensitivity = 0.7;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a behavioral sample from client SDK interaction data.
   */
  async recordSample(input: BehavioralSampleInput): Promise<void> {
    await this.prisma.behavioralSample.create({
      data: {
        sessionId: input.sessionId,
        realmId: input.realmId,
        userId: input.userId,
        interactionType: input.interactionType,
        collectedAt: input.timestamp,
        duration: input.duration ?? null,
        burstLength: input.burstLength ?? null,
        velocity: input.velocity ?? null,
        acceleration: input.acceleration ?? null,
        idleTime: input.idleTime ?? null,
        errorCount: input.errorCount ?? null,
        accuracy: input.accuracy ?? null,
        cursorPositionDelta: input.cursorPositionDelta ?? null,
        scrollAmount: input.scrollAmount ?? null,
      },
    });

    this.logger.debug(
      `Behavioral sample recorded sessionId=${input.sessionId} type=${input.interactionType}`,
    );
  }

  /**
   * Batch records multiple samples efficiently.
   */
  async recordSamples(inputs: BehavioralSampleInput[]): Promise<number> {
    if (inputs.length === 0) return 0;

    const created = await this.prisma.behavioralSample.createMany({
      data: inputs.map((input) => ({
        sessionId: input.sessionId,
        realmId: input.realmId,
        userId: input.userId,
        interactionType: input.interactionType,
        collectedAt: input.timestamp,
        duration: input.duration ?? undefined,
        burstLength: input.burstLength ?? undefined,
        velocity: input.velocity ?? undefined,
        acceleration: input.acceleration ?? undefined,
        idleTime: input.idleTime ?? undefined,
        errorCount: input.errorCount ?? undefined,
        accuracy: input.accuracy ?? undefined,
        cursorPositionDelta: input.cursorPositionDelta ?? undefined,
        scrollAmount: input.scrollAmount ?? undefined,
      })),
    });

    this.logger.debug(
      `Batch recorded ${created.count} behavioral samples for sessionId=${inputs[0].sessionId}`,
    );

    return created.count;
  }

  /**
   * Returns a summary of behavioral biometrics for a session, including
   * current data, baseline profile, and risk evaluation.
   */
  async getBehavioralSummary(
    sessionId: string,
    userId: string,
    realmId: string,
    sensitivity: number = this.defaultSensitivity,
  ): Promise<BehavioralBiometricSummary | null> {
    // Get current session samples
    const sessionSamples = await this.prisma.behavioralSample.findMany({
      where: { sessionId },
      orderBy: { collectedAt: 'desc' },
    });

    // Get baseline profile
    const baselineProfile = await this.getBaselineProfile(userId);

    // Compute current behavioral data
    const currentProfile = this.computeCurrentProfile(sessionSamples);

    // Evaluate against baseline
    const riskSignal = evaluateBehavioralBiometrics(currentProfile, baselineProfile, sensitivity);

    // Determine anomaly reasons
    const anomalyReasons = this.extractAnomalyReasons(riskSignal, currentProfile, baselineProfile);

    return {
      sessionId,
      userId,
      sampleCount: sessionSamples.length,
      baselineSampleCount: baselineProfile.sampleCount,
      currentProfile,
      baselineProfile: baselineProfile.sampleCount > 0 ? baselineProfile : null,
      riskSignal,
      isAnomalous: riskSignal.triggered && riskSignal.score > 0,
      anomalyReasons,
    };
  }

  /**
   * Updates the user's baseline profile using recent samples.
   * Call this after session ends to learn from user behavior.
   */
  async updateBaseline(
    userId: string,
    realmId: string,
    maxSamples: number = 100,
  ): Promise<BaselineUpdateResult> {
    // Get recent samples for this user
    const cutoffDate = new Date(Date.now() - this.baselineSampleMaxAge);
    const samples = await this.prisma.behavioralSample.findMany({
      where: {
        userId,
        collectedAt: { gte: cutoffDate },
      },
      orderBy: { collectedAt: 'desc' },
      take: maxSamples,
    });

    if (samples.length < this.minBaselineSamples) {
      return {
        profile: this.emptyBaseline(),
        samplesUsed: samples.length,
        significantChange: false,
        changeReason: 'Insufficient samples for baseline update',
      };
    }

    // Compute new baseline values
    const newBaseline = this.computeBaseline(samples);

    // Get current profile for comparison
    const existingProfile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    // Determine if there's a significant change
    const significantChange = existingProfile
      ? this.detectBaselineShift(existingProfile, newBaseline)
      : true;

    const changeReason = significantChange
      ? this.explainBaselineShift(existingProfile, newBaseline)
      : undefined;

    // Persist updated profile
    await this.prisma.behavioralBiometricProfile.upsert({
      where: { userId },
      create: {
        userId,
        realmId,
        avgTypingSpeed: newBaseline.avgTypingSpeed / 60, // store as chars/second
        avgPointerSpeed: newBaseline.avgMouseSpeed,
        typingVariance: newBaseline.avgMouseVariance,
        interactionFrequency: newBaseline.avgClickFrequency,
        avgSessionDuration: newBaseline.avgSessionDuration * 60, // store in seconds
        sampleCount: newBaseline.sampleCount,
      },
      update: {
        avgTypingSpeed: newBaseline.avgTypingSpeed / 60,
        avgPointerSpeed: newBaseline.avgMouseSpeed,
        typingVariance: newBaseline.avgMouseVariance,
        interactionFrequency: newBaseline.avgClickFrequency,
        avgSessionDuration: newBaseline.avgSessionDuration * 60,
        sampleCount: newBaseline.sampleCount,
      },
    });

    this.logger.debug(
      `Baseline updated for userId=${userId} samples=${samples.length} significantChange=${significantChange}`,
    );

    return {
      profile: newBaseline,
      samplesUsed: samples.length,
      significantChange,
      changeReason,
    };
  }

  /**
   * Resets a user's baseline to start fresh (e.g., after account compromise).
   */
  async resetBaseline(userId: string): Promise<void> {
    await this.prisma.behavioralBiometricProfile.deleteMany({
      where: { userId },
    });

    this.logger.debug(`Baseline reset for userId=${userId}`);
  }

  /**
   * Gets the baseline profile for a user, returning empty baseline if none exists.
   */
  async getBaselineProfile(userId: string): Promise<BaselineProfile> {
    const profile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return this.emptyBaseline();
    }

    // Convert from DB format (chars/second) to expected format (chars/minute)
    return {
      avgTypingSpeed: profile.avgTypingSpeed * 60,
      avgMouseSpeed: profile.avgPointerSpeed,
      avgMouseVariance: profile.typingVariance,
      avgClickFrequency: profile.interactionFrequency,
      avgErrorRate: 0,
      avgSessionDuration: profile.avgSessionDuration / 60,
      avgIdleTime: 0,
      sampleCount: profile.sampleCount,
    };
  }

  /**
   * Checks if the baseline has high enough sample count for reliable evaluation.
   */
  async isBaselineReliable(userId: string): Promise<boolean> {
    const profile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    return (profile?.sampleCount ?? 0) >= this.minBaselineSamples;
  }

  /**
   * Gets sample history for a user within a time window.
   */
  async getSampleHistory(
    userId: string,
    since: Date,
    limit = 200,
  ): Promise<{
    samples: {
      sessionId: string;
      interactionType: string;
      collectedAt: Date;
      duration: number | null;
      velocity: number | null;
      accuracy: number | null;
    }[];
    total: number;
  }> {
    const samples = await this.prisma.behavioralSample.findMany({
      where: {
        userId,
        collectedAt: { gte: since },
      },
      orderBy: { collectedAt: 'desc' },
      take: limit,
      select: {
        sessionId: true,
        interactionType: true,
        collectedAt: true,
        duration: true,
        velocity: true,
        accuracy: true,
      },
    });

    const total = await this.prisma.behavioralSample.count({
      where: {
        userId,
        collectedAt: { gte: since },
      },
    });

    return { samples, total };
  }

  /**
   * Cleans up old samples to prevent database bloat.
   */
  async cleanupOldSamples(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.behavioralSample.deleteMany({
      where: {
        collectedAt: { lt: cutoffDate },
      },
    });

    if (result.count > 0) {
      this.logger.debug(
        `Behavioral sample cleanup removed ${result.count} old samples older than ${retentionDays} days`,
      );
    }

    return result.count;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private computeCurrentProfile(samples: {
    interactionType: string;
    duration?: number | null;
    burstLength?: number | null;
    velocity?: number | null;
    idleTime?: number | null;
    errorCount?: number | null;
    accuracy?: number | null;
  }[]): BehavioralBiometricData {
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

    // Separate by interaction type
    const typingSamples = samples.filter(
      (s) => s.interactionType === 'typing' || s.interactionType === 'keystroke',
    );
    const pointerSamples = samples.filter((s) => s.interactionType === 'pointer');
    const scrollSamples = samples.filter((s) => s.interactionType === 'scroll');

    // Compute typing metrics
    let typingSpeed: number | null = null;
    let errorRate: number | null = null;

    if (typingSamples.length > 0) {
      const totalBurstLength = typingSamples.reduce(
        (acc, s) => acc + (s.burstLength ?? 0),
        0,
      );
      const totalDuration = typingSamples.reduce(
        (acc, s) => acc + (s.duration ?? 0),
        0,
      );

      if (totalDuration > 0) {
        // chars per minute
        typingSpeed = Math.round((totalBurstLength / totalDuration) * 60_000);
      }

      const totalErrors = typingSamples.reduce(
        (acc, s) => acc + (s.errorCount ?? 0),
        0,
      );
      const totalChars = typingSamples.reduce(
        (acc, s) => acc + (s.burstLength ?? 0),
        0,
      );

      if (totalChars > 0) {
        errorRate = totalErrors / totalChars;
      }
    }

    // Compute pointer/mouse metrics
    let mouseSpeed: number | null = null;
    let mouseVariance: number | null = null;

    if (pointerSamples.length > 0) {
      const speeds = pointerSamples
        .map((s) => s.velocity)
        .filter((v): v is number => v !== null && v !== undefined);

      if (speeds.length > 0) {
        mouseSpeed = speeds.reduce((acc, v) => acc + v, 0) / speeds.length;

        // Compute variance
        const mean = mouseSpeed;
        const squaredDiffs = speeds.map((v) => Math.pow(v - mean, 2));
        mouseVariance = squaredDiffs.reduce((acc, v) => acc + v, 0) / speeds.length;
      }
    }

    // Compute scroll metrics
    let scrollSpeed: number | null = null;

    if (scrollSamples.length > 0) {
      const scrollAmounts = scrollSamples
        .map((s) => s.burstLength)
        .filter((v): v is number => v !== null && v !== undefined);
      const durations = scrollSamples
        .map((s) => s.duration)
        .filter((v): v is number => v !== null && v !== undefined);

      if (scrollAmounts.length > 0 && durations.length > 0) {
        const totalScroll = scrollAmounts.reduce((acc, v) => acc + v, 0);
        const totalDuration = durations.reduce((acc, v) => acc + v, 0);

        if (totalDuration > 0) {
          scrollSpeed = totalScroll / totalDuration; // pixels/ms
        }
      }
    }

    // Compute idle time average
    const idleTimes = samples
      .map((s) => s.idleTime)
      .filter((v): v is number => v !== null && v !== undefined);
    const idleTimeAvg = idleTimes.length > 0
      ? idleTimes.reduce((acc, v) => acc + v, 0) / idleTimes.length
      : null;

    // Compute click frequency (interactions per minute)
    let clickFrequency: number | null = null;
    if (samples.length > 1) {
      const firstSample = samples[samples.length - 1];
      const lastSample = samples[0];
      const durationMs = lastSample.collectedAt.getTime() - firstSample.collectedAt.getTime();

      if (durationMs > 0) {
        clickFrequency = (samples.length / durationMs) * 60_000; // per minute
      }
    }

    // Session duration
    let sessionDuration: number | null = null;
    if (samples.length >= 2) {
      const firstSample = samples[samples.length - 1];
      const lastSample = samples[0];
      sessionDuration = (lastSample.collectedAt.getTime() - firstSample.collectedAt.getTime()) / 60_000; // minutes
    }

    return {
      typingSpeed,
      mouseMovementAvgSpeed: mouseSpeed,
      mouseMovementVariance: mouseVariance,
      scrollSpeedAvg: scrollSpeed,
      clickFrequency,
      errorRateTyping: errorRate,
      sessionDuration,
      idleTimeAvg: idleTimeAvg !== null ? idleTimeAvg / 1000 : null, // convert to seconds
    };
  }

  private computeBaseline(samples: {
    interactionType: string;
    duration?: number | null;
    burstLength?: number | null;
    velocity?: number | null;
    idleTime?: number | null;
    errorCount?: number | null;
    accuracy?: number | null;
    collectedAt: Date;
  }[]): BaselineProfile {
    const current = this.computeCurrentProfile(samples);

    return {
      avgTypingSpeed: current.typingSpeed ?? 0,
      avgMouseSpeed: current.mouseMovementAvgSpeed ?? 0,
      avgMouseVariance: current.mouseMovementVariance ?? 0,
      avgClickFrequency: current.clickFrequency ?? 0,
      avgErrorRate: current.errorRateTyping ?? 0,
      avgSessionDuration: current.sessionDuration ?? 0,
      avgIdleTime: current.idleTimeAvg ?? 0,
      sampleCount: samples.length,
    };
  }

  private emptyBaseline(): BaselineProfile {
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

  private detectBaselineShift(
    existing: {
      avgTypingSpeed: number;
      avgPointerSpeed: number;
    },
    newBaseline: BaselineProfile,
  ): boolean {
    // Check if typing speed changed by more than 30%
    const typingThreshold = existing.avgTypingSpeed * 0.3;
    const typingDiff = Math.abs(
      (newBaseline.avgTypingSpeed / 60) - existing.avgTypingSpeed,
    );

    if (typingDiff > typingThreshold) {
      return true;
    }

    // Check if pointer speed changed by more than 30%
    const pointerThreshold = existing.avgPointerSpeed * 0.3;
    const pointerDiff = Math.abs(newBaseline.avgMouseSpeed - existing.avgPointerSpeed);

    if (pointerDiff > pointerThreshold) {
      return true;
    }

    return false;
  }

  private explainBaselineShift(
    existing: {
      avgTypingSpeed: number;
      avgPointerSpeed: number;
    } | null,
    newBaseline: BaselineProfile,
  ): string | undefined {
    if (!existing) {
      return 'Initial baseline established';
    }

    const parts: string[] = [];

    const typingDiff = Math.abs(
      (newBaseline.avgTypingSpeed / 60) - existing.avgTypingSpeed,
    );
    if (typingDiff > 0) {
      const direction = newBaseline.avgTypingSpeed > existing.avgTypingSpeed * 60
        ? 'increased'
        : 'decreased';
      parts.push(`Typing speed ${direction}`);
    }

    const pointerDiff = Math.abs(newBaseline.avgMouseSpeed - existing.avgPointerSpeed);
    if (pointerDiff > 0) {
      const direction = newBaseline.avgMouseSpeed > existing.avgPointerSpeed
        ? 'increased'
        : 'decreased';
      parts.push(`Pointer speed ${direction}`);
    }

    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  private extractAnomalyReasons(
    signal: ContinuousRiskSignal,
    current: BehavioralBiometricData,
    baseline: BaselineProfile,
  ): string[] {
    if (!signal.triggered || signal.score === 0) {
      return [];
    }

    const reasons: string[] = [];

    // Typing speed deviation
    if (
      current.typingSpeed !== null &&
      baseline.avgTypingSpeed > 0 &&
      signal.reason.includes('typing')
    ) {
      const deviation = Math.round(
        Math.abs(current.typingSpeed - baseline.avgTypingSpeed) /
          baseline.avgTypingSpeed *
          100,
      );
      reasons.push(`Typing speed deviates by ${deviation}% from baseline`);
    }

    // Mouse speed deviation
    if (
      current.mouseMovementAvgSpeed !== null &&
      baseline.avgMouseSpeed > 0 &&
      signal.reason.includes('Mouse')
    ) {
      const deviation = Math.round(
        Math.abs(current.mouseMovementAvgSpeed - baseline.avgMouseSpeed) /
          baseline.avgMouseSpeed *
          100,
      );
      reasons.push(`Mouse movement speed deviates by ${deviation}% from baseline`);
    }

    // Error rate
    if (
      current.errorRateTyping !== null &&
      current.errorRateTyping > baseline.avgErrorRate * 2 &&
      signal.reason.includes('error')
    ) {
      reasons.push('Typing error rate significantly elevated');
    }

    // Session duration anomaly
    if (signal.reason.includes('Session duration')) {
      reasons.push(signal.reason);
    }

    return reasons;
  }
}