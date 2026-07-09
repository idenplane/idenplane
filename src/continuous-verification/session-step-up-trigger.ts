import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  StepUpService,
  ACR_MFA,
  ACR_WEBAUTHN,
} from '../step-up/step-up.service.js';

/**
 * SessionStepUpTrigger
 *
 * Monitors session risk profiles and enforces step-up authentication when
 * risk thresholds are exceeded. This service integrates with the StepUpService
 * to create step-up records that force users to re-authenticate with a higher
 * assurance level (MFA or WebAuthn).
 *
 * The trigger runs every minute via @Interval to catch sessions that have
 * crossed risk thresholds and need immediate step-up authentication.
 */
@Injectable()
export class SessionStepUpTrigger {
  private readonly logger = new Logger(SessionStepUpTrigger.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUpService: StepUpService,
  ) {}

  /**
   * Check for sessions that require step-up authentication.
   * Runs every minute to catch sessions that crossed risk thresholds.
   *
   * When a session's risk score exceeds the step-up threshold, this service:
   * 1. Creates a step-up requirement record for the session
   * 2. Logs the step-up event for monitoring/alerting
   * 3. Emits an event to notify the client application
   */
  @Interval(60_000) // every minute
  async checkAndTriggerStepUp(): Promise<void> {
    const now = new Date();

    // Find all sessions requiring step-up that haven't expired
    const stepUpSessions = await this.prisma.sessionRiskProfile.findMany({
      where: {
        stepUpRequired: true,
        terminateSession: false,
        stepUpExpiresAt: { gte: now },
      },
      include: {
        session: {
          select: {
            id: true,
            userId: true,
            realmId: true,
            clientId: true,
            user: {
              select: {
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (stepUpSessions.length === 0) {
      return;
    }

    this.logger.debug(
      `Found ${stepUpSessions.length} session(s) requiring step-up authentication`,
    );

    for (const profile of stepUpSessions) {
      try {
        await this.triggerStepUp(profile, now);
      } catch (error) {
        this.logger.error(
          `Failed to trigger step-up for session ${profile.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  /**
   * Manually trigger step-up for a specific session.
   * Use this when you need to force step-up outside the scheduled check.
   *
   * @param sessionId - The session requiring step-up
   * @param reason - Optional reason for the step-up
   */
  async triggerStepUpForSession(
    sessionId: string,
    reason?: string,
  ): Promise<void> {
    const profile = await this.prisma.sessionRiskProfile.findUnique({
      where: { sessionId },
      include: {
        session: {
          select: {
            id: true,
            userId: true,
            realmId: true,
            clientId: true,
          },
        },
      },
    });

    if (!profile) {
      throw new Error(
        `Session risk profile not found for session: ${sessionId}`,
      );
    }

    await this.triggerStepUp(profile, new Date(), reason);
  }

  /**
   * Determine the required ACR level based on risk score.
   * Higher risk scores require stronger authentication.
   */
  private determineRequiredAcr(riskScore: number): string {
    // CRITICAL risk (>=80) requires WebAuthn
    // HIGH risk (>=60) requires MFA
    // MEDIUM risk (>=40) also requires MFA as a precaution
    if (riskScore >= 80) {
      return ACR_WEBAUTHN;
    }
    return ACR_MFA;
  }

  /**
   * Get the step-up cache duration based on risk level.
   * Higher risk = shorter cache duration to force more frequent re-auth.
   */
  private getCacheDuration(riskScore: number): number {
    // CRITICAL: 5 minutes
    // HIGH: 10 minutes
    // MEDIUM: 15 minutes
    if (riskScore >= 80) {
      return 5 * 60; // 5 minutes
    }
    if (riskScore >= 60) {
      return 10 * 60; // 10 minutes
    }
    return 15 * 60; // 15 minutes
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async triggerStepUp(
    profile: {
      sessionId: string;
      riskScore: number;
      riskLevel: string;
      stepUpReason: string | null;
      stepUpExpiresAt: Date | null;
      session?: {
        id: string;
        userId: string;
        realmId: string;
        clientId: string | null;
        user?: { username: string; email: string | null };
      } | null;
    },
    now: Date,
    overrideReason?: string,
  ): Promise<void> {
    const session = profile.session;
    if (!session) {
      this.logger.warn(`No session found for profile: ${profile.sessionId}`);
      return;
    }

    // Determine required ACR based on risk score
    const requiredAcr = this.determineRequiredAcr(profile.riskScore);
    const cacheDuration = this.getCacheDuration(profile.riskScore);

    // Create step-up record
    await this.stepUpService.recordStepUp(
      profile.sessionId,
      requiredAcr,
      cacheDuration,
    );

    // Also update the session's required ACR if it's higher than current
    if (session.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: session.clientId },
        select: { id: true, requiredAcr: true },
      });

      // If the client doesn't have a required ACR set, or if our required ACR
      // is higher, update it
      const currentAcrStrength = this.stepUpService.getAcrStrength(
        client?.requiredAcr ?? '',
      );
      const requiredAcrStrength =
        this.stepUpService.getAcrStrength(requiredAcr);

      if (requiredAcrStrength > currentAcrStrength) {
        await this.prisma.client.update({
          where: { id: session.clientId },
          data: { requiredAcr },
        });
      }
    }

    // Create an event log entry for audit/monitoring
    await this.prisma.continuousRiskEvent.create({
      data: {
        sessionId: profile.sessionId,
        realmId: session.realmId,
        userId: session.userId,
        clientId: session.clientId,
        evaluationType: 'EVENT_DRIVEN',
        triggerReason:
          overrideReason ?? profile.stepUpReason ?? 'Risk threshold exceeded',
        riskScoreBefore: profile.riskScore,
        riskScoreAfter: profile.riskScore,
        riskLevelBefore: profile.riskLevel as
          'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        riskLevelAfter: profile.riskLevel as
          'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        trustScoreBefore: 100,
        trustScoreAfter: 100,
        signals: [],
        policyEvaluations: [],
        action: 'STEP_UP_REQUIRED',
        actionReason: `Step-up triggered: risk score ${profile.riskScore} requires ${requiredAcr} authentication`,
        evaluatedAt: now,
      },
    });

    // Emit a step-up event for real-time notification (could use EventEmitter2)
    this.logger.log(
      `Step-up authentication required for session ${profile.sessionId} ` +
        `(user: ${session.user?.username ?? 'unknown'}, risk: ${profile.riskScore}, level: ${profile.riskLevel})`,
    );

    // TODO: Emit event for WebSocket/push notification to client application
    // this.eventEmitter.emit('session.stepup.required', { sessionId, requiredAcr, reason });
  }
}
