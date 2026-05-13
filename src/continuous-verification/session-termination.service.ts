import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

/**
 * SessionTerminationService
 *
 * Handles automatic session termination when critical risk is detected.
 * This service integrates with the SessionsService to revoke sessions
 * that have been flagged for termination due to HIGH or CRITICAL risk scores.
 *
 * The service runs every 2 minutes to check for sessions that need to be
 * terminated and performs the actual revocation through the SessionsService.
 */
@Injectable()
export class SessionTerminationService {
  private readonly logger = new Logger(SessionTerminationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  /**
   * Check for sessions that need to be terminated due to critical risk.
   * Runs every 2 minutes to ensure timely session revocation.
   *
   * When a session's risk score exceeds the termination threshold:
   * 1. The session is immediately revoked
   * 2. All associated refresh tokens are invalidated
   * 3. An audit event is recorded
   */
  @Interval(120_000) // every 2 minutes
  async checkAndTerminateSessions(): Promise<void> {
    const now = new Date();

    // Find all sessions marked for termination
    const terminateSessions = await this.prisma.sessionRiskProfile.findMany({
      where: {
        terminateSession: true,
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

    if (terminateSessions.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${terminateSessions.length} session(s) marked for termination`,
    );

    let terminatedCount = 0;
    let errorCount = 0;

    for (const profile of terminateSessions) {
      try {
        await this.terminateSession(profile, now);
        terminatedCount++;
      } catch (_error) {
        errorCount++;
        this.logger.error(
          `Failed to terminate session ${profile.sessionId}: ${_error instanceof Error ? _error.message : String(_error)}`,
          _error instanceof Error ? _error.stack : undefined,
        );
      }
    }

    this.logger.log(
      `Session termination check completed: ${terminatedCount} terminated, ${errorCount} failed`,
    );
  }

  /**
   * Manually terminate a specific session.
   * Use this when you need to force termination outside the scheduled check.
   *
   * @param sessionId - The session to terminate
   * @param reason - Optional reason for termination
   */
  async terminateSessionById(
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

    if (!profile) {
      throw new Error(
        `Session risk profile not found for session: ${sessionId}`,
      );
    }

    await this.terminateSession(profile, new Date(), reason);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async terminateSession(
    profile: {
      sessionId: string;
      riskScore: number;
      riskLevel: string;
      terminationReason: string | null;
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

    const terminationReason =
      overrideReason ?? profile.terminationReason ?? 'Critical risk detected';

    // Revoke the session via SessionsService
    try {
      await this.sessionsService.revokeSession(
        null,
        profile.sessionId,
        'oauth',
      );
      this.logger.log(
        `Session ${profile.sessionId} revoked due to critical risk ` +
          `(user: ${session.user?.username ?? 'unknown'}, risk: ${profile.riskScore}, level: ${profile.riskLevel})`,
      );
    } catch {
      // If the session doesn't exist in the oauth table, try login session
      try {
        await this.sessionsService.revokeSession(
          null,
          profile.sessionId,
          'sso',
        );
        this.logger.log(
          `Login session ${profile.sessionId} revoked due to critical risk`,
        );
      } catch (innerError) {
        // Session may have already been cleaned up - log but don't fail
        this.logger.debug(
          `Session ${profile.sessionId} may already be cleaned up: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
        );
      }
    }

    // Clear the terminateSession flag since we've handled it
    await this.prisma.sessionRiskProfile.update({
      where: { sessionId: profile.sessionId },
      data: {
        terminateSession: false,
        terminationReason: terminationReason,
      },
    });

    // Create a termination audit event
    await this.prisma.continuousRiskEvent.create({
      data: {
        sessionId: profile.sessionId,
        realmId: session.realmId,
        userId: session.userId,
        clientId: session.clientId,
        evaluationType: 'EVENT_DRIVEN',
        triggerReason: terminationReason,
        riskScoreBefore: profile.riskScore,
        riskScoreAfter: profile.riskScore,
        riskLevelBefore: profile.riskLevel as
          | 'LOW'
          | 'MEDIUM'
          | 'HIGH'
          | 'CRITICAL',
        riskLevelAfter: profile.riskLevel as
          | 'LOW'
          | 'MEDIUM'
          | 'HIGH'
          | 'CRITICAL',
        trustScoreBefore: 0,
        trustScoreAfter: 0,
        signals: [],
        policyEvaluations: [],
        action: 'TERMINATE_SESSION',
        actionReason: `Session terminated: ${terminationReason}`,
        evaluatedAt: now,
      },
    });

    // Emit termination event for real-time notification
    // TODO: Emit event for WebSocket/push notification to client application
    // this.eventEmitter.emit('session.terminated', { sessionId, reason: terminationReason });

    // TODO: Send notification to user about session termination
    // await this.emailService.sendSessionTerminationNotice(session.user.email, session.user.username);
  }
}
