import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  AdminMfaExempt,
  AdminScope,
  RequireRecentAdminMfa,
} from '../common/decorators/admin-access.decorator.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import {
  bearerTokenOf,
  setAdminSessionCookie,
} from '../admin-auth/admin-session-cookie.js';
import type { AuthenticatedAdmin } from '../admin-rbac/admin-principal.service.js';
import {
  ADMIN_MFA_REFUSAL_MESSAGES,
  decideAdminMfa,
  MASTER_REALM,
} from '../admin-rbac/admin-access-policy.js';
import { ACR_MFA, ACR_PASSWORD, satisfiesAcr } from '../authn-core/acr.js';
import {
  AdminMfaService,
  proofFor,
  type AdminMfaActor,
} from './admin-mfa.service.js';
import {
  ActivateAdminTotpDto,
  RegisterAdminPasskeyDto,
  SetAdminMfaPolicyDto,
} from './dto/admin-mfa.dto.js';

type AdminRequest = Request & { adminUser?: AuthenticatedAdmin };

function actorOf(req: AdminRequest): AdminMfaActor {
  const userId = req.adminUser?.userId;
  if (!userId) throw new UnauthorizedException('Not authenticated');
  return { userId, ipAddress: resolveClientIp(req) };
}

/**
 * The signed-in admin's own console second factors
 * (docs/docs/security/admin-mfa.md). Own account only. Enrolling a first
 * factor is open to a password-only session; everything that removes or
 * replaces a factor needs a recent MFA check.
 */
@ApiTags('Admin MFA')
@ApiSecurity('admin-api-key')
@ApiBearerAuth()
@Controller('admin/auth/mfa')
@AdminScope('self')
export class AdminMfaController {
  constructor(
    private readonly adminMfa: AdminMfaService,
    private readonly adminAuth: AdminAuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The admin user behind the request; the API key has no factors. */
  private async self(req: AdminRequest): Promise<User> {
    const userId = req.adminUser?.userId;
    if (!userId) throw new UnauthorizedException('Not authenticated');
    if (userId.startsWith('api-key:')) {
      throw new BadRequestException(
        'The admin API key is not an account and has no second factor',
      );
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realm: { name: MASTER_REALM } },
    });
    if (!user) throw new NotFoundException('Admin account not found');
    return user;
  }

  /**
   * After the first factor is enrolled, the session gets a token with MFA
   * claims: the admin just proved the factor. A later factor changes
   * nothing (the session already had to be MFA-verified to add it).
   */
  private async upgradeSession(
    req: AdminRequest,
    res: Response,
    userId: string,
    method: 'totp' | 'passkey',
  ) {
    const token = await this.adminAuth.reissue(
      userId,
      bearerTokenOf(req),
      proofFor(method),
    );
    setAdminSessionCookie(res, token.access_token, this.config);
    return token;
  }

  @Get()
  @AdminMfaExempt('always')
  @ApiOperation({ summary: 'Your second factors and the MFA requirement' })
  async status(@Req() req: AdminRequest) {
    const user = await this.self(req);
    const status = await this.adminMfa.status(user.id);
    return {
      ...status,
      session: {
        verified: satisfiesAcr(req.adminUser?.acr ?? ACR_PASSWORD, ACR_MFA),
        authTime: req.adminUser?.authTime ?? null,
      },
    };
  }

  @Post('totp')
  @AdminMfaExempt('first-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start setting up an authenticator app',
    description:
      'Returns the secret, an otpauth:// URL and a QR code. Nothing is active until POST /admin/auth/mfa/totp/activate.',
  })
  @ApiResponse({
    status: 409,
    description: 'An authenticator app is already set up',
  })
  async startTotp(@Req() req: AdminRequest) {
    const user = await this.self(req);
    return this.adminMfa.startTotp(user);
  }

  @Post('totp/activate')
  @AdminMfaExempt('first-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate the authenticator app with its first code',
    description:
      'For a first factor, returns the recovery codes (shown once) and a new token with MFA claims.',
  })
  @ApiResponse({ status: 400, description: 'Wrong code' })
  async activateTotp(
    @Body() body: ActivateAdminTotpDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.self(req);
    const first = !AdminMfaService.hasFactor(
      await this.adminMfa.factors(user.id),
    );
    const result = await this.adminMfa.activateTotp(
      user.id,
      body.code,
      actorOf(req),
    );
    if (!result) {
      throw new BadRequestException(
        'Invalid code: check the time on your device and try again',
      );
    }
    return {
      recoveryCodes: result.recoveryCodes,
      ...(first ? await this.upgradeSession(req, res, user.id, 'totp') : {}),
    };
  }

  @Delete('totp')
  @RequireRecentAdminMfa()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove your authenticator app' })
  @ApiResponse({
    status: 409,
    description: 'MFA is required and it is your last factor',
  })
  async removeTotp(@Req() req: AdminRequest) {
    const user = await this.self(req);
    await this.adminMfa.removeTotp(user.id, actorOf(req));
  }

  @Post('passkeys/options')
  @AdminMfaExempt('first-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WebAuthn creation options for a new passkey' })
  async passkeyOptions(@Req() req: AdminRequest) {
    const user = await this.self(req);
    return this.adminMfa.passkeyRegistrationOptions(user);
  }

  @Post('passkeys')
  @AdminMfaExempt('first-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a passkey',
    description:
      'For a first factor, returns the recovery codes (shown once) and a new token with MFA claims.',
  })
  async registerPasskey(
    @Body() body: RegisterAdminPasskeyDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.self(req);
    const first = !AdminMfaService.hasFactor(
      await this.adminMfa.factors(user.id),
    );
    const result = await this.adminMfa.registerPasskey(
      user,
      body.response as unknown as RegistrationResponseJSON,
      body.name,
      actorOf(req),
    );
    return {
      ...result,
      ...(first ? await this.upgradeSession(req, res, user.id, 'passkey') : {}),
    };
  }

  @Delete('passkeys/:id')
  @RequireRecentAdminMfa()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of your passkeys' })
  async removePasskey(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AdminRequest,
  ) {
    const user = await this.self(req);
    await this.adminMfa.removePasskey(user.id, id, actorOf(req));
  }

  @Post('recovery-codes')
  @RequireRecentAdminMfa()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace your recovery codes',
    description: 'The old codes stop working. The new ones are shown once.',
  })
  async regenerateRecoveryCodes(@Req() req: AdminRequest) {
    const user = await this.self(req);
    return {
      recoveryCodes: await this.adminMfa.regenerateRecoveryCodes(
        user.id,
        actorOf(req),
      ),
    };
  }
}

/**
 * Super-admin: the server-wide MFA requirement and resetting another admin's
 * factors. Server-wide routes (super-admin or the admin API key). A reset by
 * an admin user needs that admin's own recent MFA check; the API key may
 * reset as break-glass. Every change is recorded as an admin event.
 */
@ApiTags('Admin MFA')
@ApiSecurity('admin-api-key')
@ApiBearerAuth()
@Controller('admin')
@AdminScope('global')
@ApiResponse({ status: 403, description: 'The super-admin role is required' })
export class AdminMfaManagementController {
  constructor(private readonly adminMfa: AdminMfaService) {}

  @Get('admin-mfa/policy')
  @ApiOperation({ summary: 'Whether every admin must use a second factor' })
  policy() {
    return this.adminMfa.policy();
  }

  @Put('admin-mfa/policy')
  @ApiOperation({
    summary: 'Require (or stop requiring) a second factor for every admin',
    description:
      'Refused with 409 when ADMIN_MFA_REQUIRED fixes it. Turning it off needs a recent MFA check.',
  })
  @ApiResponse({ status: 409, description: 'Set by ADMIN_MFA_REQUIRED' })
  async setPolicy(
    @Body() body: SetAdminMfaPolicyDto,
    @Req() req: AdminRequest,
  ) {
    // Weakening the policy is a sensitive action; turning it on is not.
    if (!body.required) assertRecentAdminMfa(req.adminUser);
    return this.adminMfa.setPolicy(body.required, actorOf(req));
  }

  @Delete('admin-accounts/:userId/mfa')
  @RequireRecentAdminMfa()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Reset an admin's second factors (break-glass)",
    description:
      'Removes the TOTP, passkeys and recovery codes; the admin signs in with the password and enrols again. Allowed with the admin API key. Always recorded as an admin event.',
  })
  @ApiResponse({ status: 404, description: 'Admin account not found' })
  async reset(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AdminRequest,
  ) {
    await this.adminMfa.reset(userId, actorOf(req));
  }
}

/**
 * The recent-MFA check for a handler that needs it only sometimes. The API
 * key is not a user and passes, as with `@RequireRecentAdminMfa()`.
 */
export function assertRecentAdminMfa(admin: AuthenticatedAdmin | undefined) {
  if (!admin) throw new UnauthorizedException('Not authenticated');
  if (admin.userId.startsWith('api-key:')) return;
  const refusal = decideAdminMfa(
    {
      tokenMfa: satisfiesAcr(admin.acr ?? ACR_PASSWORD, ACR_MFA),
      authTime: admin.authTime,
      now: Math.floor(Date.now() / 1000),
      // Only the recency is asked here; enrolment is the guard's job.
      enrolled: false,
      required: false,
    },
    { mfaExempt: null, recentMfa: true },
  );
  if (refusal) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: refusal,
      message: ADMIN_MFA_REFUSAL_MESSAGES[refusal],
    });
  }
}
