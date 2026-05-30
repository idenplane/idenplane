import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  NotFoundException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContinuousRiskAssessmentService } from './continuous-risk.service.js';
import { DevicePostureService } from './device-posture.service.js';
import { NetworkContextService } from './network-context.service.js';
import { BehavioralBiometricsService } from './behavioral-biometrics.service.js';

@ApiTags('Continuous Verification')
@ApiBearerAuth()
@Controller('admin/realms/:realmName/continuous-verification')
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
  @ApiResponse({
    status: 200,
    description: 'Paginated list of continuous risk events',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'sessionId', required: false })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: ['NO_ACTION', 'NOTIFY', 'STEP_UP_REQUIRED', 'TERMINATE_SESSION'],
  })
  @ApiQuery({
    name: 'riskLevel',
    required: false,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  })
  @ApiQuery({ name: 'first', required: false })
  @ApiQuery({ name: 'max', required: false })
  async listRiskEvents(
    @Param('realmName') realmName: string,
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
  @ApiOperation({
    summary: 'Continuous risk distribution and trends across active sessions',
  })
  @ApiResponse({ status: 200, description: 'Continuous risk dashboard data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDashboard(@Param('realmName') realmName: string) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

    const [
      allRecentEvents,
      stepUpEvents,
      terminateEvents,
      activeProfiles,
      profilesByLevel,
    ] = await Promise.all([
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
    const dailyMap = new Map<
      string,
      { total: number; stepUp: number; terminate: number }
    >();
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
  @ApiOperation({
    summary: 'Get a single continuous risk event with signal breakdown',
  })
  @ApiResponse({ status: 200, description: 'Risk event details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRiskEvent(
    @Param('realmName') realmName: string,
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
  @ApiResponse({
    status: 200,
    description: 'Paginated list of session risk profiles',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({
    name: 'riskLevel',
    required: false,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  })
  @ApiQuery({ name: 'stepUpRequired', required: false })
  @ApiQuery({ name: 'first', required: false })
  @ApiQuery({ name: 'max', required: false })
  async listSessionProfiles(
    @Param('realmName') realmName: string,
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
  @ApiOperation({
    summary: 'Get session risk profile with full signal details',
  })
  @ApiResponse({ status: 200, description: 'Session risk profile details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getSessionProfile(
    @Param('realmName') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const profile = await this.prisma.sessionRiskProfile.findFirst({
      where: { sessionId, realmId: realm.id },
    });

    if (!profile) {
      throw new NotFoundException(
        `Session risk profile for session '${sessionId}' not found`,
      );
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
  @ApiResponse({
    status: 200,
    description: 'Device posture history for session',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDevicePosture(
    @Param('realmName') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const postureRecords = await this.prisma.devicePostureRecord.findMany({
      where: { sessionId, realmId: realm.id },
      orderBy: { reportedAt: 'desc' },
      take: 50,
    });

    if (postureRecords.length === 0) {
      throw new NotFoundException(
        `No device posture records for session '${sessionId}'`,
      );
    }

    return postureRecords;
  }

  // ── Network Context ────────────────────────────────────────────────────────

  @Get('network-context/:sessionId')
  @ApiOperation({ summary: 'Get network context records for a session' })
  @ApiResponse({
    status: 200,
    description: 'Network context history for session',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getNetworkContext(
    @Param('realmName') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const networkRecords = await this.prisma.networkContextRecord.findMany({
      where: { sessionId, realmId: realm.id },
      orderBy: { capturedAt: 'desc' },
      take: 50,
    });

    if (networkRecords.length === 0) {
      throw new NotFoundException(
        `No network context records for session '${sessionId}'`,
      );
    }

    return networkRecords;
  }

  // ── Behavioral Biometrics ──────────────────────────────────────────────────

  @Get('behavioral/:userId')
  @ApiOperation({
    summary: 'Get behavioral biometrics profile and recent samples for a user',
  })
  @ApiResponse({
    status: 200,
    description: 'Behavioral biometrics data for user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getBehavioralBiometrics(
    @Param('realmName') realmName: string,
    @Param('userId') userId: string,
  ) {
    const _realm = await this.requireRealm(realmName);

    const profile = await this.prisma.behavioralBiometricProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(
        `Behavioral biometrics profile for user '${userId}' not found`,
      );
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
  @ApiResponse({
    status: 200,
    description: 'User continuous verification summary',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getUserRiskSummary(
    @Param('realmName') realmName: string,
    @Param('userId') userId: string,
  ) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [sessionProfiles, behavioralProfile, recentEvents, biometricSamples] =
      await Promise.all([
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
            recentEvents.reduce((a, r) => a + r.riskScoreAfter, 0) /
              recentEvents.length,
          )
        : 0;

    const highRiskSessions = sessionProfiles.filter(
      (p) => p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL',
    ).length;

    const activeStepUps = sessionProfiles.filter(
      (p) => p.stepUpRequired,
    ).length;

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

  // ── SDK Client Endpoints ──────────────────────────────────────────────────────

  /**
   * Record device posture data from SDK/client.
   * This endpoint is called by the client SDK to report device security status.
   */
  @Post('device-posture')
  @ApiOperation({ summary: 'Record device posture from SDK client' })
  @ApiResponse({ status: 201, description: 'Device posture recorded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        realmId: { type: 'string' },
        userId: { type: 'string' },
        deviceFingerprint: { type: 'string' },
        osType: { type: 'string', nullable: true },
        osVersion: { type: 'string', nullable: true },
        osBuild: { type: 'string', nullable: true },
        securityPatchLevel: { type: 'string', nullable: true },
        lastUpdateDate: { type: 'string', nullable: true },
        diskEncrypted: { type: 'boolean', nullable: true },
        encryptionType: { type: 'string', nullable: true },
        antivirusEnabled: { type: 'boolean', nullable: true },
        antivirusName: { type: 'string', nullable: true },
        firewallEnabled: { type: 'boolean', nullable: true },
        screenLockEnabled: { type: 'boolean' },
        lockTimeoutSeconds: { type: 'number', nullable: true },
        managedDevice: { type: 'boolean' },
        mdmEnrollmentId: { type: 'string', nullable: true },
        jailbroken: { type: 'boolean' },
        deviceTrustTier: { type: 'string' },
        complianceStatus: { type: 'string', nullable: true },
        complianceDetails: { type: 'object', nullable: true },
      },
    },
  })
  async recordDevicePosture(
    @Param('realmName') realmName: string,
    @Body()
    body: {
      sessionId: string;
      realmId: string;
      userId: string;
      deviceFingerprint: string;
      osType?: string | null;
      osVersion?: string | null;
      osBuild?: string | null;
      securityPatchLevel?: string | null;
      lastUpdateDate?: string | null;
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
  ) {
    const realm = await this.requireRealm(realmName);

    await this.riskAssessment.recordDevicePosture(
      body.sessionId,
      realm.id,
      body.userId,
      body.deviceFingerprint,
      {
        osType: body.osType,
        osVersion: body.osVersion,
        osBuild: body.osBuild,
        securityPatchLevel: body.securityPatchLevel ?? null,
        lastUpdateDate: body.lastUpdateDate
          ? new Date(body.lastUpdateDate)
          : null,
        diskEncrypted: body.diskEncrypted,
        encryptionType: body.encryptionType,
        antivirusEnabled: body.antivirusEnabled,
        antivirusName: body.antivirusName,
        firewallEnabled: body.firewallEnabled,
        screenLockEnabled: body.screenLockEnabled,
        lockTimeoutSeconds: body.lockTimeoutSeconds,
        managedDevice: body.managedDevice,
        mdmEnrollmentId: body.mdmEnrollmentId,
        jailbroken: body.jailbroken,
        deviceTrustTier: body.deviceTrustTier,
        complianceStatus: body.complianceStatus,
        complianceDetails: body.complianceDetails,
      },
    );

    return {
      success: true,
      recordedAt: new Date().toISOString(),
    };
  }

  /**
   * Record behavioral biometric samples from SDK/client.
   */
  @Post('behavioral/samples')
  @ApiOperation({
    summary: 'Record behavioral biometric samples from SDK client',
  })
  @ApiResponse({ status: 201, description: 'Samples recorded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        samples: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              interactionType: {
                type: 'string',
                enum: ['typing', 'pointer', 'scroll', 'keystroke'],
              },
              burstLength: { type: 'number', nullable: true },
              latency: { type: 'number', nullable: true },
              velocity: { type: 'number', nullable: true },
              variance: { type: 'number', nullable: true },
              scrollVelocity: { type: 'number', nullable: true },
              eventCount: { type: 'number', nullable: true },
              hasErrors: { type: 'boolean' },
              collectedAt: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async recordBehavioralSamples(
    @Param('realmName') realmName: string,
    @Body()
    body: {
      sessionId: string;
      samples: Array<{
        interactionType: string;
        burstLength?: number | null;
        latency?: number | null;
        velocity?: number | null;
        variance?: number | null;
        scrollVelocity?: number | null;
        eventCount?: number | null;
        hasErrors?: boolean;
        collectedAt?: string;
      }>;
    },
  ) {
    const realm = await this.requireRealm(realmName);

    // Get session info to find userId
    const session = await this.prisma.session.findUnique({
      where: { id: body.sessionId },
      select: { userId: true },
    });

    const userId = session?.userId ?? 'unknown';

    // Record each sample
    for (const sample of body.samples) {
      await this.behavioralBiometrics.recordSample({
        sessionId: body.sessionId,
        userId,
        realmId: realm.id,
        interactionType: sample.interactionType as
          | 'typing'
          | 'pointer'
          | 'scroll'
          | 'keystroke',
        timestamp: sample.collectedAt
          ? new Date(sample.collectedAt)
          : new Date(),
        duration: sample.latency ?? undefined,
        burstLength: sample.burstLength ?? undefined,
        velocity: sample.velocity ?? undefined,
        acceleration: sample.variance ?? undefined,
        errorCount: sample.hasErrors ? 1 : undefined,
      });
    }

    return {
      success: true,
      recordedCount: body.samples.length,
      recordedAt: new Date().toISOString(),
    };
  }

  /**
   * Record network context from SDK/client.
   */
  @Post('network-context')
  @ApiOperation({ summary: 'Record network context from SDK client' })
  @ApiResponse({ status: 201, description: 'Network context recorded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        ipAddress: { type: 'string', nullable: true },
        isp: { type: 'string', nullable: true },
        asn: { type: 'string', nullable: true },
        vpnDetected: { type: 'boolean' },
        proxyDetected: { type: 'boolean' },
        torExitNode: { type: 'boolean' },
        datacenter: { type: 'boolean' },
        country: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        latitude: { type: 'number', nullable: true },
        longitude: { type: 'number', nullable: true },
      },
    },
  })
  async recordNetworkContext(
    @Param('realmName') realmName: string,
    @Body()
    body: {
      sessionId: string;
      ipAddress?: string | null;
      isp?: string | null;
      asn?: string | null;
      vpnDetected?: boolean;
      proxyDetected?: boolean;
      torExitNode?: boolean;
      datacenter?: boolean;
      country?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ) {
    const realm = await this.requireRealm(realmName);

    // Get session info
    const session = await this.prisma.session.findUnique({
      where: { id: body.sessionId },
      select: { userId: true },
    });

    // Record via network context service
    if (body.ipAddress && session?.userId) {
      await this.networkContext.captureNetworkContext(
        body.sessionId,
        realm.id,
        session.userId,
        body.ipAddress,
      );
    }

    return {
      success: true,
      recordedAt: new Date().toISOString(),
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
