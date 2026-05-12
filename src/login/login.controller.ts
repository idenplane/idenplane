import {
  Controller,
  Get,
  Logger,
  Post,
  UseGuards,
  Query,
  Body,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Prisma, type Realm, type User } from '@prisma/client';
import type { AuthorizeParams } from '../oauth/oauth.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';
import { LoginService } from './login.service.js';
import { OAuthService } from '../oauth/oauth.service.js';
import { ConsentService } from '../consent/consent.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';
import { CustomAttributesService } from '../custom-attributes/custom-attributes.service.js';
import { RiskAssessmentService } from '../risk-assessment/risk-assessment.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { CsrfService } from '../common/csrf/csrf.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import {
  LoginDto,
  TotpDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/login.dto.js';

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your profile information (name, username)',
  email: 'Access your email address',
  roles: 'Access your role assignments',
};

@ApiExcludeController()
@Controller('realms/:realmName')
@UseGuards(RealmGuard)
@Public()
export class LoginController {
  private readonly logger = new Logger(LoginController.name);

  constructor(
    private readonly loginService: LoginService,
    private readonly oauthService: OAuthService,
    private readonly consentService: ConsentService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly mfaService: MfaService,
    private readonly themeRender: ThemeRenderService,
    private readonly themeEmail: ThemeEmailService,
    private readonly eventsService: EventsService,
    private readonly customAttributesService: CustomAttributesService,
    private readonly csrfService: CsrfService,
    private readonly bruteForceService: BruteForceService,
    @Optional() private readonly riskAssessmentService?: RiskAssessmentService,
  ) {}

  // ─── CSRF HELPERS ──────────────────────────────────────

  /** Set a fresh CSRF cookie and return the token value for embedding in forms. */
  private setCsrfCookie(realm: Realm, res: Response): string {
    const token = this.csrfService.generateToken();
    res.cookie(this.csrfService.cookieName(realm.name), token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: `/realms/${realm.name}`,
    });
    return token;
  }

  /** Throw `ForbiddenException` when the double-submit CSRF token is invalid. */
  private validateCsrf(realm: Realm, body: object, req: Request): void {
    const bodyToken = (body as Record<string, unknown>)['_csrf'] as
      | string
      | undefined;
    const cookieToken = req.cookies?.[this.csrfService.cookieName(realm.name)];
    if (!this.csrfService.validate(bodyToken, cookieToken)) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
  }

  // ─── LOGIN ──────────────────────────────────────────────

  @Get('login')
  showLoginForm(
    @CurrentRealm() realm: Realm,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'login',
      {
        pageTitle: 'Sign In',
        registrationAllowed: realm.registrationAllowed,
        webAuthnEnabled: realm.webAuthnEnabled ?? false,
        client_id: query['client_id'] ?? '',
        redirect_uri: query['redirect_uri'] ?? '',
        response_type: query['response_type'] ?? '',
        scope: query['scope'] ?? '',
        state: query['state'] ?? '',
        nonce: query['nonce'] ?? '',
        code_challenge: query['code_challenge'] ?? '',
        code_challenge_method: query['code_challenge_method'] ?? '',
        error: query['error'] ?? '',
        info: query['info'] ?? '',
        login_hint: query['login_hint'] ?? '',
        csrfToken,
      },
      req,
    );
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleLogin(
    @CurrentRealm() realm: Realm,
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const b = body as unknown as Record<string, string | undefined>;
    try {
      const user = await this.loginService.validateCredentials(
        realm,
        body.username,
        body.password,
        resolveClientIp(req),
      );

      // ── Adaptive authentication / risk assessment ──────────────────────────
      if (realm.adaptiveAuthEnabled && this.riskAssessmentService) {
        const riskContext = {
          userId: user.id,
          realmId: realm.id,
          realmName: realm.name,
          ipAddress: resolveClientIp(req),
          userAgent: req.headers['user-agent'] ?? null,
          deviceFingerprint: body.device_fingerprint ?? null,
          timestamp: new Date(),
        };

        const assessment =
          await this.riskAssessmentService.assessRisk(riskContext);

        if (assessment.action === 'BLOCK') {
          // Send email notification if user has an email address
          if (user.email) {
            void this.riskAssessmentService.sendBlockedLoginEmail(
              realm.name,
              user.email,
              riskContext,
              assessment.geoLocation,
            );
          }

          this.eventsService.recordLoginEvent({
            realmId: realm.id,
            type: LoginEventType.LOGIN_ERROR,
            userId: user.id,
            clientId: body.client_id,
            ipAddress: resolveClientIp(req),
            error: `Login blocked by risk assessment (score=${assessment.riskScore})`,
          });

          const params = new URLSearchParams();
          params.set(
            'error',
            'Login blocked due to suspicious activity. Check your email for details.',
          );
          for (const key of [
            'client_id',
            'redirect_uri',
            'response_type',
            'scope',
            'state',
            'nonce',
            'code_challenge',
            'code_challenge_method',
          ]) {
            if (b[key]) params.set(key, b[key]);
          }
          return res.redirect(
            `/realms/${realm.name}/login?${params.toString()}`,
          );
        }

        if (assessment.action === 'STEP_UP') {
          // Force MFA step-up by storing challenge even if MFA is not globally required
          const mfaAvailable = await this.mfaService.isMfaEnabled(user.id);
          if (mfaAvailable) {
            const oauthParamsForChallenge: Record<string, string> = {};
            for (const key of [
              'response_type',
              'client_id',
              'redirect_uri',
              'scope',
              'state',
              'nonce',
              'code_challenge',
              'code_challenge_method',
            ]) {
              if (b[key]) oauthParamsForChallenge[key] = b[key];
            }
            const challengeToken = await this.mfaService.createMfaChallenge(
              user.id,
              realm.id,
              oauthParamsForChallenge,
            );

            res.cookie('AUTHME_MFA_CHALLENGE', challengeToken, {
              httpOnly: true,
              secure: process.env['NODE_ENV'] === 'production',
              sameSite: 'strict',
              maxAge: 5 * 60 * 1000,
              path: `/realms/${realm.name}`,
            });

            return res.redirect(`/realms/${realm.name}/totp`);
          }
          // If no MFA is configured, allow through (step-up without MFA setup falls through)
        }

        // Update the user's profile on ALLOW or STEP_UP (will learn from the login)
        void this.riskAssessmentService.updateUserProfile(
          user.id,
          realm.id,
          riskContext,
          assessment.geoLocation,
        );
      }
      // ── End risk assessment ────────────────────────────────────────────────

      // Check email verification requirement
      if (realm.requireEmailVerification && user.email && !user.emailVerified) {
        const params = new URLSearchParams();
        params.set(
          'error',
          'Please verify your email address before signing in. Check your inbox for the verification link.',
        );
        for (const key of [
          'client_id',
          'redirect_uri',
          'response_type',
          'scope',
          'state',
          'nonce',
          'code_challenge',
          'code_challenge_method',
        ]) {
          if (b[key]) params.set(key, b[key]);
        }
        return res.redirect(`/realms/${realm.name}/login?${params.toString()}`);
      }

      // Build OAuth params for later use
      const oauthParams: Record<string, string> = {};
      for (const key of [
        'response_type',
        'client_id',
        'redirect_uri',
        'scope',
        'state',
        'nonce',
        'code_challenge',
        'code_challenge_method',
      ]) {
        if (b[key]) oauthParams[key] = b[key];
      }

      // Check password expiry
      if (this.passwordPolicyService.isExpired(user, realm)) {
        const changeToken = this.crypto.generateSecret(32);
        // Store a short-lived verification token for the change-password flow
        await this.verificationService.createTokenWithHash(
          user.id,
          'change_password',
          300,
          this.crypto.sha256(changeToken),
        );

        return res.redirect(
          `/realms/${realm.name}/change-password?token=${changeToken}&info=${encodeURIComponent('Your password has expired and must be changed.')}`,
        );
      }

      // Check MFA
      const mfaRequired = await this.mfaService.isMfaRequired(realm, user.id);
      const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);

      if (mfaEnabled) {
        // User has TOTP set up — require verification
        const challengeToken = await this.mfaService.createMfaChallenge(
          user.id,
          realm.id,
          oauthParams,
        );

        res.cookie('AUTHME_MFA_CHALLENGE', challengeToken, {
          httpOnly: true,
          secure: process.env['NODE_ENV'] === 'production',
          sameSite: 'lax',
          maxAge: 5 * 60 * 1000,
          path: `/realms/${realm.name}`,
        });

        return res.redirect(`/realms/${realm.name}/totp`);
      }

      if (mfaRequired && !mfaEnabled) {
        // Realm requires MFA but user hasn't set it up yet
        // Create session first so they can set up TOTP
        const sessionToken = await this.loginService.createLoginSession(
          realm,
          user,
          resolveClientIp(req),
          req.headers['user-agent'],
          req.cookies?.['AUTHME_SESSION'] as string | undefined,
        );

        res.cookie('AUTHME_SESSION', sessionToken, {
          httpOnly: true,
          secure: process.env['NODE_ENV'] === 'production',
          sameSite: 'strict',
          path: `/realms/${realm.name}`,
        });

        return res.redirect(
          `/realms/${realm.name}/account/totp-setup?info=${encodeURIComponent('Two-factor authentication is required. Please set it up now.')}`,
        );
      }

      // No MFA needed — proceed to create session
      return await this.completeLogin(realm, user, b, oauthParams, req, res);
    } catch (err: unknown) {
      const errMessage =
        err instanceof Error ? err.message : 'Invalid credentials';
      this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.LOGIN_ERROR,
        clientId: body.client_id,
        ipAddress: resolveClientIp(req),
        error: errMessage,
      });

      const params = new URLSearchParams();
      params.set('error', errMessage);
      for (const key of [
        'client_id',
        'redirect_uri',
        'response_type',
        'scope',
        'state',
        'nonce',
        'code_challenge',
        'code_challenge_method',
      ]) {
        if (b[key]) params.set(key, b[key]);
      }
      res.redirect(`/realms/${realm.name}/login?${params.toString()}`);
    }
  }

  private async completeLogin(
    realm: Realm,
    user: User,
    body: Record<string, unknown>,
    oauthParams: Record<string, string>,
    req: Request,
    res: Response,
  ) {
    // Validate OAuth request (including redirect_uri) BEFORE creating session
    let client;
    if (oauthParams['client_id']) {
      client = await this.oauthService.validateAuthRequest(
        realm,
        oauthParams as unknown as AuthorizeParams,
      );
    }

    const sessionToken = await this.loginService.createLoginSession(
      realm,
      user,
      resolveClientIp(req),
      req.headers['user-agent'],
      req.cookies?.['AUTHME_SESSION'] as string | undefined,
    );

    res.cookie('AUTHME_SESSION', sessionToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: body['rememberMe'] ? 30 * 24 * 60 * 60 * 1000 : undefined,
      path: `/realms/${realm.name}`,
    });

    this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGIN,
      userId: user.id,
      clientId: oauthParams['client_id'],
      ipAddress: resolveClientIp(req),
    });

    if (!client) {
      return res.redirect(302, `/realms/${realm.name}/account`);
    }

    if (client.requireConsent) {
      const scopes = (oauthParams['scope'] ?? 'openid')
        .split(' ')
        .filter(Boolean);
      const hasConsent = await this.consentService.hasConsent(
        user.id,
        client.id,
        scopes,
      );

      if (!hasConsent) {
        const reqId = await this.consentService.storeConsentRequest({
          userId: user.id,
          clientId: client.id,
          clientName: client.name ?? client.clientId,
          realmName: realm.name,
          scopes,
          oauthParams,
        });
        return res.redirect(302, `/realms/${realm.name}/consent?req=${reqId}`);
      }
    }

    const result = await this.oauthService.authorizeWithUser(
      realm,
      user,
      oauthParams as unknown as AuthorizeParams,
    );
    res.redirect(302, result.redirectUrl);
  }

  // ─── MFA / TOTP ───────────────────────────────────────────

  @Get('totp')
  showTotpForm(
    @CurrentRealm() realm: Realm,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'totp',
      {
        pageTitle: 'Two-Factor Authentication',
        error: error ?? '',
        csrfToken,
      },
      req,
    );
  }

  @Post('totp')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleTotp(
    @CurrentRealm() realm: Realm,
    @Body() body: TotpDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const challengeToken = req.cookies?.['AUTHME_MFA_CHALLENGE'];
    if (!challengeToken) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('MFA session expired. Please login again.')}`,
      );
    }

    // Validate challenge and track attempt count (does not consume the challenge)
    const challenge =
      await this.mfaService.validateMfaChallengeWithAttemptCheck(
        challengeToken,
      );
    if (!challenge) {
      res.clearCookie('AUTHME_MFA_CHALLENGE', {
        path: `/realms/${realm.name}`,
      });
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('MFA session expired or too many failed attempts. Please login again.')}`,
      );
    }

    // Ensure the challenge was issued for this realm (prevents cross-realm token reuse)
    if (challenge.realmId !== realm.id) {
      this.logger.warn(
        `MFA cross-realm token use attempt: challenge realm ${challenge.realmId} used against realm ${realm.id}`,
      );
      res.clearCookie('AUTHME_MFA_CHALLENGE', {
        path: `/realms/${realm.name}`,
      });
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('MFA session expired. Please login again.')}`,
      );
    }

    // Check TOTP rate limit before processing
    const rateLimitCheck = await this.bruteForceService.checkTotpRateLimit(
      realm,
      challenge.userId,
    );
    if (rateLimitCheck.blocked) {
      this.logger.warn(
        `TOTP rate limit exceeded for user ${challenge.userId} in realm ${realm.id}`,
      );
      return res.redirect(
        `/realms/${realm.name}/totp?error=${encodeURIComponent('Too many failed attempts. Please try again later.')}`,
      );
    }

    const code = body.code;
    const recoveryCode = body.recoveryCode;

    let verified = false;
    if (code) {
      verified = await this.mfaService.verifyTotp(challenge.userId, code);
    } else if (recoveryCode) {
      verified = await this.mfaService.verifyRecoveryCode(
        challenge.userId,
        recoveryCode,
      );
    }

    if (!verified) {
      await this.bruteForceService.recordTotpFailure(
        realm,
        challenge.userId,
        resolveClientIp(req),
      );
      this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.MFA_VERIFY_ERROR,
        userId: challenge.userId,
        ipAddress: resolveClientIp(req),
        error: 'Invalid MFA code',
      });
      const remainingCheck = await this.bruteForceService.checkTotpRateLimit(
        realm,
        challenge.userId,
      );
      const errorMsg =
        remainingCheck.blocked || remainingCheck.remainingAttempts <= 2
          ? 'Too many failed attempts. Please try again later.'
          : 'Invalid code. Please try again.';
      return res.redirect(
        `/realms/${realm.name}/totp?error=${encodeURIComponent(errorMsg)}`,
      );
    }

    // MFA verified — consume the challenge and clear the cookie
    await this.mfaService.consumeMfaChallenge(challengeToken);
    res.clearCookie('AUTHME_MFA_CHALLENGE', { path: `/realms/${realm.name}` });

    // Reset TOTP failure tracking on successful verification
    await this.bruteForceService.resetTotpFailures(realm.id, challenge.userId);

    // MFA verified — complete login
    const user = await this.loginService.findUserById(challenge.userId);
    if (!user) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('User not found.')}`,
      );
    }

    return await this.completeLogin(
      realm,
      user,
      body as unknown as Record<string, unknown>,
      challenge.oauthParams ?? {},
      req,
      res,
    );
  }

  // ─── CHANGE PASSWORD (forced) ─────────────────────────────

  @Get('change-password')
  showChangePasswordForm(
    @CurrentRealm() realm: Realm,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const policyHints: string[] = [];
    if (realm.passwordMinLength > 1)
      policyHints.push(`At least ${realm.passwordMinLength} characters`);
    if (realm.passwordRequireUppercase)
      policyHints.push('At least one uppercase letter');
    if (realm.passwordRequireLowercase)
      policyHints.push('At least one lowercase letter');
    if (realm.passwordRequireDigits) policyHints.push('At least one digit');
    if (realm.passwordRequireSpecialChars)
      policyHints.push('At least one special character');

    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'change-password',
      {
        pageTitle: 'Change Password',
        token: query['token'] ?? '',
        error: query['error'] ?? '',
        info: query['info'] ?? '',
        policyHints: policyHints.length > 0 ? policyHints : null,
        csrfToken,
      },
      req,
    );
  }

  @Post('change-password')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleChangePassword(
    @CurrentRealm() realm: Realm,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const token = body.token;
    const currentPassword = body.currentPassword;
    const newPassword = body.newPassword;
    const confirmPassword = body.confirmPassword;

    const redirectBase = `/realms/${realm.name}/change-password?token=${token ?? ''}`;

    if (!token || !currentPassword || !newPassword) {
      return res.redirect(
        `${redirectBase}&error=${encodeURIComponent('All fields are required.')}`,
      );
    }

    if (newPassword !== confirmPassword) {
      return res.redirect(
        `${redirectBase}&error=${encodeURIComponent('New passwords do not match.')}`,
      );
    }

    // Validate token
    const tokenHash = this.crypto.sha256(token);
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });
    if (
      !record ||
      record.type !== 'change_password' ||
      record.expiresAt < new Date()
    ) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('Change password session expired. Please login again.')}`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user || !user.passwordHash) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('User not found.')}`,
      );
    }

    // Verify current password
    const valid = await this.crypto.verifyPassword(
      user.passwordHash,
      currentPassword,
    );
    if (!valid) {
      return res.redirect(
        `${redirectBase}&error=${encodeURIComponent('Current password is incorrect.')}`,
      );
    }

    // Validate new password against policy
    const validation = this.passwordPolicyService.validate(realm, newPassword);
    if (!validation.valid) {
      return res.redirect(
        `${redirectBase}&error=${encodeURIComponent(validation.errors.join('. '))}`,
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
          `${redirectBase}&error=${encodeURIComponent('Password was used recently. Choose a different password.')}`,
        );
      }
    }

    // Update password
    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    // Record history
    await this.passwordPolicyService.recordHistory(
      user.id,
      realm.id,
      passwordHash,
      realm.passwordHistoryCount,
    );

    // Consume the token
    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    const info = encodeURIComponent(
      'Password changed successfully. You can now sign in.',
    );
    res.redirect(`/realms/${realm.name}/login?info=${info}`);
  }

  // ─── CONSENT ────────────────────────────────────────────

  @Get('consent')
  async showConsentForm(
    @CurrentRealm() realm: Realm,
    @Query('req') reqId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!reqId) {
      throw new BadRequestException('Missing consent request ID');
    }

    const consentReq = await this.consentService.getConsentRequest(reqId);
    if (!consentReq) {
      throw new BadRequestException('Consent request expired or invalid');
    }

    const newReqId = await this.consentService.storeConsentRequest(consentReq);

    const scopeDescriptions = consentReq.scopes.map(
      (s) => SCOPE_DESCRIPTIONS[s] ?? s,
    );

    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'consent',
      {
        pageTitle: 'Grant Access',
        clientName: consentReq.clientName,
        scopes: scopeDescriptions,
        authReqId: newReqId,
        csrfToken,
      },
      req,
    );
  }

  @Post('consent')
  async handleConsent(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const reqId = body['auth_req_id'];
    if (!reqId) {
      throw new BadRequestException('Missing consent request ID');
    }

    const consentReq = await this.consentService.getConsentRequest(reqId);
    if (!consentReq) {
      throw new BadRequestException('Consent request expired or invalid');
    }

    if (body['action'] === 'deny') {
      const redirectUri = new URL(consentReq.oauthParams['redirect_uri']);
      redirectUri.searchParams.set('error', 'access_denied');
      redirectUri.searchParams.set(
        'error_description',
        'User denied the consent request',
      );
      if (consentReq.oauthParams['state']) {
        redirectUri.searchParams.set('state', consentReq.oauthParams['state']);
      }
      return res.redirect(302, redirectUri.toString());
    }

    await this.consentService.grantConsent(
      consentReq.userId,
      consentReq.clientId,
      consentReq.scopes,
    );

    const user = await this.loginService.findUserById(consentReq.userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const result = await this.oauthService.authorizeWithUser(
      realm,
      user,
      consentReq.oauthParams as unknown as AuthorizeParams,
    );

    res.redirect(302, result.redirectUrl);
  }

  // ─── REGISTRATION ──────────────────────────────────────

  @Get('register')
  async showRegistrationForm(
    @CurrentRealm() realm: Realm,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!realm.registrationAllowed) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('Registration is not allowed for this realm.')}`,
      );
    }

    const hints: string[] = [];
    if (realm.passwordMinLength > 1)
      hints.push(`at least ${realm.passwordMinLength} characters`);
    if (realm.passwordRequireUppercase) hints.push('an uppercase letter');
    if (realm.passwordRequireLowercase) hints.push('a lowercase letter');
    if (realm.passwordRequireDigits) hints.push('a digit');
    if (realm.passwordRequireSpecialChars) hints.push('a special character');

    const customAttributes =
      await this.customAttributesService.getRegistrationAttributes(realm.id);

    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'register',
      {
        pageTitle: 'Create Account',
        passwordMinLength: realm.passwordMinLength || 8,
        passwordHint: hints.length ? `Must contain ${hints.join(', ')}` : '',
        username: query['username'] ?? '',
        email: query['email'] ?? '',
        firstName: query['firstName'] ?? '',
        lastName: query['lastName'] ?? '',
        error: query['error'] ?? '',
        info: query['info'] ?? '',
        client_id: query['client_id'] ?? '',
        redirect_uri: query['redirect_uri'] ?? '',
        response_type: query['response_type'] ?? '',
        scope: query['scope'] ?? '',
        state: query['state'] ?? '',
        nonce: query['nonce'] ?? '',
        code_challenge: query['code_challenge'] ?? '',
        code_challenge_method: query['code_challenge_method'] ?? '',
        customAttributes: customAttributes.map((a) => ({
          name: a.name,
          displayName: a.displayName,
          type: a.type,
          required: a.required,
          options: a.options ?? [],
          value: query[`attr_${a.name}`] ?? '',
        })),
        termsOfServiceUrl: realm.termsOfServiceUrl ?? null,
        registrationApprovalRequired:
          realm.registrationApprovalRequired ?? false,
        csrfToken,
      },
      req,
    );
  }

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleRegistration(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    if (!realm.registrationAllowed) {
      return res.redirect(
        `/realms/${realm.name}/login?error=${encodeURIComponent('Registration is not allowed for this realm.')}`,
      );
    }

    const username = (body['username'] ?? '').trim();
    const email = (body['email'] ?? '').trim();
    const firstName = (body['firstName'] ?? '').trim();
    const lastName = (body['lastName'] ?? '').trim();
    const password = body['password'] ?? '';
    const confirmPassword = body['confirmPassword'] ?? '';

    // Preserve OAuth params through registration redirects
    const oauthParamNames = [
      'client_id',
      'redirect_uri',
      'response_type',
      'scope',
      'state',
      'nonce',
      'code_challenge',
      'code_challenge_method',
    ];
    const oauthParams = oauthParamNames
      .filter((p) => body[p])
      .map((p) => `${p}=${encodeURIComponent(body[p])}`)
      .join('&');
    const oauthSuffix = oauthParams ? `&${oauthParams}` : '';

    const preserveFields = oauthSuffix;

    if (!username || username.length < 2) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Username must be at least 2 characters.')}${preserveFields}`,
      );
    }

    const htmlPattern = /[<>]/;
    if (
      htmlPattern.test(username) ||
      htmlPattern.test(firstName) ||
      htmlPattern.test(lastName)
    ) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Fields must not contain HTML tags or angle brackets.')}${preserveFields}`,
      );
    }

    if (!email) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Email is required.')}${preserveFields}`,
      );
    }

    // Check allowed email domains
    if (realm.allowedEmailDomains.length > 0) {
      const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
      const allowed = realm.allowedEmailDomains.map((d: string) =>
        d.toLowerCase(),
      );
      if (!allowed.includes(emailDomain)) {
        return res.redirect(
          `/realms/${realm.name}/register?error=${encodeURIComponent(`Registration is only allowed for email domains: ${allowed.join(', ')}`)}${preserveFields}`,
        );
      }
    }

    // Terms of service acceptance
    if (realm.termsOfServiceUrl && !body['terms_accepted']) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('You must accept the terms of service to register.')}${preserveFields}`,
      );
    }

    if (!password) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Password is required.')}${preserveFields}`,
      );
    }

    if (password !== confirmPassword) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Passwords do not match.')}${preserveFields}`,
      );
    }

    // Validate against password policy
    const validation = this.passwordPolicyService.validate(realm, password);
    if (!validation.valid) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent(validation.errors.join('. '))}${preserveFields}`,
      );
    }

    // Validate required custom attributes before creating the user
    const registrationAttributes =
      await this.customAttributesService.getRegistrationAttributes(realm.id);
    for (const attr of registrationAttributes) {
      const value = (body[`attr_${attr.name}`] ?? '').trim();
      if (attr.required && !value) {
        return res.redirect(
          `/realms/${realm.name}/register?error=${encodeURIComponent(`'${attr.displayName}' is required.`)}${preserveFields}`,
        );
      }
    }

    // Check for duplicate username or email — use a generic message to prevent enumeration
    const existingByUsername = await this.prisma.user.findUnique({
      where: { realmId_username: { realmId: realm.id, username } },
    });
    const existingByEmail = await this.prisma.user.findUnique({
      where: { realmId_email: { realmId: realm.id, email } },
    });
    if (existingByUsername || existingByEmail) {
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('An account with that username or email already exists.')}${preserveFields}`,
      );
    }

    // If approval is required, create user as disabled
    const requiresApproval = realm.registrationApprovalRequired === true;

    // Create user
    const passwordHash = await this.crypto.hashPassword(password);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          realmId: realm.id,
          username,
          email,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          enabled: !requiresApproval,
          passwordHash,
          passwordChangedAt: new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return res.redirect(
          `/realms/${realm.name}/register?error=${encodeURIComponent('An account with that username or email already exists.')}${preserveFields}`,
        );
      }
      throw error;
    }

    // Record password history
    if (realm.passwordHistoryCount > 0) {
      await this.passwordPolicyService.recordHistory(
        user.id,
        realm.id,
        passwordHash,
        realm.passwordHistoryCount,
      );
    }

    // Save custom attribute values
    try {
      await this.customAttributesService.validateAndSaveRegistrationAttributes(
        realm,
        user.id,
        body,
      );
    } catch {
      // If attribute saving fails, clean up the user and redirect with error
      await this.prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
      return res.redirect(
        `/realms/${realm.name}/register?error=${encodeURIComponent('Failed to save custom attribute values. Please try again.')}${preserveFields}`,
      );
    }

    this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.REGISTER,
      userId: user.id,
    });

    // Send verification email
    if (email) {
      try {
        const configured = await this.emailService.isConfigured(realm.name);
        if (configured) {
          const rawToken = await this.verificationService.createToken(
            user.id,
            'email_verification',
            86400,
          );
          const baseUrl = this.config.get<string>(
            'BASE_URL',
            'http://localhost:3000',
          );
          const verifyUrl = `${baseUrl}/realms/${realm.name}/verify-email?token=${rawToken}`;

          const fullRealm = await this.prisma.realm.findUnique({
            where: { name: realm.name },
          });
          if (fullRealm) {
            const subject = this.themeEmail.getSubject(
              fullRealm,
              'verifyEmailSubject',
            );
            const html = this.themeEmail.renderEmail(
              fullRealm,
              'verify-email',
              { verifyUrl },
            );
            await this.emailService.sendEmail(realm.name, email, subject, html);
          }
        }
      } catch {
        // Don't block registration if email fails
      }
    }

    let message: string;
    if (requiresApproval) {
      message =
        'Account created successfully! Your account is pending approval by an administrator.';
    } else if (realm.requireEmailVerification) {
      message =
        'Account created successfully! Please check your email to verify your account, then sign in.';
    } else {
      message = 'Account created successfully! You can now sign in.';
    }
    const info = encodeURIComponent(message);
    res.redirect(`/realms/${realm.name}/login?info=${info}${oauthSuffix}`);
  }

  // ─── EMAIL VERIFICATION ─────────────────────────────────

  @Get('verify-email')
  async verifyEmail(
    @CurrentRealm() realm: Realm,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!token) {
      return this.themeRender.render(
        res,
        realm,
        'login',
        'verify-email',
        {
          pageTitle: 'Email Verification',
          success: false,
          error: 'Missing verification token.',
        },
        req,
      );
    }

    const result = await this.verificationService.validateToken(
      token,
      'email_verification',
    );
    if (!result) {
      return this.themeRender.render(
        res,
        realm,
        'login',
        'verify-email',
        {
          pageTitle: 'Email Verification',
          success: false,
          error: 'This verification link is invalid or has expired.',
        },
        req,
      );
    }

    await this.prisma.user.update({
      where: { id: result.userId },
      data: { emailVerified: true },
    });

    this.themeRender.render(
      res,
      realm,
      'login',
      'verify-email',
      {
        pageTitle: 'Email Verification',
        success: true,
      },
      req,
    );
  }

  // ─── FORGOT / RESET PASSWORD ────────────────────────────

  @Get('forgot-password')
  showForgotPasswordForm(
    @CurrentRealm() realm: Realm,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'forgot-password',
      {
        pageTitle: 'Forgot Password',
        info: query['info'] ?? '',
        error: query['error'] ?? '',
        csrfToken,
      },
      req,
    );
  }

  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleForgotPassword(
    @CurrentRealm() realm: Realm,
    @Body() body: ForgotPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const email = body.email;
    const successMessage = encodeURIComponent(
      'If an account with that email exists, we sent a password reset link.',
    );

    if (email) {
      const user = await this.prisma.user.findUnique({
        where: { realmId_email: { realmId: realm.id, email } },
      });

      if (user) {
        try {
          const configured = await this.emailService.isConfigured(realm.name);
          if (configured) {
            const rawToken = await this.verificationService.createToken(
              user.id,
              'password_reset',
              3600,
            );
            const baseUrl = this.config.get<string>(
              'BASE_URL',
              'http://localhost:3000',
            );
            const resetUrl = `${baseUrl}/realms/${realm.name}/reset-password?token=${rawToken}`;

            const fullRealm = await this.prisma.realm.findUnique({
              where: { name: realm.name },
            });
            if (fullRealm) {
              const subject = this.themeEmail.getSubject(
                fullRealm,
                'resetPasswordSubject',
              );
              const html = this.themeEmail.renderEmail(
                fullRealm,
                'reset-password',
                { resetUrl },
              );
              await this.emailService.sendEmail(
                realm.name,
                email,
                subject,
                html,
              );
            }
          }
        } catch {
          // Don't reveal email sending errors to the user
        }
      }
    }

    res.redirect(
      `/realms/${realm.name}/forgot-password?info=${successMessage}`,
    );
  }

  @Get('reset-password')
  async showResetPasswordForm(
    @CurrentRealm() realm: Realm,
    @Query('token') token: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!token) {
      return this.themeRender.render(
        res,
        realm,
        'login',
        'reset-password',
        {
          pageTitle: 'Reset Password',
          error: 'Missing reset token.',
          token: '',
        },
        req,
      );
    }

    const tokenHash = this.crypto.sha256(token);
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (
      !record ||
      record.type !== 'password_reset' ||
      record.expiresAt < new Date()
    ) {
      return this.themeRender.render(
        res,
        realm,
        'login',
        'reset-password',
        {
          pageTitle: 'Reset Password',
          error: 'This reset link is invalid or has expired.',
          token: '',
        },
        req,
      );
    }

    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'reset-password',
      {
        pageTitle: 'Reset Password',
        token,
        error: error ?? '',
        csrfToken,
      },
      req,
    );
  }

  @Post('reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimitByIp()
  async handleResetPassword(
    @CurrentRealm() realm: Realm,
    @Body() body: ResetPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.validateCsrf(realm, body, req);
    const token = body.token;
    const password = body.password;
    const confirmPassword = body.confirmPassword;

    if (!token || !password) {
      return res.redirect(
        `/realms/${realm.name}/reset-password?token=${token ?? ''}&error=${encodeURIComponent('Missing required fields.')}`,
      );
    }

    if (password !== confirmPassword) {
      return res.redirect(
        `/realms/${realm.name}/reset-password?token=${token}&error=${encodeURIComponent('Passwords do not match.')}`,
      );
    }

    // Validate against password policy
    const validation = this.passwordPolicyService.validate(realm, password);
    if (!validation.valid) {
      return res.redirect(
        `/realms/${realm.name}/reset-password?token=${token}&error=${encodeURIComponent(validation.errors.join('. '))}`,
      );
    }

    const result = await this.verificationService.validateToken(
      token,
      'password_reset',
    );
    if (!result) {
      return res.redirect(
        `/realms/${realm.name}/reset-password?error=${encodeURIComponent('This reset link is invalid or has expired.')}`,
      );
    }

    const passwordHash = await this.crypto.hashPassword(password);
    await this.prisma.user.update({
      where: { id: result.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    // Record password history
    const user = await this.prisma.user.findUnique({
      where: { id: result.userId },
    });
    if (user) {
      await this.passwordPolicyService.recordHistory(
        user.id,
        realm.id,
        passwordHash,
        realm.passwordHistoryCount,
      );
    }

    this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.PASSWORD_RESET,
      userId: result.userId,
    });

    const info = encodeURIComponent(
      'Your password has been reset. You can now sign in.',
    );
    res.redirect(`/realms/${realm.name}/login?info=${info}`);
  }
}
