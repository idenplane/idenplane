import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { ImpossibleTravelService } from './impossible-travel.service.js';
import {
  RiskSignal,
  RiskLevel,
  RiskAction,
  RealmThresholds,
  evaluateIpReputation,
  evaluateGeoAnomaly,
  evaluateImpossibleTravel,
  evaluateTimeAnomaly,
  evaluateDeviceAnomaly,
  evaluateLoginFrequency,
  evaluateFailedAttempts,
  aggregateSignals,
  scoreToRiskLevel,
  determineAction,
} from './risk-signals.js';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface LoginContext {
  userId: string;
  realmId: string;
  realmName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  timestamp: Date;
}

export interface RiskAssessmentResult {
  riskScore: number;
  riskLevel: RiskLevel;
  signals: RiskSignal[];
  action: RiskAction;
  geoLocation: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RiskAssessmentService {
  private readonly logger = new Logger(RiskAssessmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly travelService: ImpossibleTravelService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  /**
   * Main entry point: computes a full risk assessment for the given login
   * context, persists the result, and returns it.
   */
  async assessRisk(
    context: LoginContext,
    loginEventId?: string,
  ): Promise<RiskAssessmentResult> {
    // Fetch (or lazily create) the user profile
    const profile = await this.getOrCreateProfile(
      context.userId,
      context.realmId,
    );

    // Fetch realm thresholds
    const realm = await this.prisma.realm.findUnique({
      where: { id: context.realmId },
      select: {
        riskThresholdStepUp: true,
        riskThresholdBlock: true,
      },
    });

    const thresholds: RealmThresholds = {
      riskThresholdStepUp: realm?.riskThresholdStepUp ?? 50,
      riskThresholdBlock: realm?.riskThresholdBlock ?? 80,
    };

    // Geo lookup
    let geoLocation: string | null = null;
    let currentCoords: [number, number] | null = null;
    if (context.ipAddress) {
      geoLocation = await this.travelService.lookupLocation(context.ipAddress);
      const coords = await this.travelService.lookupCoords(context.ipAddress);
      if (coords) currentCoords = [coords.lat, coords.lon];
    }

    // Fetch previous login data for impossible-travel
    const lastLogin = await this.getLastSuccessfulLoginCoords(context.userId);

    // Count recent failed attempts
    const recentFailures = await this.countRecentFailures(
      context.userId,
      context.realmId,
    );

    // Count logins in last 24 h
    const recentLoginCount = await this.countRecentLogins(
      context.userId,
      context.realmId,
    );

    // ── Evaluate each signal ─────────────────────────────────────────────────
    const knownIps: string[] = Array.isArray(profile.knownIps)
      ? (profile.knownIps as string[])
      : [];
    const knownDevices: string[] = Array.isArray(profile.knownDevices)
      ? (profile.knownDevices as string[])
      : [];
    const loginTimes: number[] = Array.isArray(profile.loginTimes)
      ? (profile.loginTimes as number[])
      : new Array(24).fill(0);
    const lastLocations: string[] = Array.isArray(profile.lastLocations)
      ? (profile.lastLocations as string[])
      : [];

    const signals: RiskSignal[] = [
      evaluateIpReputation(context.ipAddress, { knownIps }),
      evaluateGeoAnomaly(geoLocation, { lastLocations }),
      evaluateImpossibleTravel(
        lastLogin?.coords ?? null,
        lastLogin?.timestamp ?? null,
        currentCoords,
        context.timestamp,
      ),
      evaluateTimeAnomaly(context.timestamp.getUTCHours(), { loginTimes }),
      evaluateDeviceAnomaly(context.deviceFingerprint, { knownDevices }),
      evaluateLoginFrequency(recentLoginCount, profile.avgLoginFrequency),
      evaluateFailedAttempts(recentFailures),
    ];

    const riskScore = aggregateSignals(signals);
    const riskLevel = scoreToRiskLevel(riskScore);
    const action = determineAction(riskScore, thresholds);

    // Persist assessment
    await this.prisma.loginRiskAssessment.create({
      data: {
        loginEventId: loginEventId ?? null,
        userId: context.userId,
        realmId: context.realmId,
        riskScore,
        riskLevel,
        signals: signals as unknown as Prisma.InputJsonValue,
        action,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        geoLocation,
        deviceFingerprint: context.deviceFingerprint ?? null,
      },
    });

    this.logger.debug(
      `Risk assessment userId=${context.userId} score=${riskScore} level=${riskLevel} action=${action}`,
    );

    return { riskScore, riskLevel, signals, action, geoLocation };
  }

  /**
   * Updates the user's login profile after a successful (allowed/stepped-up)
   * login.  Learns IPs, devices, time patterns, and locations.
   */
  async updateUserProfile(
    userId: string,
    realmId: string,
    context: LoginContext,
    geoLocation: string | null,
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(userId, realmId);

    const knownIps: string[] = Array.isArray(profile.knownIps)
      ? (profile.knownIps as string[])
      : [];
    const knownDevices: string[] = Array.isArray(profile.knownDevices)
      ? (profile.knownDevices as string[])
      : [];
    const loginTimes: number[] = Array.isArray(profile.loginTimes)
      ? (profile.loginTimes as number[])
      : new Array(24).fill(0);
    const lastLocations: string[] = Array.isArray(profile.lastLocations)
      ? (profile.lastLocations as string[])
      : [];

    // Add IP (capped at 20 unique entries)
    if (context.ipAddress && !knownIps.includes(context.ipAddress)) {
      knownIps.push(context.ipAddress);
      if (knownIps.length > 20) knownIps.shift();
    }

    // Add device fingerprint
    if (
      context.deviceFingerprint &&
      !knownDevices.includes(context.deviceFingerprint)
    ) {
      knownDevices.push(context.deviceFingerprint);
      if (knownDevices.length > 20) knownDevices.shift();
    }

    // Increment hour-of-day counter
    const hour = context.timestamp.getUTCHours();
    const updatedTimes =
      loginTimes.length === 24 ? [...loginTimes] : new Array(24).fill(0);
    updatedTimes[hour] = (updatedTimes[hour] ?? 0) + 1;

    // Add geo location (capped at 10)
    if (geoLocation && !lastLocations.includes(geoLocation)) {
      lastLocations.push(geoLocation);
      if (lastLocations.length > 10) lastLocations.shift();
    }

    // Recalculate avg login frequency (simple exponential moving average)
    const newAvg =
      profile.avgLoginFrequency === 0
        ? 1
        : profile.avgLoginFrequency * 0.9 + 0.1;

    await this.prisma.userLoginProfile.update({
      where: { userId },
      data: {
        knownIps: knownIps,
        knownDevices: knownDevices,
        loginTimes: updatedTimes as Prisma.InputJsonValue,
        lastLocations: lastLocations,
        avgLoginFrequency: newAvg,
      },
    });
  }

  /**
   * Sends a "suspicious login blocked" email notification.
   */
  async sendBlockedLoginEmail(
    realmName: string,
    userEmail: string,
    context: LoginContext,
    geoLocation: string | null,
  ): Promise<void> {
    if (!this.emailService) return;

    const time = context.timestamp.toUTCString();
    const location = geoLocation ?? 'Unknown location';
    const ip = context.ipAddress ?? 'Unknown';

    const html = `
      <h2>Suspicious Login Attempt Blocked</h2>
      <p>A login attempt to your account was automatically blocked due to unusual activity.</p>
      <table style="border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Time</td><td>${time}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">IP Address</td><td>${ip}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Location</td><td>${location}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Device</td><td>${context.userAgent ?? 'Unknown'}</td></tr>
      </table>
      <p style="margin-top:16px">
        If this was you, please contact your administrator.<br/>
        If this was not you, your account is protected — no action is required.
      </p>
    `;

    try {
      await this.emailService.sendEmail(
        realmName,
        userEmail,
        'Suspicious Login Attempt Blocked',
        html,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send blocked-login email to ${userEmail}: ${(err as Error).message}`,
      );
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getOrCreateProfile(userId: string, realmId: string) {
    const existing = await this.prisma.userLoginProfile.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    return this.prisma.userLoginProfile.create({
      data: {
        userId,
        realmId,
        knownIps: [],
        knownDevices: [],
        loginTimes: new Array(24).fill(0),
        lastLocations: [],
        avgLoginFrequency: 0,
      },
    });
  }

  private async getLastSuccessfulLoginCoords(
    userId: string,
  ): Promise<{ coords: [number, number]; timestamp: Date } | null> {
    // Find last assessment with a stored geo location where action != BLOCK
    const last = await this.prisma.loginRiskAssessment.findFirst({
      where: { userId, action: { not: 'BLOCK' } },
      orderBy: { createdAt: 'desc' },
      select: { ipAddress: true, createdAt: true },
    });

    if (!last?.ipAddress) return null;

    const coords = await this.travelService.lookupCoords(last.ipAddress);
    if (!coords) return null;

    return { coords: [coords.lat, coords.lon], timestamp: last.createdAt };
  }

  private async countRecentFailures(
    userId: string,
    realmId: string,
  ): Promise<number> {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000); // last 1 hour
    return this.prisma.loginFailure.count({
      where: { userId, realmId, failedAt: { gte: windowStart } },
    });
  }

  private async countRecentLogins(
    userId: string,
    realmId: string,
  ): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 h
    return this.prisma.loginRiskAssessment.count({
      where: { userId, realmId, createdAt: { gte: windowStart } },
    });
  }
}
