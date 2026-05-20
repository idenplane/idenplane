import {
  Controller,
  Get,
  Post,
  UseGuards,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';
import { LoginService } from '../login/login.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';
import { DataExportService } from './data-export.service.js';
import { AccountDeletionService } from './account-deletion.service.js';

@ApiExcludeController()
@Controller('realms/:realmName/account')
@UseGuards(RealmGuard)
@Public()
export class AccountController {
  constructor(
    private readonly loginService: LoginService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly mfaService: MfaService,
    private readonly themeRender: ThemeRenderService,
    private readonly webAuthnService: WebAuthnService,
    private readonly dataExportService: DataExportService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  private async getSessionUser(realm: Realm, req: Request) {
    const sessionToken = req.cookies?.['IDENPLANE_SESSION'] as string | undefined;
    if (!sessionToken) return null;
    return this.loginService.validateLoginSession(realm, sessionToken);
  }

  @Get()
  async showAccount(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const query = req.query as Record<string, string>;
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
    const webAuthnEnabled = realm.webAuthnEnabled ?? false;

    let webAuthnCredentials: Array<{
      id: string;
      friendlyName: string | null;
      deviceType: string;
      backedUp: boolean;
      transports: string[];
      createdAt: string;
      lastUsedAt: string | null;
    }> = [];
    if (webAuthnEnabled) {
      const rawCredentials = await this.webAuthnService.getUserCredentials(
        user.id,
      );
      webAuthnCredentials = rawCredentials.map((c) => ({
        id: c.id,
        friendlyName: c.friendlyName,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        transports: c.transports,
        createdAt: c.createdAt.toLocaleDateString(),
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toLocaleDateString() : null,
      }));
    }

    this.themeRender.render(
      res,
      realm,
      'account',
      'account',
      {
        pageTitle: 'My Account',
        username: user.username,
        email: user.email ?? '',
        emailVerified: user.emailVerified,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        mfaEnabled,
        webAuthnEnabled,
        webAuthnCredentials:
          webAuthnCredentials.length > 0 ? webAuthnCredentials : null,
        success: query['success'] ?? '',
        error: query['error'] ?? '',
      },
      req,
    );
  }

  @Post('profile')
  async updateProfile(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const firstName = (body['firstName'] ?? '').trim();
    const lastName = (body['lastName'] ?? '').trim();

    const htmlPattern = /[<>]/;
    if (htmlPattern.test(firstName) || htmlPattern.test(lastName)) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Fields must not contain HTML tags or angle brackets.')}`,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: firstName || null,
        lastName: lastName || null,
      },
    });

    res.redirect(
      `/realms/${realm.name}/account?success=${encodeURIComponent('Profile updated successfully.')}`,
    );
  }

  @Post('password')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async changePassword(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const currentPassword = body['currentPassword'];
    const newPassword = body['newPassword'];
    const confirmPassword = body['confirmPassword'];

    if (!currentPassword || !newPassword) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('All password fields are required.')}`,
      );
    }

    if (newPassword !== confirmPassword) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('New passwords do not match.')}`,
      );
    }

    // Validate against password policy
    const validation = this.passwordPolicyService.validate(realm, newPassword);
    if (!validation.valid) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent(validation.errors.join('. '))}`,
      );
    }

    // Verify current password
    if (!user.passwordHash) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Cannot change password for this account.')}`,
      );
    }

    const valid = await this.crypto.verifyPassword(
      user.passwordHash,
      currentPassword,
    );
    if (!valid) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Current password is incorrect.')}`,
      );
    }

    // Check password history
    if (realm.passwordHistoryCount > 0) {
      const inHistory = await this.passwordPolicyService.checkHistory(
        user.id,
        realm.id,
        newPassword,
        realm.passwordHistoryCount,
      );
      if (inHistory) {
        return res.redirect(
          `/realms/${realm.name}/account?error=${encodeURIComponent('Password was used recently. Choose a different password.')}`,
        );
      }
    }

    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    // Record password history
    await this.passwordPolicyService.recordHistory(
      user.id,
      realm.id,
      passwordHash,
      realm.passwordHistoryCount,
    );

    res.redirect(
      `/realms/${realm.name}/account?success=${encodeURIComponent('Password changed successfully.')}`,
    );
  }

  // ─── TOTP SETUP ─────────────────────────────────────────

  @Get('totp-setup')
  async showTotpSetup(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const query = req.query as Record<string, string>;
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
    if (mfaEnabled) {
      return res.redirect(
        `/realms/${realm.name}/account?info=${encodeURIComponent('Two-factor authentication is already enabled.')}`,
      );
    }

    const setup = await this.mfaService.setupTotp(
      user.id,
      realm.name,
      user.username,
    );

    this.themeRender.render(
      res,
      realm,
      'account',
      'totp-setup',
      {
        pageTitle: 'Set Up Two-Factor Authentication',
        qrCodeDataUrl: setup.qrCodeDataUrl,
        secret: setup.secret,
        error: query['error'] ?? '',
        info: query['info'] ?? '',
      },
      req,
    );
  }

  @Post('totp-setup')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleTotpSetup(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const code = body['code'];
    if (!code) {
      return res.redirect(
        `/realms/${realm.name}/account/totp-setup?error=${encodeURIComponent('Please enter the verification code.')}`,
      );
    }

    const recoveryCodes = await this.mfaService.verifyAndActivateTotp(
      user.id,
      code,
    );
    if (!recoveryCodes) {
      return res.redirect(
        `/realms/${realm.name}/account/totp-setup?error=${encodeURIComponent('Invalid code. Please try again.')}`,
      );
    }

    this.themeRender.render(
      res,
      realm,
      'account',
      'totp-setup',
      {
        pageTitle: 'Two-Factor Authentication Enabled',
        activated: true,
        recoveryCodes,
      },
      req,
    );
  }

  @Post('totp-disable')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleTotpDisable(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const currentPassword = body['currentPassword'];
    if (!currentPassword || !user.passwordHash) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Password is required to disable two-factor authentication.')}`,
      );
    }

    const valid = await this.crypto.verifyPassword(
      user.passwordHash,
      currentPassword,
    );
    if (!valid) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Password is incorrect.')}`,
      );
    }

    await this.mfaService.disableTotp(user.id);

    res.redirect(
      `/realms/${realm.name}/account?success=${encodeURIComponent('Two-factor authentication has been disabled.')}`,
    );
  }

  // ─── DATA EXPORT ─────────────────────────────────────────

  @Get('data-export')
  async getDataExport(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    try {
      const exportData = await this.dataExportService.exportUserDataAsJson(
        user.id,
      );
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="user-data-export-${user.username}-${Date.now()}.json"`,
      );
      res.send(exportData);
    } catch {
      res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Failed to export data. Please try again.')}`,
      );
    }
  }

  // ─── ACCOUNT DELETION ──────────────────────────────────

  @Get('delete-account')
  async showDeleteAccount(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const query = req.query as Record<string, string>;
    const deletionStatus = await this.accountDeletionService.getDeletionStatus(
      user.id,
    );

    this.themeRender.render(
      res,
      realm,
      'account',
      'delete-account',
      {
        pageTitle: 'Delete Account',
        deletionStatus,
        error: query['error'] ?? '',
        success: query['success'] ?? '',
      },
      req,
    );
  }

  @Post('delete-account')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async requestDeleteAccount(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const currentPassword = body['currentPassword'];
    if (!currentPassword || !user.passwordHash) {
      return res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent('Password is required to delete your account.')}`,
      );
    }

    const valid = await this.crypto.verifyPassword(
      user.passwordHash,
      currentPassword,
    );
    if (!valid) {
      return res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent('Password is incorrect.')}`,
      );
    }

    try {
      const gracePeriodDays = realm.deletionGracePeriodDays ?? 14;
      await this.accountDeletionService.requestDeletion(
        user.id,
        gracePeriodDays,
      );
      res.redirect(
        `/realms/${realm.name}/account/delete-account?success=${encodeURIComponent(`Account deletion requested. Your account will be permanently deleted after ${gracePeriodDays} days unless cancelled.`)}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to request account deletion.';
      res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Post('cancel-delete-account')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async cancelDeleteAccount(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const currentPassword = body['currentPassword'];
    if (!currentPassword || !user.passwordHash) {
      return res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent('Password is required to cancel account deletion.')}`,
      );
    }

    const valid = await this.crypto.verifyPassword(
      user.passwordHash,
      currentPassword,
    );
    if (!valid) {
      return res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent('Password is incorrect.')}`,
      );
    }

    try {
      await this.accountDeletionService.cancelDeletion(user.id);
      res.redirect(
        `/realms/${realm.name}/account/delete-account?success=${encodeURIComponent('Account deletion has been cancelled. Your account is safe.')}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to cancel account deletion.';
      res.redirect(
        `/realms/${realm.name}/account/delete-account?error=${encodeURIComponent(message)}`,
      );
    }
  }
}
