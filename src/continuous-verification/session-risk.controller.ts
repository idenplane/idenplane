import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionRiskEvaluator } from './session-risk-evaluator.js';

@ApiTags('Session Risk')
@ApiBearerAuth()
@Controller('admin/realms/:realm/session-risk')
export class SessionRiskController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionRiskEvaluator: SessionRiskEvaluator,
  ) {}

  // ── List ───────────────────────────────────────────────────────────────────

  @Get()
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

  // ── Dashboard ──────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Session risk distribution and trends' })
  @ApiResponse({ status: 200, description: 'Session risk dashboard data for the last 30 days' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDashboard(@Param('realm') realmName: string) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

    const [allRecentEvents, stepUpRequiredSessions, terminatedSessions, activeProfiles, profilesByLevel] =
      await Promise.all([
        this.prisma.continuousRiskEvent.findMany({
          where: { realmId: realm.id, evaluatedAt: { gte: since } },
          select: { riskScoreAfter: true, riskLevelAfter: true, action: true, trustScoreAfter: true, evaluatedAt: true },
          orderBy: { evaluatedAt: 'asc' },
        }),
        this.prisma.sessionRiskProfile.count({
          where: { realmId: realm.id, stepUpRequired: true },
        }),
        this.prisma.sessionRiskProfile.count({
          where: { realmId: realm.id, terminateSession: true },
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
        ? Math.round(allRecentEvents.reduce((a, r) => a + r.riskScoreAfter, 0) / allRecentEvents.length)
        : 0;

    const avgTrustScore =
      allRecentEvents.length > 0
        ? Math.round(allRecentEvents.reduce((a, r) => a + r.trustScoreAfter, 0) / allRecentEvents.length)
        : 100;

    return {
      period: { from: since, to: new Date() },
      activeSessions: activeProfiles,
      totalEvaluations: allRecentEvents.length,
      stepUpRequired: stepUpRequiredSessions,
      sessionsTerminated: terminatedSessions,
      avgRiskScore,
      avgTrustScore,
      distribution,
      trend,
    };
  }

  // ── Single session profile ─────────────────────────────────────────────────

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get a single session risk profile with event history' })
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
      take: 20,
    });

    return { profile, recentEvents };
  }

  // ── Trigger re-evaluation ──────────────────────────────────────────────────

  @Post(':sessionId/evaluate')
  @ApiOperation({ summary: 'Trigger immediate risk re-evaluation for a session' })
  @ApiResponse({ status: 200, description: 'Risk re-evaluation result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async triggerReevaluation(
    @Param('realm') realmName: string,
    @Param('sessionId') sessionId: string,
  ) {
    const realm = await this.requireRealm(realmName);

    // Verify session exists in this realm
    const profile = await this.prisma.sessionRiskProfile.findFirst({
      where: { sessionId, realmId: realm.id },
    });

    if (!profile) {
      throw new NotFoundException(`Session risk profile for session '${sessionId}' not found`);
    }

    const result = await this.sessionRiskEvaluator.evaluateSessionNow(
      sessionId,
      'Manual re-evaluation triggered via admin API',
    );

    return result;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async requireRealm(realmName: string) {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true, name: true },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmName}' not found`);
    return realm;
  }
}
