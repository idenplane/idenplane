import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
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
import { StepUpService } from '../step-up/step-up.service.js';
import { ACR_MFA } from '../authn-core/acr.js';
import { SESSION_COOKIE } from '../authn-core/cookies.js';
import { hasRecentAdminMfa } from '../admin-rbac/admin-access-policy.js';
import { LoginService } from '../login/login.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';

/** `keepPasskeys` of a full MFA reset: absent or `false` removes them. */
function parseKeepPasskeys(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException('keepPasskeys must be true or false');
}

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
    private readonly sessions: SessionsService,
    private readonly webAuthn: WebAuthnService,
  ) {}

  /**
   * Removing a second factor is a credential reset: whoever signed in with
   * it (or got past it) is signed out everywhere, offline sessions included,
   * and signs in again with what the user has now.
   */
  private async endSessions(realm: Realm, userId: string): Promise<void> {
    await this.sessions.revokeAllUserSessions(realm, userId);
  }

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
    const [methods, passkeys] = await Promise.all([
      this.mfaService.getEnrolledFactors(userId),
      this.webAuthn.countCredentials(userId, realm.id),
    ]);
    // `enabled`/`methods` are the second factors a sign-in asks for after
    // the password. Passkeys are counted apart: they are a sign-in of their
    // own (and a step-up), not a step after the password.
    return { enabled: methods.length > 0, methods, passkeys };
  }

  /**
   * Full reset: every second factor (authenticator app, SMS phone), the
   * recovery codes and, unless `keepPasskeys=true`, every passkey. Then the
   * user is signed out everywhere.
   *
   * Passkeys go by default because this is the account-recovery action: a
   * passkey registered by whoever took the account over signs in on its
   * own, without the password, so a reset that left it would leave them
   * in. A passkey has no flag saying whether it is used passwordless or as
   * a step-up, so it cannot be told apart from the user's own; an admin
   * who knows the passkeys are the user's (a lost phone, say) passes
   * `keepPasskeys=true`, or removes single passkeys with
   * `DELETE .../mfa/passkeys/{credentialId}`.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Reset a user's MFA: second factors, recovery codes and passkeys",
  })
  @ApiQuery({
    name: 'keepPasskeys',
    required: false,
    type: Boolean,
    description:
      "true keeps the user's passkeys (WebAuthn credentials). Default false: they are removed too.",
  })
  @ApiResponse({ status: 204, description: 'MFA reset' })
  @ApiResponse({ status: 400, description: 'keepPasskeys is not true/false' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async resetMfa(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Req() req: Request,
    @Query('keepPasskeys') keepPasskeys?: string,
  ) {
    const keep = parseKeepPasskeys(keepPasskeys);
    await this.assertUserInRealm(userId, realm);
    await this.requireAdminMfaStepUp(realm, req);
    await this.mfaService.disableAllFactors(userId);
    if (!keep) await this.webAuthn.removeAllCredentials(userId, realm.id);
    await this.endSessions(realm, userId);
  }

  @Get('passkeys')
  @ApiOperation({ summary: "List a user's passkeys (WebAuthn credentials)" })
  @ApiResponse({ status: 200, description: 'The passkeys, oldest first' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async listPasskeys(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    await this.assertUserInRealm(userId, realm);
    const credentials = await this.webAuthn.getUserCredentials(userId);
    return credentials
      .filter((c) => c.realmId === realm.id)
      .map((c) => ({
        id: c.id,
        friendlyName: c.friendlyName,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        transports: c.transports,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
      }));
  }

  @Delete('passkeys/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one passkey of a user' })
  @ApiResponse({ status: 204, description: 'Passkey removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized – MFA step-up required',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async removePasskey(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('credentialId') credentialId: string,
    @Req() req: Request,
  ) {
    await this.assertUserInRealm(userId, realm);
    // Same bar as removing a second factor: a passkey signs the user in.
    await this.requireAdminMfaStepUp(realm, req);
    await this.webAuthn.removeCredential(userId, realm.id, credentialId);
    await this.endSessions(realm, userId);
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
    await this.endSessions(realm, userId);
  }

  @Delete('sms')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a user's SMS phone (second factor)" })
  @ApiResponse({ status: 204, description: 'SMS factor removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized – MFA step-up required',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async resetSms(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    await this.assertUserInRealm(userId, realm);
    // Same bar as a TOTP reset: it removes one of the user's second factors.
    await this.requireAdminMfaStepUp(realm, req);
    await this.mfaService.disableSms(userId);
    await this.endSessions(realm, userId);
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

    // The console's step-up: an admin token whose second factor was checked
    // in the last 15 minutes (docs/docs/security/admin-mfa.md).
    if (hasRecentAdminMfa(adminUser)) return;

    const sessionToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!sessionToken) {
      throw new UnauthorizedException(
        'MFA step-up is required: verify your second factor in the admin console (POST /admin/auth/step-up) and retry within 15 minutes.',
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
