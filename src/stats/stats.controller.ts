import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { StatsService } from './stats.service.js';
import { ConsentStatisticsService } from '../consent/consent-stats.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('Stats')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly consentStatsService: ConsentStatisticsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics for a realm' })
  @ApiResponse({ status: 200, description: 'Realm dashboard statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getStats(@CurrentRealm() realm: Realm) {
    return this.statsService.getRealmStats(realm);
  }

  @Get('stats/consents')
  @ApiOperation({ summary: 'Get consent statistics for a realm' })
  @ApiResponse({ status: 200, description: 'Realm consent statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getConsentStats(@CurrentRealm() realm: Realm) {
    return this.consentStatsService.getRealmConsentStats(realm);
  }
}
