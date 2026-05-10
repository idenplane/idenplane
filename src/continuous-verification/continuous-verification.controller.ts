import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';
import { DevicePostureService } from './device-posture.service.js';
import { NetworkContextService } from './network-context.service.js';
import { BehavioralBiometricsService } from './behavioral-biometrics.service.js';

@ApiTags('Continuous Verification')
@ApiBearerAuth()
@Controller('admin/realms/:realm/continuous-verification')
export class ContinuousVerificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAssessment: ContinuousRiskAssessmentService,
    private readonly devicePosture: DevicePostureService,
    private readonly networkContext: NetworkContextService,
    private readonly behavioralBiometrics: BehavioralBiometricsService,
  ) {}

  // ── Risk Events ───────────────────────────────────────────────────────────

  @Get('events')
  @ApiOperation({ summary: 'List recent continuous risk events for a realm' })
  @ApiResponse({ status: 200, description: 'Paginated list of continuous risk events' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'sessionId', required: false })
  @ApiQuery({ name: 'action', required: false, enum: ['NO_ACTION', 'NOTIFY', 'STEP_UP_REQUIRED', 'TERMINATE_SESSION'] })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @ApiQuery({ name: 'first', required: false })
  @ApiQuery({ name: 'max', required: false })
  async listRiskEvents(
    @Param('realm') realmName: string,
    @Query('userId') userId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('action') action?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('first', new DefaultValuePipe(0), ParseIntPipe) first = 0,
    @Query('max', new DefaultValuePipe(50), ParseIntPipe) max = 50,
  ) {
    const realm = await this.requireRealm(realmName);

    const where: Record<string, unknown> = { realmId: realm.id };
    if (userId) where['userId'] = userId;
    if (sessionId) where['sessionId'] = sessionId;
    if (action) where['action'] = action;
    if (riskLevel) where['riskLevelAfter'] = riskLevel;

    const [items, total] = await Promise.all([
      this.prisma.continuousRiskEvent.findMany({
        where,
        orderBy: { evaluatedAt: 'desc' },
        skip: first,
        take: Math.min(max, 200),
      }),
      this.prisma.continuousRiskEvent.count({ where }),
    ]);

    return { items, total, first, max };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Continuous risk distribution and trends across active sessions' })
  @ApiResponse({ status: 200, description: 'Continuous risk dashboard data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDashboard(@Param('realm') realmName: string) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

    const [allRecentEvents, stepUpEvents, terminateEvents, activeProfiles, profilesByLevel] =
      await Promise.all([
        this.prisma.continuousRiskEvent.findMany({
          where: { realmId: realm.id, evaluatedAt: { gte: since } },
          select: {
            riskScoreAfter: true,
            riskLevelAfter: true,
            action: true,
            trustScoreAfter: true,
            evaluatedAt: true,
          },
          orderBy: { evaluatedAt: 'asc' },
        }),
        this.prisma.continuousRiskEvent.count({
          where: {
            realmId: realm.id,
            action: 'STEP_UP_REQUIRED',
            evaluatedAt: { gte: since },
          },
        }),
        this.prisma.continuousRiskEvent.count({
          where: {
            realmId: realm.id,
            action: 'TERMINATE_SESSION',
            evaluatedAt: { gte: since },
          },
        }),
        this.prisma.sessionRiskProfile.count({
          where: { realmId: realm.id },
        }),
        this.prisma.sessionRiskProfile.groupBy({
          by: ['riskLevel'],
          where: { realmId: realm.id },
          _count: { id: true },
        }),
      ]);

    // Score distribution buckets
    const distribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const profile of profilesByLevel) {
      const level = profile.riskLevel as keyof typeof distribution;
      if (level in distribution) {
        distribution[level] = profile._count.id;
      }
    }

    // Daily trend (last 30 days)
    const dailyMap = new Map<string, { total: number; stepUp: number; terminate: number }>();
    for (const e of allRecentEvents) {
      const day = e.evaluatedAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { total: 0, stepUp: 0, terminate: 0 };
      entry.total++;
      if (e.action === 'STEP_UP_REQUIRED') entry.stepUp++;
      if (e.action === 'TERMINATE_SESSION') entry.terminate++;
      dailyMap.set(day, entry);
    }

    const trend = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    const avgRiskScore =
      allRecentEvents.length > 0
        ? Math.round(
            allRecentEvents.reduce((a, r) => a + r.riskScoreAfter, 0) /
              allRecentEvents.length,
          )
        : 0;

    const avgTrustScore =
      allRecentEvents.length > 0
        ? Math.round(
            allRecentEvents.reduce((a, r) => a + r.trustScoreAfter, 0) /
              allRecentEvents.length,
          )
        : 100;

    return {
      period: { from: since, to: new Date() },
      activeSessions: activeProfiles,
      totalEvaluations: allRecentEvents.length,
      stepUpTriggered: stepUpEvents,
      sessionsTerminated: terminateEvents,
      avgRiskScore,
      avgTrustScore,
      distribution,
      trend,
    };
  }

  // ── Single Risk Event ─────────────────────────────────────────────────────

  @Get('events/:id')
  @ApiOperation({ summary: 'Get a single continuous risk event with signal breakdown' })
  @ApiResponse({ status: 200, description: 'Risk event details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRiskEvent(
    @Param('realm') realmName: string,
    @Param('id') id: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const event = await this.prisma.continuousRiskEvent.findFirst({
      where: { id, realmId: realm.id },
    });

    if (!event) {
      throw new NotFoundException(`Continuous risk event '${id}' not found`);
    }

    return event;
  }

  // ── Session Risk Profiles ─────────────────────────────────────────────────

  @Get('session-profiles')
  @ApiOperation({ summary: 'List session risk profiles for a realm' })
  @ApiResponse({ status: 200, description: 'Paginated list of session risk profiles' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @ApiQuery({ name: 'stepUpRequired', required: false })
  @ApiQuery({ name: 'first', required: false })
  @ApiQuery({ name: 'max', required: false })
  async listSessionProfiles(
    @Param('realm') realmName: string,
    @Query('userId') userId?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('stepUpRequired') stepUpRequired?: string,
    @Query('first', new DefaultValuePipe(0), ParseIntPipe) first = 0,
    @Query('max', new DefaultValuePipe(50), ParseIntPipe) max = 50,
  ) {
    const realm = await this.requireRealm(realmName);

    const where: Record<string, unknown> = { realmId: realm.id };
    if (userId) where['userId'] = userId;
    if (riskLevel) where['riskLevel'] = riskLevel;
    if (stepUpRequired !== undefined) {
      where['stepUpRequired'] = stepUpRequired === 'true';
    }

    const [items, total] = await Promise.all([
      this.prisma.sessionRiskProfile.findMany({
        where,
        orderBy: { riskScore: 'desc' },
        skip: first,
        take: Math.min(max, 200),
      }),
      this.prisma.sessionRiskProfile.count({ where }),
    ]);

    return { items, total, first, max };
  }

  @Get('session-profiles/:sessionId')
  @ApiOperation({ summary: 'Get session risk profile with full signal details' })
  @ApiResponse({ status: 200, description: 'Session risk profile details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getSessionProfile(
    @Param('realm') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const profile = await this.prisma.sessionRiskProfile.findFirst({
      where: { sessionId, realmId: realm.id },
    });

    if (!profile) {
      throw new NotFoundException(`Session risk profile for session '${sessionId}' not found`);
    }

    // Fetch recent events for this session
    const recentEvents = await this.prisma.continuousRiskEvent.findMany({
      where: { sessionId },
      orderBy: { evaluatedAt: 'desc' },
      take: 10,
    });

    return { profile, recentEvents };
  }

  // ── Device Posture ────────────────────────────────────────────────────────

  @Get('device-posture/:sessionId')
  @ApiOperation({ summary: 'Get device posture records for a session' })
  @ApiResponse({ status: 200, description: 'Device posture history for session' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDevicePosture(
    @Param('realm') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const postureRecords = await this.prisma.devicePostureRecord.findMany({
      where: { sessionId, realmId: realm.id },
      orderBy: { reportedAt: 'desc' },
      take: 50,
    });

    if (postureRecords.length === 0) {
      throw new NotFoundException(`No device posture records for session '${sessionId}'`);
    }

    return postureRecords;
  }

  // ── Network Context ────────────────────────────────────────────────────────

  @Get('network-context/:sessionId')
  @ApiOperation({ summary: 'Get network context records for a session' })
  @ApiResponse({ status: 200, description: 'Network context history for session' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getNetworkContext(
    @Param('realm') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const networkRecords = await this.prisma.networkContextRecord.findMany({
      where: { sessionId, realmId: realm.id },
      orderBy: { capturedAt: 'desc' },
      take: 50,
    });

    if (networkRecords.length === 0) {
      throw new NotFoundException(`No network context records for session '${sessionId}'`);
    }

    return networkRecords;
  }

  // ── Behavioral Biometrics ──────────────────────────────────────────────────

  @Get('behavioral/:userId')
  @ApiOperation({ summary: 'Get behavioral biometrics profile and recent samples for a user' })
  @ApiResponse({ status: 200, description: 'Behavioral biometrics data for user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getBehavioralBiometrics(
    @Param('realm') realmName: string,
    @Param('userId') userId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const profile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(`Behavioral biometrics profile for user '${userId}' not found`);
    }

    const recentSamples = await this.prisma.behavioralSample.findMany({
      where: { userId },
      orderBy: { collectedAt: 'desc' },
      take: 50,
    });

    return { profile, recentSamples };
  }

  // ── User Risk Summary ─────────────────────────────────────────────────────

  @Get('user/:userId/summary')
  @ApiOperation({ summary: 'Get continuous verification summary for a user' })
  @ApiResponse({ status: 200, description: 'User continuous verification summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getUserRiskSummary(
    @Param('realm') realmName: string,
    @Param('userId') userId: string,
  ) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [sessionProfiles, behavioralProfile, recentEvents, biometricSamples] = await Promise.all([
      this.prisma.sessionRiskProfile.findMany({
        where: { realmId: realm.id, userId },
      }),
      this.prisma.behavioralBiometricProfile.findUnique({
        where: { userId },
      }),
      this.prisma.continuousRiskEvent.findMany({
        where: { realmId: realm.id, userId, evaluatedAt: { gte: since } },
        select: {
          riskScoreAfter: true,
          riskLevelAfter: true,
          action: true,
          trustScoreAfter: true,
          evaluatedAt: true,
        },
        orderBy: { evaluatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.behavioralSample.findMany({
        where: { userId },
        orderBy: { collectedAt: 'desc' },
        take: 10,
      }),
    ]);

    const avgRiskScore =
      recentEvents.length > 0
        ? Math.round(
            recentEvents.reduce((a, r) => a + r.riskScoreAfter, 0) / recentEvents.length,
          )
        : 0;

    const highRiskSessions = sessionProfiles.filter(
      (p) => p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL',
    ).length;

    const activeStepUps = sessionProfiles.filter((p) => p.stepUpRequired).length;

    return {
      userId,
      activeSessions: sessionProfiles.length,
      highRiskSessions,
      activeStepUps,
      avgRiskScore,
      recentEventsCount: recentEvents.length,
      behavioralProfile: behavioralProfile
        ? {
            sampleCount: behavioralProfile.sampleCount,
            modelConfidence: behavioralProfile.modelConfidence,
            anomalyThreshold: behavioralProfile.anomalyThreshold,
          }
        : null,
      recentSamplesCount: biometricSamples.length,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async requireRealm(realmName: string) {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true, name: true },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmName}' not found`);
    return realm;
  }
}