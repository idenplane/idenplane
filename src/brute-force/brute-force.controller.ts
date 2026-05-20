import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { Realm } from '@prisma/client';
import { BruteForceService } from './brute-force.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { StepUpService, ACR_MFA } from '../step-up/step-up.service.js';
import { LoginService } from '../login/login.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('Brute Force Protection')
@Controller('admin/realms/:realmName/brute-force')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class BruteForceController {
  constructor(
    private readonly bruteForceService: BruteForceService,
    private readonly stepUpService: StepUpService,
    private readonly loginService: LoginService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

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
   * Requires MFA step-up authentication.
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
    @Req() req: Request,
  ) {
    await this.requireAdminMfaStepUp(realm, req);
    await this.bruteForceService.unlockUser(realm.id, userId);
    return { message: 'User unlocked' };
  }

  private async requireAdminMfaStepUp(
    realm: Realm,
    req: Request,
  ): Promise<void> {
    const adminUser = (req as Request & { adminUser?: { userId: string } })
      .adminUser;
    if (!adminUser?.userId) {
      throw new UnauthorizedException('Admin identity could not be determined');
    }

    if (adminUser.userId.startsWith('api-key:')) {
      throw new UnauthorizedException(
        'MFA step-up is required to unlock a user. API key authentication is not permitted for this operation.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- express Request.cookies typed as any
    const sessionToken: string | undefined = req.cookies?.IDENPLANE_SESSION;
    if (!sessionToken) {
      throw new UnauthorizedException(
        'MFA step-up is required. No active session found. Please log in via the user login flow to establish an MFA-verified session.',
      );
    }

    const adminUserFromSession = await this.loginService.validateLoginSession(
      realm,
      sessionToken,
    );
    if (!adminUserFromSession) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (adminUserFromSession.id !== adminUser.userId) {
      throw new UnauthorizedException('Session does not match admin identity');
    }

    const tokenHash = this.crypto.sha256(sessionToken);
    const loginSession = await this.prisma.loginSession.findUnique({
      where: { tokenHash },
    });
    if (!loginSession) {
      throw new UnauthorizedException('Session not found');
    }

    const currentAcr = await this.stepUpService.getSessionAcr(loginSession.id);
    if (!this.stepUpService.satisfiesAcr(currentAcr, ACR_MFA)) {
      throw new UnauthorizedException(
        'MFA step-up is required to unlock a user. Please complete MFA verification via POST /realms/:realmName/step-up/verify with acr=urn:idenplane:acr:mfa before retrying.',
      );
    }
  }
}

/**
 * Keycloak-compatible alias controller (issue #504).
 *
 * Keycloak exposes brute-force management under the "attack-detection" path
 * segment.  Both of these paths must work:
 *
 *   POST /admin/realms/:realmName/attack-detection/brute-force/users/:userId  (Keycloak style)
 *   POST /admin/realms/:realmName/brute-force/users/:userId/unlock             (Idenplane native, above)
 *
 * The Keycloak-style endpoint accepts the userId directly in the path with no
 * trailing `/unlock` segment, matching the Keycloak Admin REST API contract.
 */
@ApiTags('Brute Force Protection')
@Controller('admin/realms/:realmName/attack-detection/brute-force')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class BruteForceAttackDetectionController {
  constructor(
    private readonly bruteForceService: BruteForceService,
    private readonly stepUpService: StepUpService,
    private readonly loginService: LoginService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /admin/realms/:realmName/attack-detection/brute-force/users/:userId
   *
   * Keycloak-compatible path for unlocking a brute-force-locked user.
   * Requires MFA step-up authentication.
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
    @Req() req: Request,
  ) {
    await this.requireAdminMfaStepUp(realm, req);
    await this.bruteForceService.unlockUser(realm.id, userId);
    return { message: 'User unlocked' };
  }

  private async requireAdminMfaStepUp(
    realm: Realm,
    req: Request,
  ): Promise<void> {
    const adminUser = (req as Request & { adminUser?: { userId: string } })
      .adminUser;
    if (!adminUser?.userId) {
      throw new UnauthorizedException('Admin identity could not be determined');
    }

    if (adminUser.userId.startsWith('api-key:')) {
      throw new UnauthorizedException(
        'MFA step-up is required to unlock a user. API key authentication is not permitted for this operation.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- express Request.cookies typed as any
    const sessionToken: string | undefined = req.cookies?.IDENPLANE_SESSION;
    if (!sessionToken) {
      throw new UnauthorizedException(
        'MFA step-up is required. No active session found. Please log in via the user login flow to establish an MFA-verified session.',
      );
    }

    const adminUserFromSession = await this.loginService.validateLoginSession(
      realm,
      sessionToken,
    );
    if (!adminUserFromSession) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (adminUserFromSession.id !== adminUser.userId) {
      throw new UnauthorizedException('Session does not match admin identity');
    }

    const tokenHash = this.crypto.sha256(sessionToken);
    const loginSession = await this.prisma.loginSession.findUnique({
      where: { tokenHash },
    });
    if (!loginSession) {
      throw new UnauthorizedException('Session not found');
    }

    const currentAcr = await this.stepUpService.getSessionAcr(loginSession.id);
    if (!this.stepUpService.satisfiesAcr(currentAcr, ACR_MFA)) {
      throw new UnauthorizedException(
        'MFA step-up is required to unlock a user. Please complete MFA verification via POST /realms/:realmName/step-up/verify with acr=urn:idenplane:acr:mfa before retrying.',
      );
    }
  }
}
