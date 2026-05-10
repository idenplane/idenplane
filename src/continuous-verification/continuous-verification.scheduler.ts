import { Injectable, Logger } from '@nestjs/common';
import { Interval, Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';

@Injectable()
export class ContinuousVerificationScheduler {
  private readonly logger = new Logger(ContinuousVerificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly continuousRiskService: ContinuousRiskAssessmentService,
  ) {}

  /**
   * Periodic risk re-evaluation for active sessions.
   * Runs every 5 minutes to assess ongoing session risk.
   */
  @Interval(300_000) // every 5 minutes
  async evaluateActiveSessions(): Promise<void> {
    const now = new Date();

    // Find all active sessions that are due for re-evaluation
    const sessionsToEvaluate = await this.prisma.sessionRiskProfile.findMany({
      where: {
        terminateSession: false,
        OR: [
          { nextEvaluationAt: { lte: now } },
          { nextEvaluationAt: null },
        ],
      },
      select: {
        id: true,
        sessionId: true,
        realmId: true,
        userId: true,
        riskScore: true,
        riskLevel: true,
        trustScore: true,
        lastEvaluatedAt: true,
      },
      take: 100, // Process in batches to avoid overwhelming the system
    });

    if (sessionsToEvaluate.length === 0) {
      return;
    }

    this.logger.debug(
      `Starting periodic risk evaluation for ${sessionsToEvaluate.length} session(s)`,
    );

    let evaluatedCount = 0;
    let errorCount = 0;

    for (const profile of sessionsToEvaluate) {
      try {
        // Fetch session details for context
        const session = await this.prisma.session.findUnique({
          where: { id: profile.sessionId },
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
          // Session may have been deleted, log and continue
          continue;
        }

        // Build session context for risk assessment
        const context = {
          sessionId: session.id,
          userId: session.userId,
          realmId: session.realmId,
          clientId: session.clientId,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          deviceFingerprint: null,
          timestamp: now,
        };

        // Perform the continuous risk assessment
        await this.continuousRiskService.assessContinuousRisk(
          context,
          'SCHEDULED',
          'Periodic re-evaluation',
        );

        evaluatedCount++;
      } catch (error) {
        errorCount++;
        this.logger.warn(
          `Failed to evaluate session profile ${profile.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (evaluatedCount > 0 || errorCount > 0) {
      this.logger.debug(
        `Periodic risk evaluation completed: ${evaluatedCount} evaluated, ${errorCount} failed`,
      );
    }
  }

  /**
   * Check for sessions requiring immediate step-up authentication.
   * Runs every minute to catch sessions that crossed risk thresholds.
   */
  @Interval(60_000) // every minute
  async checkStepUpRequired(): Promise<void> {
    const now = new Date();

    // Find sessions where step-up is required but not yet expired
    const stepUpSessions = await this.prisma.sessionRiskProfile.findMany({
      where: {
        stepUpRequired: true,
        terminateSession: false,
        stepUpExpiresAt: { gte: now },
      },
      select: {
        id: true,
        sessionId: true,
        realmId: true,
        userId: true,
        stepUpReason: true,
        stepUpExpiresAt: true,
      },
    });

    if (stepUpSessions.length === 0) {
      return;
    }

    this.logger.debug(
      `Found ${stepUpSessions.length} session(s) requiring step-up authentication`,
    );

    // Log for monitoring/alerting - actual step-up enforcement happens
    // through the session-step-up-trigger.ts service
    for (const session of stepUpSessions) {
      this.logger.log(
        `Session ${session.sessionId} requires step-up: ${session.stepUpReason ?? 'Risk threshold exceeded'}`,
      );
    }
  }

  /**
   * Identify and flag sessions for termination due to critical risk.
   * Runs every 2 minutes for timely session termination.
   */
  @Interval(120_000) // every 2 minutes
  async checkTerminateRequired(): Promise<void> {
    const now = new Date();

    // Find sessions marked for termination
    const terminateSessions = await this.prisma.sessionRiskProfile.findMany({
      where: {
        terminateSession: true,
      },
      select: {
        id: true,
        sessionId: true,
        realmId: true,
        userId: true,
        terminationReason: true,
      },
    });

    if (terminateSessions.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${terminateSessions.length} session(s) marked for termination`,
    );

    // Log termination events - actual termination is performed
    // through the session-termination.service.ts
    for (const session of terminateSessions) {
      this.logger.warn(
        `Session ${session.sessionId} marked for termination: ${session.terminationReason ?? 'Critical risk detected'}`,
      );
    }
  }

  /**
   * Daily cleanup of stale risk assessment data.
   * Runs at 3 AM daily to clean up old records.
   */
  @Cron('0 3 * * *') // 3 AM daily
  async cleanupOldRiskData(): Promise<void> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Delete old continuous risk events
    const riskEventResult = await this.prisma.continuousRiskEvent.deleteMany({
      where: { evaluatedAt: { lt: thirtyDaysAgo } },
    });

    // Clean up old behavioral samples
    const sampleResult = await this.prisma.behavioralSample.deleteMany({
      where: { collectedAt: { lt: ninetyDaysAgo } },
    });

    // Clean up stale device posture records (keep last 30 days)
    const postureResult = await this.prisma.devicePostureRecord.deleteMany({
      where: { reportedAt: { lt: thirtyDaysAgo } },
    });

    const total =
      riskEventResult.count +
      sampleResult.count +
      postureResult.count;

    if (total > 0) {
      this.logger.debug(
        `Risk data cleanup removed ${riskEventResult.count} risk event(s), ` +
        `${sampleResult.count} behavioral sample(s), ` +
        `${postureResult.count} device posture record(s)`,
      );
    }
  }

  /**
   * Decay trust scores for idle sessions.
   * Runs every hour to apply trust score decay for inactive sessions.
   */
  @Interval(3_600_000) // every hour
  async applyTrustDecay(): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Find active sessions with outdated trust scores
    const idleProfiles = await this.prisma.sessionRiskProfile.findMany({
      where: {
        terminateSession: false,
        trustScore: { gt: 0 },
        lastEvaluatedAt: { lt: oneDayAgo },
      },
      select: {
        id: true,
        sessionId: true,
        trustScore: true,
        riskLevel: true,
        lastEvaluatedAt: true,
      },
      take: 500,
    });

    if (idleProfiles.length === 0) {
      return;
    }

    // Apply decay to trust scores
    for (const profile of idleProfiles) {
      try {
        const lastEval = profile.lastEvaluatedAt ?? new Date(0);
        const hoursSinceLastEval = (now.getTime() - lastEval.getTime()) / (1000 * 60 * 60);

        // Base decay: 5% per hour of inactivity
        const decay = Math.min(hoursSinceLastEval * 0.05, 0.5);
        const newTrust = Math.max(0, Math.round(profile.trustScore * (1 - decay)));

        if (newTrust !== profile.trustScore) {
          await this.prisma.sessionRiskProfile.update({
            where: { id: profile.id },
            data: { trustScore: newTrust },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to apply trust decay to profile ${profile.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.debug(
      `Applied trust decay to ${idleProfiles.length} idle session profile(s)`,
    );
  }
}
