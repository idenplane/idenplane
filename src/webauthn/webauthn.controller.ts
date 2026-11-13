import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiExcludeController, ApiResponse } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { WebAuthnService } from './webauthn.service.js';
import { LoginService } from '../login/login.service.js';
import { OAuthService } from '../oauth/oauth.service.js';
import { ConsentService } from '../consent/consent.service.js';
import {
  StartRegistrationDto,
  VerifyRegistrationDto,
  StartAuthenticationDto,
  VerifyAuthenticationDto,
} from './webauthn.dto.js';
import { ACR_WEBAUTHN } from '../authn-core/acr.js';
import {
  SESSION_COOKIE,
  WEBAUTHN_LOGIN_COOKIE,
} from '../authn-core/cookies.js';
import type { AuthorizeParams } from '../authn-core/oauth-params.js';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { FlowRuntimeService } from '../auth-flow/flow-runtime.service.js';
import { LoginFlowService } from '../login/login-flow.service.js';
import { PrimaryAuthGatesService } from '../login/primary-auth-gates.service.js';
import { loginFormParamKeys } from '../authn-core/acr-enforcement.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { pickOAuthParams } from '../authn-core/oauth-params.js';

@ApiExcludeController()
@Controller('realms/:realmName')
@UseGuards(RealmGuard)
@Public()
export class WebAuthnController {
  constructor(
    private readonly webAuthnService: WebAuthnService,
    private readonly loginService: LoginService,
    private readonly oauthService: OAuthService,
    private readonly consentService: ConsentService,
    private readonly flowRuntime: FlowRuntimeService,
    private readonly loginFlow: LoginFlowService,
    private readonly primaryAuthGates: PrimaryAuthGatesService,
  ) {}

  private async getSessionUser(realm: Realm, req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- express Request.cookies typed as any
    const sessionToken = req.cookies?.[SESSION_COOKIE];
    if (!sessionToken) return null;

    return this.loginService.validateLoginSession(
      realm,
      sessionToken as string,
    );
  }

  // ─── Registration ──────────────────────────────────────────────

  @Post('webauthn/register/options')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'WebAuthn registration options (challenge, rp, user)',
  })
  @ApiResponse({
    status: 400,
    description: 'User must be signed in to register a passkey',
  })
  async startRegistration(
    @CurrentRealm() realm: Realm,
    @Body() body: StartRegistrationDto,
    @Req() req: Request,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      throw new BadRequestException(
        'You must be signed in to register a passkey',
      );
    }

    return this.webAuthnService.generateRegistrationOptions(user, realm);
  }

  @Post('webauthn/register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Credential registered; returns credential metadata',
  })
  @ApiResponse({
    status: 400,
    description: 'User must be signed in, or attestation verification failed',
  })
  async completeRegistration(
    @CurrentRealm() realm: Realm,
    @Body() body: VerifyRegistrationDto,
    @Req() req: Request,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      throw new BadRequestException(
        'You must be signed in to register a passkey',
      );
    }

    const credential = await this.webAuthnService.verifyRegistration(
      user,
      realm,
      body.response as RegistrationResponseJSON,
      body.friendlyName,
    );

    return {
      id: credential.id,
      credentialId: credential.credentialId,
      friendlyName: credential.friendlyName,
      deviceType: credential.deviceType,
      createdAt: credential.createdAt,
    };
  }

  // ─── Authentication ────────────────────────────────────────────

  @Post('webauthn/authenticate/options')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description:
      'WebAuthn authentication options (challenge, allowCredentials)',
  })
  @ApiResponse({ status: 400, description: 'Bad request — realm not found' })
  async startAuthentication(
    @CurrentRealm() realm: Realm,
    @Body() body: StartAuthenticationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Inside a custom-flow login, the challenge is for the user the flow has
    // identified (if any), whatever the body names.
    const flow = await this.flowRuntime.passkeyChallengeUser(realm, req);
    // Look up userId if username given (for autofill / non-resident-key flow)
    let userId: string | undefined;
    if (flow.active) {
      userId = flow.userId;
    } else if (body.username) {
      const user = await this.loginService.findUserByUsername(
        realm,
        body.username,
      );
      userId = user?.id;
    }

    // Bind the challenge to this browser, so concurrent sign-ins in the realm
    // (or anyone calling this endpoint) cannot replace each other's.
    const binding = randomBytes(32).toString('base64url');
    res.cookie(WEBAUTHN_LOGIN_COOKIE, binding, {
      httpOnly: true,
      secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
      sameSite: 'strict',
      maxAge: 5 * 60 * 1000,
      path: `/realms/${realm.name}`,
    });
    return this.webAuthnService.generateAuthenticationOptions(
      realm,
      userId,
      binding,
    );
  }

  @Post('webauthn/authenticate/verify')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Authentication verified; returns redirectUrl',
  })
  @ApiResponse({
    status: 400,
    description: 'Assertion verification failed or invalid credential',
  })
  @ApiResponse({
    status: 401,
    description: 'Credential not found or does not belong to any user',
  })
  async completeAuthentication(
    @CurrentRealm() realm: Realm,
    @Body() body: VerifyAuthenticationDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const binding = req.cookies?.[WEBAUTHN_LOGIN_COOKIE] as string | undefined;
    // A bound login runs this as its webauthn step (or refuses it).
    if (
      await this.flowRuntime.dispatch(
        realm,
        {
          endpoint: 'webauthn',
          response: body.response as AuthenticationResponseJSON,
          binding,
          clientId: body.client_id,
        },
        req,
        res,
      )
    ) {
      return;
    }
    if (!binding) {
      throw new BadRequestException(
        'Authentication challenge expired or not found. Please try again.',
      );
    }
    res.clearCookie(WEBAUTHN_LOGIN_COOKIE, { path: `/realms/${realm.name}` });
    const { user } = await this.webAuthnService.verifyAuthentication(
      realm,
      body.response as AuthenticationResponseJSON,
      binding,
      // The same account gate as a password sign-in, checked before the
      // sign-in counts as a use of the passkey. (Password expiry does not
      // apply: no password was used.)
      (candidate) => {
        if (
          realm.requireEmailVerification &&
          candidate.email &&
          !candidate.emailVerified
        ) {
          throw new ForbiddenException(
            'Please verify your email address before signing in.',
          );
        }
      },
    );

    // The same OAuth parameters the login form carries, prompt included
    // (and what is asked of `acr`, with ENFORCE_ACR_ON_FRESH_LOGIN).
    const oauthParams = pickOAuthParams(
      body as unknown as Record<string, string | undefined>,
      loginFormParamKeys(),
    );

    // Validate the authorization request before any session exists, as the
    // password sign-in does (its error goes back to the login page).
    if (oauthParams['client_id']) {
      try {
        await this.oauthService.validateAuthRequest(
          realm,
          oauthParams as unknown as AuthorizeParams,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return res.json({
          redirectUrl: `/realms/${realm.name}/login?error=${encodeURIComponent(message)}`,
        });
      }
    }

    // The account gates of a password sign-in, in the same order: risk
    // assessment (a block ends the sign-in; a step-up is met, a passkey being
    // the strongest level) and email verification. Password expiry does not
    // apply: no password was used.
    const gates = await this.primaryAuthGates.evaluate(realm, user, {
      ipAddress: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      deviceFingerprint: null,
      form: oauthParams,
      skipPasswordExpiry: true,
    });
    if (gates.kind === 'block') {
      return res.json({ redirectUrl: gates.redirectUrl });
    }

    // Passwordless WebAuthn assertion: the hardware authenticator is the sole
    // factor, so amr is `['hwk']` (RFC 8176). ACR reflects the WebAuthn level.
    // Session, event, consent, the client's required ACR and the code: the
    // same completion as a password sign-in.
    const redirectUrl = await this.loginFlow.finishLogin(
      realm,
      user,
      oauthParams,
      req,
      res,
      { acr: ACR_WEBAUTHN, amr: ['hwk'] },
      { rememberMe: !!body.rememberMe },
    );
    return res.json({ redirectUrl });
  }

  // ─── Account — Credential Management ──────────────────────────

  @Get('account/webauthn/credentials')
  @ApiResponse({
    status: 200,
    description: 'List of registered passkeys for the current user',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to login when no active session exists',
  })
  async listCredentials(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      return res.redirect(`/realms/${realm.name}/login`);
    }

    const credentials = await this.webAuthnService.getUserCredentials(user.id);
    return res.json(
      credentials.map((c) => ({
        id: c.id,
        friendlyName: c.friendlyName,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        transports: c.transports,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
      })),
    );
  }

  @Delete('account/webauthn/credentials/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Credential removed successfully' })
  @ApiResponse({
    status: 400,
    description: 'User must be signed in to remove a passkey',
  })
  @ApiResponse({ status: 404, description: 'Credential not found' })
  async removeCredential(
    @CurrentRealm() realm: Realm,
    @Param('credentialId') credentialId: string,
    @Req() req: Request,
  ) {
    const user = await this.getSessionUser(realm, req);
    if (!user) {
      throw new BadRequestException(
        'You must be signed in to remove a passkey',
      );
    }

    await this.webAuthnService.removeCredential(
      user.id,
      realm.id,
      credentialId,
    );
  }
}
