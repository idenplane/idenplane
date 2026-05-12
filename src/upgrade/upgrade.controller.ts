import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
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

class UpgradeRequestDto {
  @IsString()
  toVersion!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsString()
  initiatedBy?: string;
}

class RollbackRequestDto {
  @IsOptional()
  @IsString()
  upgradeId?: string;
}

@ApiTags('Upgrade')
@ApiSecurity('admin-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/upgrade')
export class UpgradeController {
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
  @ApiResponse({ status: 409, description: 'Upgrade already in progress' })
  async startUpgrade(@Body() dto: UpgradeRequestDto): Promise<UpgradeResult> {
    return this.upgradeService.upgrade(dto.toVersion, {
      dryRun: dto.dryRun ?? false,
      force: dto.force ?? false,
      initiatedBy: dto.initiatedBy ?? 'API',
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
  @ApiResponse({ status: 200, description: 'Array of upgrade audit entries' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async getUpgradeHistory(): Promise<UpgradeAuditEntry[]> {
    return this.rollbackService.getUpgradeHistory();
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
      limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 20,
    );
    return { entries, total: entries.length };
  }

  /**
   * GET /admin/upgrade/:upgradeId
   *
   * Returns the current state of a specific upgrade operation.
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
  @ApiOperation({ summary: 'Execute rollback to previous version' })
  @ApiResponse({ status: 200, description: 'Rollback result with outcome' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'No upgrade found to roll back' })
  @ApiResponse({
    status: 409,
    description: 'Rollback not possible — no valid backup',
  })
  async executeRollback(
    @Body() dto: RollbackRequestDto,
  ): Promise<RollbackResult> {
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
    const targetVersion =
      version ?? (await this.upgradeService.getCurrentVersion());
    return this.configCompatibility.checkCompatibility(targetVersion);
  }
}
