import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';

/** Request shape after AdminApiKeyGuard has attached the principal. */
type AdminRequest = Request & {
  adminUser?: { userId: string; roles: string[] };
};
import {
  UpgradeService,
  UpgradeResult,
  UpgradeState,
} from './upgrade.service.js';
import {
  RollbackService,
  RollbackCapability,
  RollbackResult,
  UpgradeAuditEntry,
} from './rollback.service.js';
import {
  PreUpgradeValidatorService,
  PreUpgradeValidationResult,
} from './pre-upgrade-validator.service.js';
import {
  ConfigCompatibilityService,
  ConfigCompatibilityResult,
} from './config-compatibility.service.js';
import {
  UpgradeHealthService,
  UpgradeHealthResult,
} from './upgrade-health.service.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';
import { UpgradeEnabledGuard } from './guards/upgrade-enabled.guard.js';

class UpgradeRequestDto {
  @ApiProperty({ description: 'Target version, e.g. "0.4.0"' })
  @IsString()
  toVersion!: string;

  @ApiPropertyOptional({
    description:
      'Simulate only: skips the backup and the migration. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Proceed even if pre-validation fails. This skips the checks that ' +
      'verify a backup can be taken at all, so an upgrade run with force may ' +
      'be unrecoverable. Requires confirm.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description:
      'Free-text note recorded alongside the upgrade. The acting identity is ' +
      'taken from the authenticated principal, not from this field.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({
    description:
      'Must equal toVersion. Guards against a mis-click or a replayed request ' +
      'starting a migration against a live database. Not required for dryRun.',
  })
  @IsOptional()
  @IsString()
  confirm?: string;
}

class RollbackRequestDto {
  @ApiPropertyOptional({
    description: 'Upgrade to roll back. Defaults to the most recent one.',
  })
  @IsOptional()
  @IsString()
  upgradeId?: string;

  @ApiProperty({
    description:
      'Must be the literal string "ROLLBACK". This restores a database dump ' +
      'over the live database; every write since the backup is lost.',
  })
  @IsString()
  confirm!: string;
}

@ApiTags('Upgrade')
@ApiSecurity('admin-api-key')
@UseGuards(AdminApiKeyGuard, AdminRolesGuard)
@Controller('admin/upgrade')
export class UpgradeController {
  private readonly logger = new Logger(UpgradeController.name);

  constructor(
    private readonly upgradeService: UpgradeService,
    private readonly rollbackService: RollbackService,
    private readonly preUpgradeValidator: PreUpgradeValidatorService,
    private readonly configCompatibility: ConfigCompatibilityService,
    private readonly upgradeHealthService: UpgradeHealthService,
  ) {}

  /**
   * POST /admin/upgrade
   *
   * Initiate a new upgrade to the target version. The upgrade will run
   * through all stages: pre-validation, backup, config check, database
   * migration, and post-upgrade health checks.
   */
  @Post()
  @UseGuards(UpgradeEnabledGuard)
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Start an upgrade to a target version' })
  @ApiResponse({
    status: 200,
    description: 'Upgrade result with stage outcomes',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid target version',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires super-admin role',
  })
  @ApiResponse({ status: 409, description: 'Upgrade already in progress' })
  @ApiResponse({
    status: 503,
    description: 'Upgrade execution disabled — set UPGRADE_API_ENABLED=true',
  })
  async startUpgrade(
    @Body() dto: UpgradeRequestDto,
    @Req() req: AdminRequest,
  ): Promise<UpgradeResult> {
    const dryRun = dto.dryRun ?? false;

    // A dry run writes nothing, so requiring a confirmation there would only
    // train operators to type past the prompt that matters.
    if (!dryRun && dto.confirm !== dto.toVersion) {
      throw new BadRequestException(
        'confirm must equal toVersion to start a real upgrade. This endpoint ' +
          'runs database migrations against the live database.',
      );
    }

    // force skips pre-validation — including the checks added in #1198 that
    // verify pg_dump exists and BACKUP_DIR is writable. An upgrade forced past
    // those may have no usable backup, so it is logged at error level.
    if (dto.force) {
      this.logger.error(
        `Upgrade to ${dto.toVersion} started with force=true by ` +
          `${req.adminUser?.userId ?? 'unknown'} — pre-validation, including ` +
          'the backup-tooling checks, will be skipped.',
      );
    }

    return this.upgradeService.upgrade(dto.toVersion, {
      dryRun,
      force: dto.force ?? false,
      // Taken from the authenticated principal, never from the body: an audit
      // trail a caller can write for itself is not an audit trail.
      initiatedBy: req.adminUser?.userId ?? 'API',
      note: dto.note,
      ipAddress: resolveClientIp(req),
    });
  }

  /**
   * GET /admin/upgrade/status
   *
   * Returns the status of the most recent upgrade operation.
   */
  @Get('status')
  @ApiOperation({ summary: 'Get the most recent upgrade status' })
  @ApiResponse({ status: 200, description: 'Most recent upgrade audit entry' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'No upgrade records found' })
  async getUpgradeStatus(): Promise<UpgradeAuditEntry | null> {
    return this.rollbackService.getLatestUpgradeStatus();
  }

  /**
   * GET /admin/upgrade/history
   *
   * Returns the upgrade history for audit purposes.
   */
  @Get('history')
  @ApiOperation({ summary: 'Get upgrade history' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of entries to return (1-100, default 10)',
    type: Number,
  })
  @ApiResponse({ status: 200, description: 'Array of upgrade audit entries' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async getUpgradeHistory(
    @Query('limit') limit?: string,
  ): Promise<UpgradeAuditEntry[]> {
    return this.rollbackService.getUpgradeHistory(
      UpgradeController.parseLimit(limit, 10),
    );
  }

  /**
   * GET /admin/upgrade/audit
   *
   * Returns audit entries formatted for CLI consumption.
   * This is an alias for history that transforms entries into a format
   * suitable for the upgrade:status command.
   */
  @Get('audit')
  @ApiOperation({ summary: 'Get upgrade audit entries for CLI' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of entries to return',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Audit entries response with total count',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async getUpgradeAudit(@Query('limit') limit?: string): Promise<{
    entries: UpgradeAuditEntry[];
    total: number;
  }> {
    const entries = await this.rollbackService.getUpgradeHistory(
      UpgradeController.parseLimit(limit, 20),
    );
    return { entries, total: entries.length };
  }

  /**
   * Clamp a caller-supplied ?limit into 1..100, falling back to `fallback`
   * when absent or unparseable. `parseInt('abc')` is NaN, and NaN survives
   * Math.min/Math.max — so the isNaN check is load-bearing, not defensive.
   */
  private static parseLimit(limit: string | undefined, fallback: number) {
    if (limit === undefined) return fallback;
    const parsed = parseInt(limit, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), 100);
  }

  /**
   * GET /admin/upgrade/rollback/capability
   *
   * Returns whether a rollback is possible and information about the last
   * successful upgrade that can be rolled back.
   */
  @Get('rollback/capability')
  @ApiOperation({ summary: 'Check if rollback is possible' })
  @ApiResponse({ status: 200, description: 'Rollback capability status' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async checkRollbackCapability(): Promise<RollbackCapability> {
    return this.rollbackService.checkRollbackCapability();
  }

  /**
   * POST /admin/upgrade/rollback
   *
   * Execute a rollback to the previous version. If no upgradeId is provided,
   * rolls back the most recent successful upgrade.
   */
  @Post('rollback')
  @UseGuards(UpgradeEnabledGuard)
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Execute rollback to previous version' })
  @ApiResponse({ status: 200, description: 'Rollback result with outcome' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires super-admin role',
  })
  @ApiResponse({
    status: 503,
    description: 'Upgrade execution disabled — set UPGRADE_API_ENABLED=true',
  })
  @ApiResponse({ status: 404, description: 'No upgrade found to roll back' })
  @ApiResponse({
    status: 409,
    description: 'Rollback not possible — no valid backup',
  })
  async executeRollback(
    @Body() dto: RollbackRequestDto,
    @Req() req: AdminRequest,
  ): Promise<RollbackResult> {
    if (dto.confirm !== 'ROLLBACK') {
      throw new BadRequestException(
        'confirm must be the literal string "ROLLBACK". This restores a ' +
          'database dump over the live database and discards every write made ' +
          'since that backup was taken.',
      );
    }

    this.logger.warn(
      `Rollback requested by ${req.adminUser?.userId ?? 'unknown'} from ` +
        `${resolveClientIp(req)}${dto.upgradeId ? ` for ${dto.upgradeId}` : ''}`,
    );

    return this.rollbackService.executeRollback(dto.upgradeId);
  }

  /**
   * GET /admin/upgrade/pre-validation
   *
   * Run pre-upgrade validation checks to verify the system is ready for
   * an upgrade. This does not perform the upgrade itself.
   */
  @Get('pre-validation')
  @ApiOperation({ summary: 'Run pre-upgrade validation checks' })
  @ApiResponse({
    status: 200,
    description: 'Validation result with pass/warn/fail status for each check',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async runPreValidation(): Promise<PreUpgradeValidationResult> {
    return this.preUpgradeValidator.validate();
  }

  /**
   * GET /admin/upgrade/health
   *
   * Run post-upgrade health checks to verify the system is healthy after
   * an upgrade. Returns the status of all health checks.
   */
  @Get('health')
  @ApiOperation({ summary: 'Run post-upgrade health checks' })
  @ApiResponse({
    status: 200,
    description:
      'Health check result with pass/warn/fail status for each check',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async runHealthCheck(): Promise<UpgradeHealthResult> {
    return this.upgradeHealthService.checkHealth();
  }

  /**
   * GET /admin/upgrade/config-compatibility
   *
   * Check configuration compatibility for a target version. This validates
   * environment variables, deprecated features, and database configuration
   * to ensure a safe upgrade path.
   */
  @Get('config-compatibility')
  @ApiOperation({ summary: 'Check configuration compatibility for a version' })
  @ApiQuery({
    name: 'version',
    required: false,
    description:
      'Target version to check compatibility for (defaults to current)',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuration compatibility result with issues',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async checkConfigCompatibility(
    @Query('version') version?: string,
  ): Promise<ConfigCompatibilityResult> {
    const targetVersion = version ?? this.upgradeService.getCurrentVersion();
    return this.configCompatibility.checkCompatibility(targetVersion);
  }

  /**
   * GET /admin/upgrade/:upgradeId
   *
   * Returns the current state of a specific upgrade operation.
   *
   * NOTE: this dynamic ':upgradeId' route MUST be declared AFTER all static
   * single-segment GET routes (pre-validation, health, config-compatibility),
   * otherwise it shadows them — Express matches routes in declaration order,
   * so a bare ':upgradeId' placed earlier captures '/pre-validation' etc.
   */
  @Get(':upgradeId')
  @ApiParam({
    name: 'upgradeId',
    description: 'The unique identifier of the upgrade',
  })
  @ApiOperation({ summary: 'Get upgrade state by ID' })
  @ApiResponse({ status: 200, description: 'Upgrade state with current stage' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Upgrade not found' })
  async getUpgradeState(
    @Param('upgradeId') upgradeId: string,
  ): Promise<UpgradeState | null> {
    return this.upgradeService.getUpgradeState(upgradeId);
  }
}
