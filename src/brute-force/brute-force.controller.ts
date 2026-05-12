import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { BruteForceService } from './brute-force.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Brute Force Protection')
@Controller('admin/realms/:realmName/brute-force')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class BruteForceController {
  constructor(private readonly bruteForceService: BruteForceService) {}

  @Get('locked-users')
  @ApiOperation({ summary: 'List locked users in a realm' })
  @ApiResponse({ status: 200, description: 'List of locked users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getLockedUsers(@CurrentRealm() realm: Realm) {
    return this.bruteForceService.getLockedUsers(realm.id);
  }

  /**
   * POST /admin/realms/:realmName/brute-force/users/:userId/unlock
   *
   * Unlock a user that has been locked out by brute-force protection.
   */
  @Post('users/:userId/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a locked user' })
  @ApiResponse({ status: 200, description: 'User unlocked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async unlockUser(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    await this.bruteForceService.unlockUser(realm.id, userId);
    return { message: 'User unlocked' };
  }
}

/**
 * Keycloak-compatible alias controller (issue #504).
 *
 * Keycloak exposes brute-force management under the "attack-detection" path
 * segment.  Both of these paths must work:
 *
 *   POST /admin/realms/:realmName/attack-detection/brute-force/users/:userId  (Keycloak style)
 *   POST /admin/realms/:realmName/brute-force/users/:userId/unlock             (AuthMe native, above)
 *
 * The Keycloak-style endpoint accepts the userId directly in the path with no
 * trailing `/unlock` segment, matching the Keycloak Admin REST API contract.
 */
@ApiTags('Brute Force Protection')
@Controller('admin/realms/:realmName/attack-detection/brute-force')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class BruteForceAttackDetectionController {
  constructor(private readonly bruteForceService: BruteForceService) {}

  /**
   * POST /admin/realms/:realmName/attack-detection/brute-force/users/:userId
   *
   * Keycloak-compatible path for unlocking a brute-force-locked user.
   */
  @Post('users/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a locked user (Keycloak-compatible path)' })
  @ApiResponse({ status: 200, description: 'User unlocked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async unlockUser(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    await this.bruteForceService.unlockUser(realm.id, userId);
    return { message: 'User unlocked' };
  }
}
