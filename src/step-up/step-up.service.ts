import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── ACR Level Constants ──────────────────────────────────────────────────────

/** ACR level for password-only authentication (level 1). */
export const ACR_PASSWORD = 'urn:idenplane:acr:password';

/** ACR level for password + MFA/TOTP authentication (level 2). */
export const ACR_MFA = 'urn:idenplane:acr:mfa';

/** ACR level for WebAuthn/passkey authentication (level 3). */
export const ACR_WEBAUTHN = 'urn:idenplane:acr:webauthn';

/** All supported ACR values, ordered from lowest to highest assurance. */
export const ACR_VALUES_SUPPORTED = [
  ACR_PASSWORD,
  ACR_MFA,
  ACR_WEBAUTHN,
] as const;

export type AcrValue = (typeof ACR_VALUES_SUPPORTED)[number];

/** Numeric strength mapping: higher number = stronger authentication. */
const ACR_LEVEL_STRENGTH: Record<string, number> = {
  [ACR_PASSWORD]: 1,
  [ACR_MFA]: 2,
  [ACR_WEBAUTHN]: 3,
};

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── ACR helpers ────────────────────────────────────────────────────────────

  /**
   * Returns the numeric strength of an ACR value.
   * Unknown values default to 0 (no assurance).
   */
  getAcrStrength(acr: string): number {
    return ACR_LEVEL_STRENGTH[acr] ?? 0;
  }

  /**
   * Returns true if `candidate` satisfies `required` (i.e. is at least as
   * strong as required).
   */
  satisfiesAcr(candidate: string, required: string): boolean {
    return this.getAcrStrength(candidate) >= this.getAcrStrength(required);
  }

  // ── Session ACR ────────────────────────────────────────────────────────────

  /**
   * Returns the highest ACR level that has an active (non-expired) step-up
   * record for the given session.  Falls back to `ACR_PASSWORD` if no records
   * exist (the session was established via password-only).
   */
  async getSessionAcr(sessionId: string): Promise<string> {
    const now = new Date();
    const records = await this.prisma.stepUpRecord.findMany({
      where: { sessionId, expiresAt: { gt: now } },
      orderBy: { completedAt: 'desc' },
    });

    if (records.length === 0) {
      return ACR_PASSWORD;
    }

    // Return the record with the highest strength
    let best = ACR_PASSWORD;
    for (const rec of records) {
      if (this.getAcrStrength(rec.acrLevel) > this.getAcrStrength(best)) {
        best = rec.acrLevel;
      }
    }
    return best;
  }

  // ── Step-up requirement ────────────────────────────────────────────────────

  /**
   * Returns the `requiredAcr` for a client, or null if the client has no
   * step-up requirement.
   */
  async getClientRequiredAcr(clientId: string): Promise<string | null> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { requiredAcr: true },
    });
    return client?.requiredAcr ?? null;
  }

  /**
   * Returns true if the session needs to perform a step-up before the client
   * can be accessed.
   *
   * @param clientDbId  The internal UUID of the client (not the OAuth client_id string).
   * @param currentAcr  The ACR level currently held by the session.
   */
  async requiresStepUp(
    clientDbId: string,
    currentAcr: string,
  ): Promise<boolean> {
    const requiredAcr = await this.getClientRequiredAcr(clientDbId);
    if (!requiredAcr) return false;
    return !this.satisfiesAcr(currentAcr, requiredAcr);
  }

  // ── Step-up caching ────────────────────────────────────────────────────────

  /**
   * Records a completed step-up for `sessionId` at `acrLevel`.
   * Creates a new record that expires after `cacheDuration` seconds.
   */
  async recordStepUp(
    sessionId: string,
    acrLevel: string,
    cacheDuration: number,
  ): Promise<void> {
    await this.prisma.stepUpRecord.create({
      data: {
        sessionId,
        acrLevel,
        expiresAt: new Date(Date.now() + cacheDuration * 1000),
      },
    });
    this.logger.debug(
      `Step-up recorded: session=${sessionId} acr=${acrLevel} ttl=${cacheDuration}s`,
    );
  }

  /**
   * Returns true if there is a non-expired step-up record for `sessionId`
   * that satisfies `requiredAcr`.
   */
  async isStepUpCached(
    sessionId: string,
    requiredAcr: string,
  ): Promise<boolean> {
    const currentAcr = await this.getSessionAcr(sessionId);
    return this.satisfiesAcr(currentAcr, requiredAcr);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  /** Purge expired step-up records every 15 minutes. */
  @Interval(15 * 60 * 1000)
  async cleanupExpiredRecords(): Promise<void> {
    const { count } = await this.prisma.stepUpRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired step-up record(s)`);
    }
  }
}
