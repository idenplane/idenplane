import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { Realm } from '@prisma/client';

type AdminRequest = Request & {
  adminUser?: { userId: string; roles: string[] };
};
import { MfaService } from './mfa.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { StepUpService, ACR_MFA } from '../step-up/step-up.service.js';
import { LoginService } from '../login/login.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

@ApiTags('MFA')
@Controller('admin/realms/:realmName/users/:userId/mfa')
@UseGuards(RealmGuard, AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly prisma: PrismaService,
    private readonly stepUpService: StepUpService,
    private readonly loginService: LoginService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Verify that userId belongs to the given realm.
   * Throws NotFoundException (404) for both "user not found" and "user in wrong
   * realm" cases — a uniform response avoids leaking realm membership info.
   */
  private async assertUserInRealm(userId: string, realm: Realm): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.realmId !== realm.id) {
      throw new NotFoundException(
        `User '${userId}' not found in realm '${realm.name}'`,
      );
    }
  }

  @Get('status')
  @ApiOperation({ summary: 'Check if user has MFA enabled' })
  @ApiResponse({ status: 200, description: 'MFA status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getMfaStatus(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    await this.assertUserInRealm(userId, realm);
    const enabled = await this.mfaService.isMfaEnabled(userId);
    return { enabled };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset/disable MFA for a user' })
  @ApiResponse({ status: 204, description: 'MFA disabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async resetMfa(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    await this.assertUserInRealm(userId, realm);
    await this.requireAdminMfaStepUp(realm, req);
    await this.mfaService.disableTotp(userId);
  }

  @Delete('totp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset/disable TOTP MFA for a user' })
  @ApiResponse({ status: 204, description: 'TOTP MFA disabled' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized – MFA step-up required',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async resetTotp(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    await this.assertUserInRealm(userId, realm);
    // Resetting a user's TOTP secret is a high-privilege, sensitive operation:
    // it bypasses the user's second factor entirely.  The admin must have
    // completed MFA step-up themselves; static API key auth is explicitly
    // rejected because the key cannot prove interactive MFA verification.
    await this.requireAdminMfaStepUp(realm, req);
    await this.mfaService.disableTotp(userId);
  }

  private async requireAdminMfaStepUp(
    realm: Realm,
    req: Request,
  ): Promise<void> {
    const adminUser = (req as AdminRequest).adminUser;
    if (!adminUser?.userId) {
      throw new UnauthorizedException('Admin identity could not be determined');
    }

    // Static admin API keys are intentionally rejected here. The key is a single
    // shared secret that always carries super-admin, so if it ever leaks it must
    // not be usable to bypass MFA on every account. Disabling a user's MFA
    // therefore requires an interactively MFA-verified admin session (the Bearer
    // path below). Users who lose their authenticator recover via their recovery
    // codes; an MFA-verified admin reset is the fallback. (Deliberate: do not add
    // an API-key break-glass path — it reintroduces the key-leak → mass-bypass risk.)
    if (adminUser.userId.startsWith('api-key:')) {
      throw new UnauthorizedException(
        'Static admin API keys cannot disable user MFA — this is deliberate, so a leaked key cannot bypass MFA across every account. ' +
          'Recovery paths: (1) the user redeems a recovery code; (2) an admin signs in interactively and completes MFA step-up ' +
          '(POST /realms/:realmName/step-up/verify with acr=urn:idenplane:acr:mfa), then retries with that session.',
      );
    }

    const sessionToken = req.cookies?.['IDENPLANE_SESSION'] as
      | string
      | undefined;
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
        'MFA step-up is required to disable user MFA. Please complete MFA verification via POST /realms/:realmName/step-up/verify with acr=urn:idenplane:acr:mfa before retrying.',
      );
    }
  }
}
