import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
  Body,
  Req,
  Res,
  Logger,
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
import { MfaService, MFA_ENROLLMENT_COOKIE } from '../mfa/mfa.service.js';
import {
  SmsOtpService,
  SmsOtpError,
  SMS_ENROLLMENT_COOKIE,
  SMS_ENROLLMENT_TTL_SECONDS,
  type SmsEnrollmentData,
} from '../sms/sms-otp.service.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';
import { DataExportService } from './data-export.service.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { CsrfService } from '../common/csrf/csrf.service.js';
import { EmailService } from '../email/email.service.js';
import { escapeHtml } from '../common/utils/html-escape.util.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';

@ApiExcludeController()
@Controller('realms/:realmName/account')
@UseGuards(RealmGuard)
@Public()
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

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
    private readonly csrfService: CsrfService,
    private readonly emailService: EmailService,
    private readonly smsOtp: SmsOtpService,
  ) {}

  /** Set a fresh CSRF cookie and return the token for embedding in the form. */
  private setCsrfCookie(realm: Realm, res: Response): string {
    const token = this.csrfService.generateToken();
    res.cookie(this.csrfService.cookieName(realm.name), token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: `/realms/${realm.name}`,
    });
    return token;
  }

  /** Throw `ForbiddenException` when the double-submit CSRF token is invalid. */
  private validateCsrf(realm: Realm, body: object, req: Request): void {
    const bodyToken = (body as Record<string, unknown>)['_csrf'] as
      string | undefined;
    const cookieToken = (req.cookies as Record<string, string | undefined>)?.[
      this.csrfService.cookieName(realm.name)
    ];
    if (!this.csrfService.validate(bodyToken, cookieToken)) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
  }

  private async getSessionUser(realm: Realm, req: Request) {
    const sessionToken = req.cookies?.['IDENPLANE_SESSION'] as
      string | undefined;
    if (!sessionToken) return null;
    return this.loginService.validateLoginSession(realm, sessionToken);
  }

  /**
   * Who is setting up TOTP: either a signed-in user, or a user whose sign-in
   * is paused because the realm requires MFA and they have not enrolled yet
   * (`enrollmentToken` set). The enrolment is checked first so a stale SSO
   * cookie for another account can never be what gets enrolled.
   */
  private async getTotpSetupUser(realm: Realm, req: Request) {
    const enrollmentToken = (
      req.cookies as Record<string, string | undefined>
    )?.[MFA_ENROLLMENT_COOKIE];
    if (enrollmentToken) {
      const enrollment =
        await this.mfaService.getMfaEnrollment(enrollmentToken);
      if (enrollment && enrollment.realmId === realm.id) {
        const user = await this.loginService.findUserById(enrollment.userId);
        if (user?.enabled) {
          return {
            user,
            enrollmentToken,
            enrollmentVerified: !!enrollment.verified,
          };
        }
      }
    }
    const user = await this.getSessionUser(realm, req);
    return user
      ? { user, enrollmentToken: undefined, enrollmentVerified: false }
      : null;
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
    // The account page's two-factor card is about the authenticator app.
    const mfaEnabled = await this.mfaService.isTotpEnabled(user.id);
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

    // Text-message factor: shown when it can be added, or when the user has
    // one (it keeps working after an admin turns new enrolments off).
    const smsPhone = await this.smsOtp.getEnrolledPhone(user.id);
    const smsAvailable = SmsOtpService.canEnroll(realm);

    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'account',
      'account',
      {
        smsSection: smsAvailable || !!smsPhone,
        smsAvailable,
        smsEnabled: !!smsPhone,
        smsPhone: smsPhone ? SmsOtpService.maskPhone(smsPhone) : '',
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
        csrfToken,
      },
      req,
    );
  }

  /**
   * Account self-service sign-out — clears the IDENPLANE_SESSION cookie and
   * deletes the matching loginSession row, then redirects to /login.
   *
   * This is a separate path from the OIDC RP-initiated logout endpoint
   * (`/realms/:r/protocol/openid-connect/logout`) because that one requires
   * `id_token_hint`/`post_logout_redirect_uri` plumbing and returns 204 on a
   * bare GET — useless to a browser. Convention across other IdPs (Google,
   * GitHub) is GET for the in-app "Sign out" link.
   */
  @Get('logout')
  async logout(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const sessionToken = req.cookies?.['IDENPLANE_SESSION'] as
      string | undefined;
    if (sessionToken) {
      const tokenHash = this.crypto.sha256(sessionToken);
      await this.prisma.loginSession
        .delete({ where: { tokenHash } })
        .catch(() => undefined);
    }
    res.clearCookie('IDENPLANE_SESSION', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: `/realms/${realm.name}`,
    });
    return res.redirect(`/realms/${realm.name}/login?signedOut=1`);
  }

  @Post('profile')
  async updateProfile(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
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
    this.validateCsrf(realm, body, req);
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

    void this.sendPasswordChangedEmail(realm.name, user, req);

    res.redirect(
      `/realms/${realm.name}/account?success=${encodeURIComponent('Password changed successfully.')}`,
    );
  }

  /**
   * Best-effort security alert so the account holder can catch an
   * unauthorized password change — never blocks the change itself on
   * email delivery, matching sendBlockedLoginEmail's fire-and-forget shape.
   */
  private async sendPasswordChangedEmail(
    realmName: string,
    user: { email: string | null; username: string },
    req: Request,
  ): Promise<void> {
    if (!user.email) return;

    const time = escapeHtml(new Date().toUTCString());
    const ip = escapeHtml(resolveClientIp(req));
    const device = escapeHtml(req.headers?.['user-agent'] ?? 'Unknown');

    const html = `
      <h2>Your Password Was Changed</h2>
      <p>The password for account "${escapeHtml(user.username)}" was just changed.</p>
      <table style="border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Time</td><td>${time}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">IP Address</td><td>${ip}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Device</td><td>${device}</td></tr>
      </table>
      <p style="margin-top:16px">
        If this was you, no action is required.<br/>
        If you did not make this change, contact your administrator immediately.
      </p>
    `;

    try {
      await this.emailService.sendEmail(
        realmName,
        user.email,
        'Your Password Was Changed',
        html,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send password-changed email to ${user.email}: ${(err as Error).message}`,
      );
    }
  }

  // ─── TOTP SETUP ─────────────────────────────────────────

  @Get('totp-setup')
  async showTotpSetup(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const setupUser = await this.getTotpSetupUser(realm, req);
    if (!setupUser) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const { user, enrollmentToken, enrollmentVerified } = setupUser;

    const query = req.query as Record<string, string>;
    const totpEnabled = await this.mfaService.isTotpEnabled(user.id);
    if (enrollmentToken && totpEnabled) {
      if (!enrollmentVerified) {
        // Enrolled somewhere else meanwhile: sign in normally with the code.
        res.clearCookie(MFA_ENROLLMENT_COOKIE, {
          path: `/realms/${realm.name}`,
        });
        return res.redirect(`/realms/${realm.name}/login`);
      }
      // Activated here but the page was reloaded before "Continue".
      const csrfToken = this.setCsrfCookie(realm, res);
      return this.themeRender.render(
        res,
        realm,
        'account',
        'totp-setup',
        {
          pageTitle: 'Two-Factor Authentication Enabled',
          activated: true,
          continueAction: this.enrollmentContinueAction(realm),
          csrfToken,
        },
        req,
      );
    }
    if (totpEnabled) {
      return res.redirect(
        `/realms/${realm.name}/account?info=${encodeURIComponent('Two-factor authentication is already enabled.')}`,
      );
    }

    const setup = await this.mfaService.setupTotp(
      user.id,
      realm.name,
      user.username,
    );

    const csrfToken = this.setCsrfCookie(realm, res);
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
        csrfToken,
        // During required enrolment there is no account to go back to.
        cancelUrl: enrollmentToken
          ? `/realms/${realm.name}/login`
          : `/realms/${realm.name}/account`,
        smsSetupUrl: SmsOtpService.canEnroll(realm)
          ? `/realms/${realm.name}/account/sms-setup`
          : '',
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
    this.validateCsrf(realm, body, req);
    const setupUser = await this.getTotpSetupUser(realm, req);
    if (!setupUser) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const { user, enrollmentToken } = setupUser;

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

    if (enrollmentToken) {
      await this.mfaService.markMfaEnrollmentVerified(enrollmentToken);
    }

    // After required enrolment the "Done" button finishes the paused sign-in
    // (a POST, so it carries a fresh CSRF token).
    const csrfToken = enrollmentToken ? this.setCsrfCookie(realm, res) : '';
    this.themeRender.render(
      res,
      realm,
      'account',
      'totp-setup',
      {
        pageTitle: 'Two-Factor Authentication Enabled',
        activated: true,
        recoveryCodes,
        continueAction: enrollmentToken
          ? this.enrollmentContinueAction(realm)
          : '',
        csrfToken,
      },
      req,
    );
  }

  // ─── SMS (text message) second factor ─────────────────────

  /** The phone enrolment in progress for `userId`, from its cookie. */
  private async getSmsEnrollment(
    realm: Realm,
    req: Request,
    userId: string,
  ): Promise<{ token: string; data: SmsEnrollmentData } | null> {
    const token = (req.cookies as Record<string, string | undefined>)?.[
      SMS_ENROLLMENT_COOKIE
    ];
    if (!token) return null;
    const data = await this.smsOtp.getEnrollment(token);
    if (!data || data.userId !== userId || data.realmId !== realm.id) {
      return null;
    }
    return { token, data };
  }

  private clearSmsEnrollmentCookie(realm: Realm, res: Response) {
    res.clearCookie(SMS_ENROLLMENT_COOKIE, { path: `/realms/${realm.name}` });
  }

  private smsSetupRedirect(
    realm: Realm,
    res: Response,
    kind: 'error' | 'info',
    message: string,
  ) {
    return res.redirect(
      `/realms/${realm.name}/account/sms-setup?${kind}=${encodeURIComponent(message)}`,
    );
  }

  @Get('sms-setup')
  async showSmsSetup(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const setupUser = await this.getTotpSetupUser(realm, req);
    if (!setupUser) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const { user, enrollmentToken, enrollmentVerified } = setupUser;
    const query = req.query as Record<string, string>;
    const csrfToken = this.setCsrfCookie(realm, res);

    if (enrollmentToken && enrollmentVerified) {
      // Activated here but the page was reloaded before "Continue".
      return this.themeRender.render(
        res,
        realm,
        'account',
        'sms-setup',
        {
          pageTitle: 'Text Message Verification Enabled',
          activated: true,
          continueAction: this.enrollmentContinueAction(realm),
          csrfToken,
        },
        req,
      );
    }

    if (!SmsOtpService.canEnroll(realm)) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Text message verification is not available.')}`,
      );
    }

    const pending = await this.getSmsEnrollment(realm, req, user.id);
    const currentPhone = await this.smsOtp.getEnrolledPhone(user.id);
    this.themeRender.render(
      res,
      realm,
      'account',
      'sms-setup',
      {
        pageTitle: 'Text Message Verification',
        verifyStep: !!pending?.data.maskedPhone,
        maskedPhone: pending?.data.maskedPhone ?? '',
        currentPhone: currentPhone ? SmsOtpService.maskPhone(currentPhone) : '',
        // Signed-in users confirm their password before adding or changing
        // a phone, so a hijacked session can't plant its own second factor.
        requirePassword: !enrollmentToken && !!user.passwordHash,
        error: query['error'] ?? '',
        info: query['info'] ?? '',
        csrfToken,
        totpSetupUrl: `/realms/${realm.name}/account/totp-setup`,
        cancelUrl: enrollmentToken
          ? `/realms/${realm.name}/login`
          : `/realms/${realm.name}/account`,
      },
      req,
    );
  }

  /**
   * Text a code to the number being added. With `resend` set, texts the
   * number of the enrolment in progress again; otherwise starts a new one
   * (fresh token, so its own guess budget) for the submitted number.
   */
  @Post('sms-setup/send')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async sendSmsSetupCode(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const setupUser = await this.getTotpSetupUser(realm, req);
    if (!setupUser) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const { user, enrollmentToken } = setupUser;
    if (!SmsOtpService.canEnroll(realm)) {
      return res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent('Text message verification is not available.')}`,
      );
    }

    let token: string;
    let phone: string | null;
    const pending = await this.getSmsEnrollment(realm, req, user.id);
    if (body['resend'] && pending) {
      token = pending.token;
      phone = this.smsOtp.enrollmentPhone(pending.data);
      if (!phone) {
        return this.smsSetupRedirect(
          realm,
          res,
          'error',
          'Please enter your phone number again.',
        );
      }
    } else {
      phone = SmsOtpService.normalizePhone(body['phone']);
      if (!phone) {
        return this.smsSetupRedirect(
          realm,
          res,
          'error',
          'Enter the number in international format, for example +201012345678.',
        );
      }
      if (!enrollmentToken && user.passwordHash) {
        const valid =
          !!body['currentPassword'] &&
          (await this.crypto.verifyPassword(
            user.passwordHash,
            body['currentPassword'],
          ));
        if (!valid) {
          return this.smsSetupRedirect(
            realm,
            res,
            'error',
            'Password is incorrect.',
          );
        }
      }
      if (pending) await this.smsOtp.endEnrollment(pending.token);
      token = await this.smsOtp.startEnrollment(user.id, realm.id);
      res.cookie(SMS_ENROLLMENT_COOKIE, token, {
        httpOnly: true,
        secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
        sameSite: 'strict',
        maxAge: SMS_ENROLLMENT_TTL_SECONDS * 1000,
        path: `/realms/${realm.name}`,
      });
    }

    try {
      const sent = await this.smsOtp.sendCode({
        realm,
        userId: user.id,
        purpose: 'enroll',
        binding: token,
        phone,
        ip: resolveClientIp(req),
      });
      await this.smsOtp.setEnrollmentPhone(token, phone);
      return this.smsSetupRedirect(
        realm,
        res,
        'info',
        `We sent a code to ${sent.maskedPhone}.`,
      );
    } catch (err) {
      if (err instanceof SmsOtpError) {
        return this.smsSetupRedirect(realm, res, 'error', err.message);
      }
      throw err;
    }
  }

  @Post('sms-setup/verify')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async verifySmsSetupCode(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const setupUser = await this.getTotpSetupUser(realm, req);
    if (!setupUser) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const { user, enrollmentToken } = setupUser;
    const pending = await this.getSmsEnrollment(realm, req, user.id);
    if (!pending) {
      return this.smsSetupRedirect(
        realm,
        res,
        'error',
        'Your code expired. Please enter your phone number again.',
      );
    }

    const result = await this.smsOtp.verifyCode({
      realmId: realm.id,
      userId: user.id,
      purpose: 'enroll',
      binding: pending.token,
      code: body['code'] ?? '',
    });
    if (!result.ok) {
      if (result.reason === 'invalid') {
        return this.smsSetupRedirect(
          realm,
          res,
          'error',
          `Invalid code. ${result.remainingAttempts} attempt(s) remaining.`,
        );
      }
      // Locked, expired or already used: this enrolment is over.
      await this.smsOtp.endEnrollment(pending.token);
      this.clearSmsEnrollmentCookie(realm, res);
      return this.smsSetupRedirect(
        realm,
        res,
        'error',
        result.reason === 'locked'
          ? 'Too many incorrect codes. Please start again.'
          : 'Your code expired. Please enter your phone number again.',
      );
    }

    await this.smsOtp.saveEnrolledPhone(user.id, result.phone);
    await this.smsOtp.endEnrollment(pending.token);
    this.clearSmsEnrollmentCookie(realm, res);
    // Recovery codes come with the first factor; adding SMS next to an
    // authenticator app keeps the codes the user already saved.
    const recoveryCodes =
      (await this.mfaService.ensureRecoveryCodes(user.id)) ?? [];
    if (enrollmentToken) {
      await this.mfaService.markMfaEnrollmentVerified(enrollmentToken, 'sms');
    }
    this.logger.log(
      `User ${user.id} enrolled an SMS phone in realm ${realm.name}`,
    );

    const csrfToken = enrollmentToken ? this.setCsrfCookie(realm, res) : '';
    return this.themeRender.render(
      res,
      realm,
      'account',
      'sms-setup',
      {
        pageTitle: 'Text Message Verification Enabled',
        activated: true,
        recoveryCodes,
        continueAction: enrollmentToken
          ? this.enrollmentContinueAction(realm)
          : '',
        csrfToken,
      },
      req,
    );
  }

  @Post('sms-disable')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleSmsDisable(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }
    const accountError = (message: string) =>
      res.redirect(
        `/realms/${realm.name}/account?error=${encodeURIComponent(message)}`,
      );

    if (realm.mfaRequired) {
      const others = (await this.mfaService.getEnrolledFactors(user.id)).filter(
        (f) => f !== 'sms',
      );
      if (others.length === 0) {
        return accountError(
          'Two-factor authentication is required in this realm and cannot be turned off.',
        );
      }
    }

    if (user.passwordHash) {
      const valid =
        !!body['currentPassword'] &&
        (await this.crypto.verifyPassword(
          user.passwordHash,
          body['currentPassword'],
        ));
      if (!valid) return accountError('Password is incorrect.');
    }

    await this.mfaService.disableSms(user.id);
    return res.redirect(
      `/realms/${realm.name}/account?success=${encodeURIComponent('Text message verification has been turned off.')}`,
    );
  }

  private enrollmentContinueAction(realm: Realm): string {
    return `/realms/${realm.name}/mfa-enrollment/continue`;
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
    this.validateCsrf(realm, body, req);
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    // A realm that requires MFA may not be left without a second factor;
    // removing the app is fine while another factor (SMS) remains.
    if (realm.mfaRequired) {
      const others = (await this.mfaService.getEnrolledFactors(user.id)).filter(
        (f) => f !== 'totp',
      );
      if (others.length === 0) {
        return res.redirect(
          `/realms/${realm.name}/account?error=${encodeURIComponent('Two-factor authentication is required in this realm and cannot be turned off.')}`,
        );
      }
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

    const csrfToken = this.setCsrfCookie(realm, res);
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
        csrfToken,
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
    this.validateCsrf(realm, body, req);
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
    this.validateCsrf(realm, body, req);
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
