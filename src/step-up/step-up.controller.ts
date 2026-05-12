import {
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Realm } from '@prisma/client';
import {
  StepUpService,
  ACR_MFA,
  ACR_WEBAUTHN,
  ACR_PASSWORD,
} from './step-up.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import { LoginService } from '../login/login.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';

@ApiTags('Step-Up Authentication')
@Controller('realms/:realmName/step-up')
@UseGuards(RealmGuard)
@Public()
export class StepUpController {
  private readonly logger = new Logger(StepUpController.name);

  constructor(
    private readonly stepUpService: StepUpService,
    private readonly prisma: PrismaService,
    private readonly mfaService: MfaService,
    private readonly loginService: LoginService,
    private readonly crypto: CryptoService,
    private readonly webAuthnService: WebAuthnService,
  ) {}

  /**
   * GET /realms/:realm/step-up/challenge?acr=...&client_id=...
   *
   * Initiates a step-up flow for the current SSO session.  Returns the
   * challenge type and, when the required level is MFA, an mfa_token to be
   * used with the verify endpoint.
   *
   * The session token is read from the `AUTHME_SESSION` cookie rather than a
   * query parameter.  Passing security-sensitive tokens in the URL exposes
   * them in server access logs, browser history, and HTTP Referer headers.
   */
  @Get('challenge')
  @ApiOperation({ summary: 'Initiate step-up authentication challenge' })
  @ApiQuery({ name: 'acr', required: true, description: 'Required ACR value' })
  @ApiQuery({
    name: 'client_id',
    required: true,
    description: 'OAuth client_id',
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge details (type, mfa_token) or satisfied status',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request — missing parameters, unsupported ACR, or MFA not enrolled',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired session token' })
  async challenge(
    @CurrentRealm() realm: Realm,
    @Query('acr') requiredAcr: string,
    @Query('client_id') clientId: string,
    @Req() req: Request,
  ) {
    // Read the session token from the HttpOnly cookie so it is never exposed
    // in URLs (access logs, browser history, Referer headers).
    const sessionToken: string | undefined = (req as any).cookies
      ?.AUTHME_SESSION;

    if (!requiredAcr || !clientId || !sessionToken) {
      throw new BadRequestException(
        'acr and client_id are required; session must be provided via the AUTHME_SESSION cookie',
      );
    }

    // Validate the SSO session
    const user = await this.loginService.validateLoginSession(
      realm,
      sessionToken,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Look up the login session record to get its ID
    const loginSession = await this.getLoginSessionByToken(sessionToken);
    if (!loginSession) {
      throw new UnauthorizedException('Session not found');
    }

    // Check if already satisfied (cached)
    const alreadySatisfied = await this.stepUpService.isStepUpCached(
      loginSession.id,
      requiredAcr,
    );
    if (alreadySatisfied) {
      return { status: 'satisfied', acr: requiredAcr };
    }

    // Determine what the user needs to do
    if (requiredAcr === ACR_MFA) {
      const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
      if (!mfaEnabled) {
        throw new BadRequestException(
          'MFA is not set up for this account. Please enroll in MFA first.',
        );
      }
      const mfaToken = await this.mfaService.createMfaChallenge(
        user.id,
        realm.id,
      );
      return {
        status: 'challenge_required',
        challenge_type: 'totp',
        acr: requiredAcr,
        mfa_token: mfaToken,
      };
    }

    if (requiredAcr === ACR_WEBAUTHN) {
      const hasCredentials = await this.webAuthnService.hasCredentials(
        user.id,
        realm.id,
      );
      if (!hasCredentials) {
        throw new BadRequestException(
          'No WebAuthn credentials registered for this account. Please register a passkey first.',
        );
      }

      // Generate a proper server-side challenge and allowCredentials list.
      // The challenge is stored in PendingAction (5-minute TTL) and consumed
      // during POST /verify so it cannot be replayed.
      const options = await this.webAuthnService.generateAuthenticationOptions(
        realm,
        user.id,
      );

      return {
        status: 'challenge_required',
        challenge_type: 'webauthn',
        acr: requiredAcr,
        webauthn_options: options,
      };
    }

    if (requiredAcr === ACR_PASSWORD) {
      return {
        status: 'challenge_required',
        challenge_type: 'password',
        acr: requiredAcr,
      };
    }

    throw new BadRequestException(`Unsupported ACR value: ${requiredAcr}`);
  }

  /**
   * POST /realms/:realm/step-up/verify
   *
   * Completes a step-up verification.  Accepts TOTP/OTP codes for MFA
   * step-ups.  On success, records the step-up against the session and
   * returns the new ACR level.
   */
  @Post('verify')
  @ApiOperation({ summary: 'Complete step-up verification' })
  @ApiResponse({
    status: 201,
    description: 'Step-up verified; returns new ACR level and AMR',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request — missing parameters, unsupported ACR, or client not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid session, expired MFA token, or wrong credential',
  })
  async verify(
    @CurrentRealm() realm: Realm,
    @Body()
    body: {
      acr: string;
      client_id: string;
      mfa_token?: string;
      otp?: string;
      password?: string;
      // WebAuthn assertion fields (AuthenticationResponseJSON shape)
      id?: string;
      rawId?: string;
      response?: {
        authenticatorData?: string;
        clientDataJSON?: string;
        signature?: string;
        userHandle?: string;
      };
      type?: string;
    },
    @Req() req: Request,
  ) {
    // Read the session token from the HttpOnly cookie — never from the request
    // body.  Accepting it in the body would allow it to be transmitted in URLs
    // or plain-text POST bodies, exposing it in server logs and browser history.
    const session_token: string | undefined = (req as any).cookies
      ?.AUTHME_SESSION;
    const { acr, client_id, mfa_token, otp, password } = body;

    if (!session_token || !acr || !client_id) {
      throw new BadRequestException(
        'acr and client_id are required; session must be provided via the AUTHME_SESSION cookie',
      );
    }

    // Validate the SSO session
    const user = await this.loginService.validateLoginSession(
      realm,
      session_token,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Look up the login session record to get its ID
    const loginSession = await this.getLoginSessionByToken(session_token);
    if (!loginSession) {
      throw new UnauthorizedException('Session not found');
    }

    // Look up the client to obtain the cache duration
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId: client_id } },
      select: { stepUpCacheDuration: true, requiredAcr: true },
    });
    if (!client) {
      throw new BadRequestException('Client not found');
    }

    const cacheDuration = client.stepUpCacheDuration ?? 900;

    // ── MFA / TOTP step-up ─────────────────────────────────────────────────
    if (acr === ACR_MFA) {
      if (!mfa_token || !otp) {
        throw new BadRequestException(
          'mfa_token and otp are required for MFA step-up',
        );
      }

      const challenge =
        await this.mfaService.validateMfaChallengeWithAttemptCheck(mfa_token);
      if (!challenge) {
        throw new UnauthorizedException('Invalid or expired MFA token');
      }

      // Ensure this challenge belongs to the session user
      if (challenge.userId !== user.id) {
        throw new UnauthorizedException(
          'MFA token does not match session user',
        );
      }

      // Ensure the challenge was issued for this realm (prevents cross-realm token reuse)
      if (challenge.realmId !== realm.id) {
        this.logger.warn(
          `MFA cross-realm token use attempt: challenge realm ${challenge.realmId} used against realm ${realm.id}`,
        );
        throw new UnauthorizedException('Invalid or expired MFA token');
      }

      const verified = await this.mfaService.verifyTotp(challenge.userId, otp);
      if (!verified) {
        const recoveryVerified = await this.mfaService.verifyRecoveryCode(
          challenge.userId,
          otp,
        );
        if (!recoveryVerified) {
          throw new UnauthorizedException('Invalid OTP code');
        }
      }

      // Consume the MFA challenge
      await this.mfaService.consumeMfaChallenge(mfa_token);

      // Record the step-up
      await this.stepUpService.recordStepUp(
        loginSession.id,
        ACR_MFA,
        cacheDuration,
      );

      return {
        status: 'success',
        acr: ACR_MFA,
        amr: ['totp'],
      };
    }

    // ── Password re-authentication step-up ────────────────────────────────
    if (acr === ACR_PASSWORD) {
      if (!password) {
        throw new BadRequestException(
          'password is required for password step-up',
        );
      }

      const ip = resolveClientIp(req);
      try {
        await this.loginService.validateCredentials(
          realm,
          user.username,
          password,
          ip,
        );
      } catch {
        throw new UnauthorizedException('Invalid password');
      }

      await this.stepUpService.recordStepUp(
        loginSession.id,
        ACR_PASSWORD,
        cacheDuration,
      );

      return {
        status: 'success',
        acr: ACR_PASSWORD,
        amr: ['pwd'],
      };
    }

    // ── WebAuthn step-up ───────────────────────────────────────────────────
    if (acr === ACR_WEBAUTHN) {
      // Expect a complete AuthenticationResponseJSON produced by the browser's
      // navigator.credentials.get() call.  The required top-level fields are:
      //   id, rawId, response.authenticatorData, response.clientDataJSON,
      //   response.signature, and type === 'public-key'.
      const {
        id,
        rawId,
        response: assertionResponse,
        type,
      } = body as {
        id?: string;
        rawId?: string;
        response?: {
          authenticatorData?: string;
          clientDataJSON?: string;
          signature?: string;
          userHandle?: string;
        };
        type?: string;
      };

      if (!id || !rawId || !assertionResponse || type !== 'public-key') {
        throw new BadRequestException(
          'WebAuthn step-up requires a full AuthenticationResponseJSON: id, rawId, response, and type must be provided',
        );
      }

      const { authenticatorData, clientDataJSON, signature } =
        assertionResponse;
      if (!authenticatorData || !clientDataJSON || !signature) {
        throw new BadRequestException(
          'WebAuthn step-up requires a full assertion response: authenticatorData, clientDataJSON, and signature must be provided',
        );
      }

      // Delegate to WebAuthnService which calls verifyAuthenticationResponse()
      // from @simplewebauthn/server.  It retrieves and consumes the stored
      // challenge from PendingAction, verifies the RP ID hash in
      // authenticatorData, and validates the signature against the stored
      // public key — preventing replay attacks and credential stuffing.
      let verifiedUser: { id: string };
      try {
        const result = await this.webAuthnService.verifyAuthentication(realm, {
          id,
          rawId,
          response: {
            authenticatorData,
            clientDataJSON,
            signature,
            userHandle: assertionResponse.userHandle,
          },
          type: 'public-key',
          clientExtensionResults: {},
        });
        verifiedUser = result.user;
      } catch (err: any) {
        throw new UnauthorizedException(
          'WebAuthn verification failed: ' + err.message,
        );
      }

      // Confirm the verified passkey actually belongs to the session's user.
      if (verifiedUser.id !== user.id) {
        throw new UnauthorizedException(
          'WebAuthn credential does not belong to the session user',
        );
      }

      await this.stepUpService.recordStepUp(
        loginSession.id,
        ACR_WEBAUTHN,
        cacheDuration,
      );

      return {
        status: 'success',
        acr: ACR_WEBAUTHN,
        amr: ['hwk'],
      };
    }

    throw new BadRequestException(`Unsupported ACR value: ${acr}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getLoginSessionByToken(sessionToken: string) {
    const tokenHash = this.crypto.sha256(sessionToken);
    return this.prisma.loginSession.findUnique({ where: { tokenHash } });
  }
}
