import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { Public } from '../common/decorators/public.decorator.js';
import { AdminAuthService } from './admin-auth.service.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { AdminLoginDto } from './dto/login.dto.js';
import { AdminApiKeyLoginDto } from './dto/api-key-login.dto.js';
import {
  AdminMfaCodeDto,
  AdminMfaLoginDto,
  AdminMfaPasskeyLoginDto,
  AdminMfaTokenDto,
  AdminPasskeyAssertionDto,
} from './dto/mfa.dto.js';
import {
  AdminMfaExempt,
  AdminScope,
} from '../common/decorators/admin-access.decorator.js';
import {
  AdminPrincipalService,
  type AuthenticatedAdmin,
} from '../admin-rbac/admin-principal.service.js';
import {
  REALM_ADMIN,
  SUPER_ADMIN,
  VIEW_ONLY,
  type AdminPrincipal,
} from '../admin-rbac/admin-access-policy.js';
import { AdminMfaService } from '../admin-mfa/admin-mfa.service.js';
import { ACR_MFA, ACR_PASSWORD, satisfiesAcr } from '../authn-core/acr.js';
import {
  ADMIN_RT_COOKIE,
  bearerTokenOf,
  setAdminSessionCookie,
} from './admin-session-cookie.js';

type AdminRequest = Request & {
  adminUser?: AuthenticatedAdmin;
  adminPrincipal?: AdminPrincipal;
};

@ApiTags('Admin Auth')
@Controller('admin/auth')
@ApiSecurity('admin-api-key')
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly config: ConfigService,
    private readonly principals: AdminPrincipalService,
    private readonly adminMfa: AdminMfaService,
  ) {}

  @Get('demo-info')
  @Public()
  @ApiOperation({
    summary: 'Demo-mode login hint',
    description:
      'Returns the demo credentials so the login page can prefill them, ' +
      'but only when DEMO_MODE=true. On normal self-hosted installs this ' +
      'returns { demo: false } and exposes nothing.',
  })
  @ApiResponse({ status: 200, description: 'Demo info' })
  getDemoInfo() {
    if (this.config.get<string>('DEMO_MODE') !== 'true') {
      return { demo: false };
    }
    // No fallback password: without ADMIN_PASSWORD the first admin got a
    // generated one, which is never handed out here.
    const password = this.config.get<string>('ADMIN_PASSWORD');
    return {
      demo: true,
      username: this.config.get<string>('ADMIN_USER', 'admin'),
      ...(password ? { password } : {}),
    };
  }

  @Post('login')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login',
    description:
      'With a second factor set up, returns `{ mfa_required, mfa_token, methods }` ' +
      'and no token: finish with POST /admin/auth/login/mfa or /login/passkey. ' +
      'Without one, returns the token; `mfa_enrolment_required` means MFA is ' +
      'required for every admin and the token only reaches enrolment.',
  })
  @ApiResponse({ status: 200, description: 'Token, or the second step' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() body: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = resolveClientIp(req);

    const { rateLimitHeaders, ...result } = await this.adminAuthService.login(
      body.username,
      body.password,
      ip,
    );

    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      res.setHeader(name, value);
    }

    if ('access_token' in result) {
      setAdminSessionCookie(res, result.access_token, this.config);
    }
    return result;
  }

  @Post('login/mfa')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login, second step: authenticator or recovery code',
  })
  @ApiResponse({ status: 200, description: 'Signed in, returns token' })
  @ApiResponse({
    status: 401,
    description: 'Wrong code, or the sign-in expired or ran out of attempts',
  })
  @ApiResponse({ status: 429, description: 'Account locked' })
  async loginMfa(
    @Body() body: AdminMfaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rateLimitHeaders, ...token } =
      await this.adminAuthService.completeMfaLogin(
        body.mfa_token,
        body.method,
        body.code,
        resolveClientIp(req),
      );
    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      res.setHeader(name, value);
    }
    setAdminSessionCookie(res, token.access_token, this.config);
    return token;
  }

  @Post('login/passkey/options')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login, second step: passkey request options',
  })
  @ApiResponse({ status: 200, description: 'WebAuthn request options' })
  loginPasskeyOptions(@Body() body: AdminMfaTokenDto, @Req() req: Request) {
    return this.adminAuthService.mfaLoginPasskeyOptions(
      body.mfa_token,
      resolveClientIp(req),
    );
  }

  @Post('login/passkey')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login, second step: passkey' })
  @ApiResponse({ status: 200, description: 'Signed in, returns token' })
  @ApiResponse({ status: 401, description: 'Passkey not accepted' })
  async loginPasskey(
    @Body() body: AdminMfaPasskeyLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rateLimitHeaders, ...token } =
      await this.adminAuthService.completeMfaLoginWithPasskey(
        body.mfa_token,
        body.response as unknown as AuthenticationResponseJSON,
        resolveClientIp(req),
      );
    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      res.setHeader(name, value);
    }
    setAdminSessionCookie(res, token.access_token, this.config);
    return token;
  }

  @Post('step-up')
  @AdminScope('self')
  @AdminMfaExempt('always')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify your second factor again (step-up)',
    description:
      'Returns a new token with a fresh auth_time, for actions that need a ' +
      'recent MFA check. The token it replaces is revoked.',
  })
  @ApiResponse({ status: 200, description: 'New token' })
  @ApiResponse({ status: 400, description: 'Wrong code' })
  @ApiResponse({ status: 429, description: 'Account locked' })
  async stepUp(
    @Body() body: AdminMfaCodeDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = resolveClientIp(req);
    const token = await this.adminAuthService.stepUp(
      this.adminOf(req),
      bearerTokenOf(req),
      (userId) => this.adminMfa.verifyCode(userId, body.method, body.code, ip),
    );
    setAdminSessionCookie(res, token.access_token, this.config);
    return token;
  }

  @Post('step-up/passkey/options')
  @AdminScope('self')
  @AdminMfaExempt('always')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passkey request options for a step-up' })
  stepUpPasskeyOptions(@Req() req: AdminRequest) {
    const admin = this.adminOf(req);
    return this.adminMfa.passkeyOptions(
      admin.userId,
      this.adminMfa.stepUpBinding(admin.userId),
    );
  }

  @Post('step-up/passkey')
  @AdminScope('self')
  @AdminMfaExempt('always')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify your passkey again (step-up)' })
  @ApiResponse({ status: 200, description: 'New token' })
  async stepUpPasskey(
    @Body() body: AdminPasskeyAssertionDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = resolveClientIp(req);
    const token = await this.adminAuthService.stepUp(
      this.adminOf(req),
      bearerTokenOf(req),
      (userId) =>
        this.adminMfa.verifyPasskey(
          userId,
          body.response as unknown as AuthenticationResponseJSON,
          this.adminMfa.stepUpBinding(userId),
          ip,
        ),
    );
    setAdminSessionCookie(res, token.access_token, this.config);
    return token;
  }

  @Post('login-with-api-key')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange admin API key for a session token' })
  @ApiResponse({
    status: 200,
    description: 'Returns bearer token and sets session cookie',
  })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async loginWithApiKey(
    @Body() body: AdminApiKeyLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokenResponse = await this.adminAuthService.createAdminSession(
      body.apiKey,
    );
    setAdminSessionCookie(res, tokenResponse.access_token, this.config);
    return tokenResponse;
  }

  @Get('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rehydrate admin session from httpOnly cookie' })
  @ApiResponse({
    status: 200,
    description: 'Session refreshed, returns access token',
  })
  @ApiResponse({ status: 401, description: 'No valid session cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string | undefined>)[
      ADMIN_RT_COOKIE
    ];
    if (!token) {
      throw new UnauthorizedException('No session cookie');
    }

    try {
      await this.adminAuthService.validateAdminToken(token, req);
    } catch {
      res.clearCookie(ADMIN_RT_COOKIE, { path: '/admin/auth' });
      throw new UnauthorizedException('Session expired');
    }

    return { access_token: token, token_type: 'Bearer' };
  }

  @Post('logout')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin logout – revoke current token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const bearer = bearerTokenOf(req);
    if (bearer) {
      await this.adminAuthService.revokeToken(bearer);
    }
    const cookieToken = (req.cookies as Record<string, string | undefined>)[
      ADMIN_RT_COOKIE
    ];
    if (cookieToken) {
      await this.adminAuthService
        .revokeToken(cookieToken)
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to revoke cookie token: ${(err as Error).message}`,
          ),
        );
    }
    res.clearCookie(ADMIN_RT_COOKIE, { path: '/admin/auth' });
    return { message: 'Logged out' };
  }

  /**
   * Who am I: the signed-in admin's roles and realm scope, as the
   * authorization step sees them (from the database, not the token), and
   * where the session stands on MFA. Not public: authentication must run so
   * that there is someone to describe. Reachable with a password-only token,
   * so the console can send the admin to enrolment or step-up.
   */
  @Get('me')
  @AdminScope('self')
  @AdminMfaExempt('always')
  @ApiOperation({ summary: 'Get the signed-in admin, its roles and scope' })
  @ApiResponse({ status: 200, description: 'Current admin user info' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: AdminRequest) {
    const principal = req.adminPrincipal;
    if (!principal) {
      throw new UnauthorizedException('Not authenticated');
    }
    const superAdmin = principal.roles.includes(SUPER_ADMIN);
    const admin = req.adminUser;
    const user = principal.kind === 'user';
    const policy = user ? await this.adminMfa.policy() : null;
    return {
      userId: principal.userId,
      username: principal.username,
      kind: principal.kind,
      roles: principal.roles,
      superAdmin,
      /** Reads every realm (super-admin or view-only). */
      readAllRealms: superAdmin || principal.roles.includes(VIEW_ONLY),
      /** Changes every realm and runs server-wide operations. */
      writeAllRealms: superAdmin,
      /** Realms managed as a realm-admin (never master). */
      managedRealms: principal.roles.includes(REALM_ADMIN)
        ? await this.principals.realmNames(principal.realmIds)
        : [],
      /** Console MFA; null for the API key, which has no second factor. */
      mfa:
        user && policy
          ? {
              enrolled: principal.mfaEnrolled === true,
              required: policy.required,
              /** This session proved a second factor. */
              verified: satisfiesAcr(admin?.acr ?? ACR_PASSWORD, ACR_MFA),
              amr: admin?.amr ?? [],
              authTime: admin?.authTime ?? null,
            }
          : null,
    };
  }

  private adminOf(req: AdminRequest): AuthenticatedAdmin {
    const admin = req.adminUser;
    if (!admin?.userId) throw new UnauthorizedException('Not authenticated');
    return admin;
  }
}
