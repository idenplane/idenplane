import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminScope } from '../common/decorators/admin-access.decorator.js';
import { UsageService, type InstanceUsage } from './usage.service.js';
import { UsageQueryDto } from './dto/usage-query.dto.js';
import { InstanceUsageDto } from './dto/usage-response.dto.js';

@ApiTags('System')
@Controller('admin/system')
@AdminScope('global')
// The admin API key is rate limited by AdminApiKeyGuard itself.
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  /**
   * GET /admin/system/usage?month=YYYY-MM
   *
   * Monthly active users and user/realm totals for the whole instance, per
   * realm and in total. Server-wide: super-admin or the admin API key.
   */
  @Get('usage')
  @ApiOperation({
    summary: 'Get instance usage: monthly active users, users and realms',
    description:
      'Monthly active users (distinct users who authenticated in the calendar month, UTC), ' +
      'user accounts and realms, for the whole instance and per realm. Defaults to the ' +
      'current month; pass `month=YYYY-MM` for a past one. Counted from a dedicated ' +
      'activity table, not from login events, so event settings and retention do not affect it.',
  })
  @ApiResponse({ status: 200, type: InstanceUsageDto })
  @ApiResponse({
    status: 400,
    description: 'month is not YYYY-MM, or is in the future',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin credentials',
  })
  @ApiResponse({ status: 403, description: 'Not a super-admin' })
  getUsage(@Query() query: UsageQueryDto): Promise<InstanceUsage> {
    return this.usageService.getUsage(query.month);
  }
}
