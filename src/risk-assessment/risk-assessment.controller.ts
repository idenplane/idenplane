import {
  Controller,
  Get,
  Param,
  Query,
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
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('Risk Assessments')
@ApiBearerAuth()
@Controller('admin/realms/:realm/risk-assessments')
export class RiskAssessmentController {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ───────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List recent risk assessments for a realm' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of risk assessments',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({
    name: 'riskLevel',
    required: false,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: ['ALLOW', 'STEP_UP', 'BLOCK'],
  })
  @ApiQuery({ name: 'first', required: false })
  @ApiQuery({ name: 'max', required: false })
  async listAssessments(
    @Param('realm') realmName: string,
    @Query('userId') userId?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('action') action?: string,
    @Query('first', new DefaultValuePipe(0), ParseIntPipe) first = 0,
    @Query('max', new DefaultValuePipe(50), ParseIntPipe) max = 50,
  ) {
    const realm = await this.requireRealm(realmName);

    const where: Record<string, unknown> = { realmId: realm.id };
    if (userId) where['userId'] = userId;
    if (riskLevel) where['riskLevel'] = riskLevel;
    if (action) where['action'] = action;

    const [items, total] = await Promise.all([
      this.prisma.loginRiskAssessment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: first,
        take: Math.min(max, 200),
      }),
      this.prisma.loginRiskAssessment.count({ where }),
    ]);

    return { items, total, first, max };
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Risk score distribution and anomaly trends' })
  @ApiResponse({
    status: 200,
    description: 'Risk dashboard data for the last 30 days',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getDashboard(@Param('realm') realmName: string) {
    const realm = await this.requireRealm(realmName);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

    const [allRecent, blockedSessions, stepUpSessions] = await Promise.all([
      this.prisma.loginRiskAssessment.findMany({
        where: { realmId: realm.id, createdAt: { gte: since } },
        select: {
          riskScore: true,
          riskLevel: true,
          action: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.loginRiskAssessment.count({
        where: {
          realmId: realm.id,
          action: 'BLOCK',
          createdAt: { gte: since },
        },
      }),
      this.prisma.loginRiskAssessment.count({
        where: {
          realmId: realm.id,
          action: 'STEP_UP',
          createdAt: { gte: since },
        },
      }),
    ]);

    // Score distribution buckets
    const distribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const r of allRecent) {
      distribution[r.riskLevel as keyof typeof distribution]++;
    }

    // Daily trend (last 30 days)
    const dailyMap = new Map<
      string,
      { total: number; blocked: number; stepUp: number }
    >();
    for (const r of allRecent) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { total: 0, blocked: 0, stepUp: 0 };
      entry.total++;
      if (r.action === 'BLOCK') entry.blocked++;
      if (r.action === 'STEP_UP') entry.stepUp++;
      dailyMap.set(day, entry);
    }

    const trend = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    const avgRiskScore =
      allRecent.length > 0
        ? Math.round(
            allRecent.reduce((a, r) => a + r.riskScore, 0) / allRecent.length,
          )
        : 0;

    return {
      period: { from: since, to: new Date() },
      total: allRecent.length,
      blocked: blockedSessions,
      stepUp: stepUpSessions,
      avgRiskScore,
      distribution,
      trend,
    };
  }

  // ── Single assessment ──────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single risk assessment with signal breakdown',
  })
  @ApiResponse({ status: 200, description: 'Risk assessment details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getAssessment(
    @Param('realm') realmName: string,
    @Param('id') id: string,
  ) {
    const realm = await this.requireRealm(realmName);

    const assessment = await this.prisma.loginRiskAssessment.findFirst({
      where: { id, realmId: realm.id },
    });

    if (!assessment) {
      throw new NotFoundException(`Risk assessment '${id}' not found`);
    }

    return assessment;
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
