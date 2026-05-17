import {
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopesService } from '../scopes/scopes.service.js';
import {
  ProtocolMapperExecutor,
  type MapperContext,
} from '../scopes/protocol-mapper.executor.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import { EventsService } from '../events/events.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { LoginEventType } from '../events/event-types.js';
import {
  resolveUserClaims,
  type UserClaimSource,
} from '../scopes/claims.resolver.js';
import { CustomAttributesService } from '../custom-attributes/custom-attributes.service.js';
import {
  StepUpService,
  ACR_PASSWORD,
  ACR_MFA,
} from '../step-up/step-up.service.js';
import type { PluginManagerService } from '../plugins/plugin-manager.service.js';
import type { Realm } from '@prisma/client';
import type { JWTPayload } from 'jose';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly scopesService: ScopesService,
    private readonly bruteForceService: BruteForceService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly mfaService: MfaService,
    private readonly protocolMapperExecutor: ProtocolMapperExecutor,
    private readonly eventsService: EventsService,
    private readonly metricsService: MetricsService,
    private readonly customAttributesService: CustomAttributesService,
    @Optional() private readonly stepUpService?: StepUpService,
    @Optional() private readonly pluginManager?: PluginManagerService,
  ) {}

  async handleTokenRequest(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    const grantType = body['grant_type'];

    switch (grantType) {
      case 'password':
        return this.handlePasswordGrant(realm, body, ip, userAgent);
      case 'client_credentials':
        return this.handleClientCredentialsGrant(realm, body, ip);
      case 'refresh_token':
        return this.handleRefreshTokenGrant(realm, body, ip);
      case 'authorization_code':
        return this.handleAuthorizationCodeGrant(realm, body, ip, userAgent);
      case 'mfa_otp':
        return this.handleMfaOtpGrant(realm, body, ip, userAgent);
      case 'urn:ietf:params:oauth:grant-type:device_code':
        return this.handleDeviceCodeGrant(realm, body, ip, userAgent);
      default:
        throw new BadRequestException(`Unsupported grant_type: ${grantType}`);
    }
  }

  private async handlePasswordGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    this.logger.warn(
      `Password grant type used by client "${body['client_id']}" in realm "${realm.name}" — ` +
        'this grant is deprecated by OAuth 2.1 and will be removed in a future release. ' +
        'Migrate to the authorization_code grant with PKCE.',
    );

    const { client_id, client_secret, username, password, scope } = body;

    await this.validateClient(realm, client_id, client_secret, 'password');

    if (!username || !password) {
      throw new BadRequestException('username and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { realmId_username: { realmId: realm.id, username } },
    });
    if (!user || !user.enabled || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Brute force check
    const lockStatus = this.bruteForceService.checkLocked(realm, user);
    if (lockStatus.locked) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    const valid = await this.crypto.verifyPassword(user.passwordHash, password);
    if (!valid) {
      await this.bruteForceService.recordFailure(realm, user.id, ip);
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.LOGIN_ERROR,
        userId: user.id,
        clientId: client_id,
        ipAddress: ip,
        error: 'Invalid credentials',
      });
      this.metricsService.authLoginTotal.inc({
        realm: realm.name,
        status: 'failure',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset brute force failures on success
    await this.bruteForceService.resetFailures(realm.id, user.id);

    // Check password expiry
    if (this.passwordPolicyService.isExpired(user, realm)) {
      throw new BadRequestException(
        'Password has expired. Please change your password.',
      );
    }

    // Check MFA
    const mfaRequired = await this.mfaService.isMfaRequired(realm, user.id);
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);

    if (mfaRequired && mfaEnabled) {
      const mfaToken = await this.mfaService.createMfaChallenge(
        user.id,
        realm.id,
        undefined,
        client_id,
      );
      throw new HttpException(
        {
          error: 'mfa_required',
          error_description:
            'MFA verification is required to complete authentication',
          mfa_token: mfaToken,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (mfaRequired && !mfaEnabled) {
      throw new BadRequestException(
        'MFA setup required. Please set up two-factor authentication.',
      );
    }

    await this.enforceSessionLimit(realm, user.id);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
    });

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGIN,
      userId: user.id,
      sessionId: session.id,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authLoginTotal.inc({
      realm: realm.name,
      status: 'success',
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'password',
    });

    return this.issueTokens(
      realm,
      user,
      client_id,
      session.id,
      scope,
      undefined,
      new Date(),
      ACR_PASSWORD,
      ['pwd'],
    );
  }

  private async handleMfaOtpGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    const { client_id, client_secret, mfa_token, otp, scope } = body;

    // The MFA OTP grant is a custom extension — pass the registered grant-type
    // URN so that clients configured with `urn:ietf:params:oauth:grant-type:mfa-otp`
    // are accepted.  Clients that still carry the legacy `password` grant type are
    // also permitted by passing undefined (skipping the grant-type allowlist check)
    // because the user has already authenticated via the password grant and is
    // simply completing the second factor here.
    await this.validateClient(
      realm,
      client_id,
      client_secret,
      'urn:ietf:params:oauth:grant-type:mfa-otp',
    );

    if (!mfa_token || !otp) {
      throw new BadRequestException('mfa_token and otp are required');
    }

    // Validate with attempt tracking (does not consume the challenge)
    const challenge =
      await this.mfaService.validateMfaChallengeWithAttemptCheck(mfa_token);
    if (!challenge) {
      throw new UnauthorizedException(
        'Invalid or expired MFA token, or too many failed attempts',
      );
    }

    // Ensure the challenge was issued for this realm (prevents cross-realm token reuse)
    if (challenge.realmId !== realm.id) {
      this.logger.warn(
        `MFA cross-realm token use attempt: challenge realm ${challenge.realmId} used against realm ${realm.id}`,
      );
      throw new UnauthorizedException(
        'Invalid or expired MFA token, or too many failed attempts',
      );
    }

    // Ensure the challenge was issued for this client (prevents cross-client token reuse)
    if (challenge.clientId && challenge.clientId !== client_id) {
      this.logger.warn(
        `MFA cross-client token use attempt: challenge client ${challenge.clientId} used against client ${client_id}`,
      );
      throw new UnauthorizedException(
        'Invalid or expired MFA token, or too many failed attempts',
      );
    }

    const verified = await this.mfaService.verifyTotp(challenge.userId, otp);
    if (!verified) {
      // Try as recovery code
      const recoveryVerified = await this.mfaService.verifyRecoveryCode(
        challenge.userId,
        otp,
      );
      if (!recoveryVerified) {
        void this.eventsService.recordLoginEvent({
          realmId: realm.id,
          type: LoginEventType.MFA_VERIFY_ERROR,
          userId: challenge.userId,
          ipAddress: ip,
          error: 'Invalid OTP code',
        });
        throw new UnauthorizedException('Invalid OTP code');
      }
    }

    // MFA verified — consume the challenge
    await this.mfaService.consumeMfaChallenge(mfa_token);

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.enforceSessionLimit(realm, user.id);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
    });

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.MFA_VERIFY,
      userId: user.id,
      sessionId: session.id,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'mfa_otp',
    });

    return this.issueTokens(
      realm,
      user,
      client_id,
      session.id,
      scope,
      undefined,
      new Date(),
      ACR_MFA,
      ['pwd', 'otp'],
    );
  }

  private async handleClientCredentialsGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
  ): Promise<TokenResponse> {
    const { client_id, client_secret, scope } = body;
    const client = await this.validateClient(
      realm,
      client_id,
      client_secret,
      'client_credentials',
    );

    // If client has a service account user, issue tokens through that user
    if (client.serviceAccountUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: client.serviceAccountUserId },
      });
      if (user) {
        // Service account tokens are machine-to-machine and are not tied to a
        // user-facing session lifecycle — skip the concurrent-session limit so
        // that high-frequency service clients are not unexpectedly evicted.
        const session = await this.prisma.session.create({
          data: {
            userId: user.id,
            expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
          },
        });

        // Prevent unbounded session growth for service accounts: keep only the
        // most recent 100 sessions, deleting any older ones beyond that cap.
        const SERVICE_ACCOUNT_SESSION_LIMIT = 100;
        const oldSessions = await this.prisma.session.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          skip: SERVICE_ACCOUNT_SESSION_LIMIT,
          select: { id: true },
        });
        if (oldSessions.length > 0) {
          const oldIds = oldSessions.map((s) => s.id);
          await this.prisma.refreshToken.updateMany({
            where: { sessionId: { in: oldIds }, isOffline: false },
            data: { revoked: true },
          });
          await this.prisma.session.deleteMany({
            where: { id: { in: oldIds } },
          });
        }

        return this.issueTokens(
          realm,
          user,
          client_id,
          session.id,
          scope,
          undefined,
          new Date(),
        );
      }
    }

    // Fallback: basic client_credentials token without user context
    const signingKey = await this.getActiveSigningKey(realm.id);

    const accessToken = await this.jwkService.signJwt(
      {
        iss: this.getIssuer(realm),
        sub: client.id,
        aud: client_id,
        scope: scope ?? 'openid',
        typ: 'Bearer',
        azp: client_id,
      },
      signingKey.privateKey,
      signingKey.kid,
      realm.accessTokenLifespan,
    );

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.CLIENT_LOGIN,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'client_credentials',
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: realm.accessTokenLifespan,
      scope: scope ?? 'openid',
    };
  }

  private async handleRefreshTokenGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
  ): Promise<TokenResponse> {
    const { refresh_token, client_id, client_secret, scope } = body;

    if (!refresh_token) {
      throw new BadRequestException('refresh_token is required');
    }

    await this.validateClient(realm, client_id, client_secret, 'refresh_token');

    const tokenHash = this.crypto.sha256(refresh_token);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        session: {
          include: { user: true },
        },
      },
    });

    if (
      !storedToken ||
      storedToken.revoked ||
      storedToken.expiresAt < new Date()
    ) {
      if (storedToken?.revoked && storedToken.session) {
        await this.prisma.refreshToken.updateMany({
          where: { sessionId: storedToken.sessionId },
          data: { revoked: true },
        });
      }
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.TOKEN_REFRESH_ERROR,
        clientId: client_id,
        ipAddress: ip,
        error: 'Invalid or expired refresh token',
      });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Enforce that the refresh token was issued to the requesting client.
    // Tokens without a stored clientId are pre-migration legacy tokens —
    // they MUST be rejected because any client could claim ownership.
    // Users with legacy tokens simply need to re-authenticate once.
    if (!storedToken.clientId) {
      this.logger.warn(
        `Refresh token ${storedToken.id} has no clientId (legacy). ` +
          `Rejecting to prevent cross-client token reuse. User must re-authenticate.`,
      );
      throw new UnauthorizedException(
        'This refresh token predates client binding. Please log in again.',
      );
    }
    if (storedToken.clientId !== client_id) {
      throw new UnauthorizedException(
        'Refresh token was not issued to this client',
      );
    }

    // Rotate: revoke old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    const user = storedToken.session.user;

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.TOKEN_REFRESH,
      userId: user.id,
      sessionId: storedToken.sessionId,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'refresh_token',
    });

    return this.issueTokens(
      realm,
      user,
      client_id,
      storedToken.sessionId,
      scope || storedToken.scope || undefined,
    );
  }

  private async handleAuthorizationCodeGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    const { code, client_id, client_secret, redirect_uri, code_verifier } =
      body;

    if (!code) {
      throw new BadRequestException('code is required');
    }

    const client = await this.validateClient(
      realm,
      client_id,
      client_secret,
      'authorization_code',
    );

    // Atomically mark the code as used in a single conditional UPDATE so that
    // concurrent requests racing to exchange the same code cannot both succeed.
    // Prisma throws P2025 when no row matches the where clause, which happens
    // when: (a) the code does not exist, (b) it was already used by a
    // concurrent request, or (c) it has already expired.  All three cases are
    // treated identically — the caller receives an "invalid or expired" error.
    let authCode: Awaited<
      ReturnType<typeof this.prisma.authorizationCode.update>
    >;
    try {
      authCode = await this.prisma.authorizationCode.update({
        where: {
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
        data: { used: true },
      });
    } catch (err: unknown) {
      const isPrismaNotFound =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2025';
      if (isPrismaNotFound) {
        throw new UnauthorizedException(
          'Invalid or expired authorization code',
        );
      }
      throw err;
    }

    if (authCode.clientId !== client.id) {
      throw new UnauthorizedException('Invalid or expired authorization code');
    }

    if (authCode.redirectUri !== redirect_uri) {
      throw new BadRequestException('redirect_uri mismatch');
    }

    // PKCE enforcement: public clients must always use PKCE (OAuth 2.1 / RFC 7636)
    if (client.clientType === 'PUBLIC' && !authCode.codeChallenge) {
      throw new BadRequestException(
        'PKCE (code_challenge) is required for public clients',
      );
    }

    // PKCE verification
    if (authCode.codeChallenge) {
      if (!code_verifier) {
        throw new BadRequestException('code_verifier is required for PKCE');
      }
      const computedChallenge = Buffer.from(
        this.crypto.sha256(code_verifier),
        'hex',
      ).toString('base64url');

      if (computedChallenge !== authCode.codeChallenge) {
        throw new UnauthorizedException('Invalid code_verifier');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authCode.userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const lockStatus = this.bruteForceService.checkLocked(realm, user);
    if (lockStatus.locked) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    await this.enforceSessionLimit(realm, user.id);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
    });

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.CODE_TO_TOKEN,
      userId: user.id,
      sessionId: session.id,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'authorization_code',
    });

    // Resolve ACR from the auth code's stored acr_values (set at authorization time)
    const storedAcrValues = authCode.acrValues;
    const resolvedAcr = storedAcrValues
      ? storedAcrValues.split(' ')[0]
      : ACR_PASSWORD;

    return this.issueTokens(
      realm,
      user,
      client_id,
      session.id,
      authCode.scope ?? undefined,
      authCode.nonce ?? undefined,
      new Date(),
      resolvedAcr,
      ['pwd'],
      authCode.code,
    );
  }

  private async handleDeviceCodeGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    const { device_code, client_id, client_secret } = body;

    if (!device_code) {
      throw new BadRequestException('device_code is required');
    }

    await this.validateClient(
      realm,
      client_id,
      client_secret,
      'urn:ietf:params:oauth:grant-type:device_code',
    );

    const deviceCode = await this.prisma.deviceCode.findUnique({
      where: { deviceCode: device_code },
    });

    if (!deviceCode || deviceCode.realmId !== realm.id) {
      throw new BadRequestException('authorization_pending');
    }

    if (deviceCode.expiresAt < new Date()) {
      throw new BadRequestException('expired_token');
    }

    if (deviceCode.denied) {
      throw new BadRequestException('access_denied');
    }

    if (!deviceCode.approved || !deviceCode.userId) {
      throw new BadRequestException('authorization_pending');
    }

    // RFC 8628 §3.5 — enforce minimum polling interval.
    // If the client polls before the required interval has elapsed, increase the
    // interval by 5 seconds and return `slow_down` so the client backs off.
    if (deviceCode.lastPolledAt) {
      const elapsed = Date.now() - deviceCode.lastPolledAt.getTime();
      if (elapsed < deviceCode.interval * 1000) {
        await this.prisma.deviceCode.update({
          where: { id: deviceCode.id },
          data: {
            lastPolledAt: new Date(),
            interval: deviceCode.interval + 5,
          },
        });
        throw new BadRequestException('slow_down');
      }
    }

    // Polling is within the allowed window — record the timestamp.
    await this.prisma.deviceCode.update({
      where: { id: deviceCode.id },
      data: { lastPolledAt: new Date() },
    });

    if (!deviceCode.approved || !deviceCode.userId) {
      throw new BadRequestException('authorization_pending');
    }

    // Device has been approved — issue tokens
    const user = await this.prisma.user.findUnique({
      where: { id: deviceCode.userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check MFA — device code flow does not support interactive MFA
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
    if (mfaEnabled) {
      throw new BadRequestException(
        'MFA verification required. Device code grant does not support MFA. Use authorization_code grant instead.',
      );
    }
    const mfaRequired = await this.mfaService.isMfaRequired(realm, user.id);
    if (mfaRequired) {
      throw new BadRequestException(
        'MFA setup required. Use authorization_code grant to complete MFA setup.',
      );
    }

    // Clean up the device code
    await this.prisma.deviceCode.delete({ where: { id: deviceCode.id } });

    await this.enforceSessionLimit(realm, user.id);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
    });

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.DEVICE_CODE_TO_TOKEN,
      userId: user.id,
      sessionId: session.id,
      clientId: client_id,
      ipAddress: ip,
    });
    this.metricsService.authTokenIssuedTotal.inc({
      realm: realm.name,
      grant_type: 'device_code',
    });

    return this.issueTokens(
      realm,
      user,
      client_id,
      session.id,
      deviceCode.scope ?? undefined,
      undefined,
      new Date(),
    );
  }

  private async validateClient(
    realm: Realm,
    clientId: string,
    clientSecret?: string,
    grantType?: string,
  ) {
    if (!clientId) {
      throw new BadRequestException('client_id is required');
    }

    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });

    if (!client || !client.enabled) {
      throw new UnauthorizedException('Invalid client');
    }

    if (grantType) {
      // For the device_code grant (RFC 8628) accept both the full URN and the
      // shorthand alias so that clients stored with either value are permitted
      // (issue #503).  All other grant types must match exactly.
      const DEVICE_URN = 'urn:ietf:params:oauth:grant-type:device_code';
      const isDeviceGrant =
        grantType === DEVICE_URN || grantType === 'device_code';
      const clientAllowsDevice =
        client.grantTypes.includes(DEVICE_URN) ||
        client.grantTypes.includes('device_code');

      const allowed = isDeviceGrant
        ? clientAllowsDevice
        : client.grantTypes.includes(grantType);
      if (!allowed) {
        throw new BadRequestException(
          `Grant type '${grantType}' not allowed for this client`,
        );
      }
    }

    if (client.clientType === 'CONFIDENTIAL') {
      if (!clientSecret) {
        throw new UnauthorizedException('client_secret is required');
      }
      if (!client.clientSecret) {
        throw new UnauthorizedException('Client has no secret configured');
      }
      const valid = await this.crypto.verifyPassword(
        client.clientSecret,
        clientSecret,
      );
      if (!valid) {
        throw new UnauthorizedException('Invalid client credentials');
      }
    }

    return client;
  }

  private async issueTokens(
    realm: Realm,
    user: UserClaimSource,
    clientId: string,
    sessionId: string,
    scope?: string,
    nonce?: string,
    authTime?: Date,
    acr?: string,
    amr?: string[],
    code?: string,
  ): Promise<TokenResponse> {
    const signingKey = await this.getActiveSigningKey(realm.id);

    // Parse and validate scopes, default to openid
    const scopes = this.scopesService.parseAndValidate(scope);
    const effectiveScopes = scopes.length > 0 ? scopes : ['openid'];
    const validatedScope = this.scopesService.toString(effectiveScopes);

    // Resolve scope-filtered user claims
    const allowedClaims =
      this.scopesService.getClaimsForScopes(effectiveScopes);
    const customAttrClaims =
      await this.customAttributesService.getOidcClaimsForUser(user.id);
    const userClaims = resolveUserClaims(user, allowedClaims, customAttrClaims);

    // Build role claims (direct user roles + group-inherited roles)
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: { include: { client: true } } },
    });

    const groupRoles = await this.resolveGroupRoles(user.id);

    // Merge and deduplicate
    const allRoles = [...userRoles.map((ur) => ur.role), ...groupRoles];
    const seenRoleIds = new Set<string>();
    const dedupedRoles = allRoles.filter((r) => {
      if (seenRoleIds.has(r.id)) return false;
      seenRoleIds.add(r.id);
      return true;
    });

    const realmRoles = dedupedRoles
      .filter((r) => !r.clientId)
      .map((r) => r.name);

    const resourceAccess: Record<string, { roles: string[] }> = {};
    for (const role of dedupedRoles) {
      if (role.client) {
        const cId = role.client.clientId;
        if (!resourceAccess[cId]) {
          resourceAccess[cId] = { roles: [] };
        }
        resourceAccess[cId].roles.push(role.name);
      }
    }

    // Include roles by default (backward compat) or when 'roles' scope is granted
    const includeRoles = !scope || allowedClaims.has('realm_access');

    // Try to apply protocol mappers from DB scopes
    let mapperClaims: Record<string, unknown> = {};
    try {
      const mappers = await this.scopesService.getScopeMappers(
        effectiveScopes,
        realm.id,
      );
      if (mappers.length > 0) {
        const mapperContext: MapperContext = {
          userId: user.id,
          username: user.username ?? '',
          email: user.email ?? null,
          emailVerified: user.emailVerified ?? false,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          realmRoles,
          resourceAccess,
        };
        mapperClaims = this.protocolMapperExecutor.executeMappers(
          mappers,
          mapperContext,
          {},
        );
      }
    } catch {
      // If mappers fail, fall back to standard claims
    }

    const accessTokenPayload: JWTPayload = {
      iss: this.getIssuer(realm),
      sub: user.id,
      aud: clientId,
      scope: validatedScope,
      typ: 'Bearer',
      azp: clientId,
      sid: sessionId,
      ...userClaims,
      ...(includeRoles
        ? {
            realm_access: { roles: realmRoles },
            resource_access: resourceAccess,
          }
        : {}),
      ...mapperClaims,
    };

    // Allow token-enrichment plugins to add custom claims (non-blocking)
    const enrichedPayload: Record<string, unknown> = this.pluginManager
      ? await this.pluginManager.enrichToken(
          accessTokenPayload,
          user,
          realm.name,
        )
      : accessTokenPayload;

    const accessToken = await this.jwkService.signJwt(
      enrichedPayload,
      signingKey.privateKey,
      signingKey.kid,
      realm.accessTokenLifespan,
    );

    // Determine if this is an offline token
    const isOffline = effectiveScopes.includes('offline_access');
    const refreshLifespan = isOffline
      ? realm.offlineTokenLifespan
      : realm.refreshTokenLifespan;

    // Generate opaque refresh token
    const rawRefreshToken = this.crypto.generateSecret(64);
    const refreshTokenHash = this.crypto.sha256(rawRefreshToken);

    await this.prisma.refreshToken.create({
      data: {
        sessionId,
        tokenHash: refreshTokenHash,
        scope: validatedScope,
        expiresAt: new Date(Date.now() + refreshLifespan * 1000),
        isOffline,
        clientId,
      },
    });

    // Build ID token if openid scope is present
    let idToken: string | undefined;
    if (this.scopesService.hasOpenidScope(effectiveScopes)) {
      idToken = await this.buildIdToken({
        realm,
        user,
        clientId,
        sessionId,
        scopes: effectiveScopes,
        accessToken,
        nonce,
        authTime,
        signingKey,
        acr,
        amr,
        code,
      });
    }

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: realm.accessTokenLifespan,
      refresh_token: rawRefreshToken,
      scope: validatedScope,
      ...(idToken ? { id_token: idToken } : {}),
    };
  }

  private async buildIdToken(params: {
    realm: Realm;
    user: UserClaimSource;
    clientId: string;
    sessionId: string;
    scopes: string[];
    accessToken: string;
    nonce?: string;
    authTime?: Date;
    signingKey: { privateKey: string; kid: string };
    acr?: string;
    amr?: string[];
    code?: string;
  }): Promise<string> {
    const allowedClaims = this.scopesService.getClaimsForScopes(params.scopes);
    const customAttrClaims =
      await this.customAttributesService.getOidcClaimsForUser(params.user.id);
    const userClaims = resolveUserClaims(
      params.user,
      allowedClaims,
      customAttrClaims,
    );

    // Resolve the ACR claim:
    //  - Use explicitly provided acr (from step-up flow) if available
    //  - Otherwise default to ACR_PASSWORD ("urn:authme:acr:password")
    const resolvedAcr = params.acr ?? ACR_PASSWORD;

    const idTokenPayload: JWTPayload = {
      iss: this.getIssuer(params.realm),
      sub: params.user.id,
      aud: params.clientId,
      azp: params.clientId,
      typ: 'ID',
      sid: params.sessionId,
      at_hash: this.jwkService.computeAtHash(params.accessToken),
      auth_time: params.authTime
        ? Math.floor(params.authTime.getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      acr: resolvedAcr,
      ...(params.amr && params.amr.length > 0 ? { amr: params.amr } : {}),
      ...(params.code
        ? { c_hash: this.jwkService.computeChash(params.code) }
        : {}),
      ...userClaims,
    };

    if (params.nonce) {
      idTokenPayload['nonce'] = params.nonce;
    }

    return this.jwkService.signJwt(
      idTokenPayload,
      params.signingKey.privateKey,
      params.signingKey.kid,
      params.realm.accessTokenLifespan,
    );
  }

  private async getActiveSigningKey(realmId: string) {
    const key = await this.prisma.realmSigningKey.findFirst({
      where: { realmId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!key) {
      throw new Error('No active signing key found for realm');
    }
    return key;
  }

  private getIssuer(realm: Realm): string {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    return `${baseUrl}/realms/${realm.name}`;
  }

  private async resolveGroupRoles(userId: string) {
    const memberships = await this.prisma.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    });

    if (memberships.length === 0) return [];

    type RoleWithClient = {
      id: string;
      name: string;
      clientId: string | null;
      client: { clientId: string } | null;
    };
    const allRoles: RoleWithClient[] = [];
    const visited = new Set<string>();

    const walkGroup = async (groupId: string) => {
      if (visited.has(groupId)) return;
      visited.add(groupId);

      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        include: {
          groupRoles: { include: { role: { include: { client: true } } } },
        },
      });
      if (!group) return;

      for (const gr of group.groupRoles) {
        allRoles.push(gr.role);
      }

      if (group.parentId) {
        await walkGroup(group.parentId);
      }
    };

    for (const m of memberships) {
      await walkGroup(m.groupId);
    }

    return allRoles;
  }

  /**
   * Enforce the per-realm maximum concurrent OAuth sessions limit for a user.
   * If the user already has `maxSessionsPerUser` or more active sessions, the
   * oldest ones are deleted (FIFO) so that after this call there is room for
   * exactly one additional session.
   *
   * A `maxSessionsPerUser` value of 0 means "unlimited" — no eviction occurs.
   */
  private async enforceSessionLimit(
    realm: Realm,
    userId: string,
  ): Promise<void> {
    const maxSessions = (realm as Realm & { maxSessionsPerUser?: number })
      .maxSessionsPerUser;
    if (!maxSessions || maxSessions <= 0) return;

    const activeSessions = await this.prisma.session.findMany({
      where: {
        userId,
        user: { realmId: realm.id },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (activeSessions.length >= maxSessions) {
      const toEvict = activeSessions.slice(
        0,
        activeSessions.length - maxSessions + 1,
      );
      const evictIds = toEvict.map((s) => s.id);

      // Revoke all refresh tokens for the evicted sessions before deleting them
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: evictIds }, isOffline: false },
        data: { revoked: true },
      });

      await this.prisma.session.deleteMany({
        where: { id: { in: evictIds } },
      });
    }
  }
}
