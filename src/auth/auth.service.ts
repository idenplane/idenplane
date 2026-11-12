import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import {
  Injectable,
  Logger,
  Optional,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { OAuthTokenError } from './oauth-token-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ClientAuthenticator } from '../client-auth/client-authenticator.js';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopesService } from '../scopes/scopes.service.js';
import {
  ProtocolMapperExecutor,
  type MapperContext,
} from '../scopes/protocol-mapper.executor.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import { SmsOtpService, SmsOtpError } from '../sms/sms-otp.service.js';
import { EventsService } from '../events/events.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { LoginEventType } from '../events/event-types.js';
import {
  resolveUserClaims,
  type UserClaimSource,
} from '../scopes/claims.resolver.js';
import { loadUserGrants } from './user-grants.js';
import { CustomAttributesService } from '../custom-attributes/custom-attributes.service.js';
import { UserFederationService } from '../user-federation/user-federation.service.js';
import { StepUpService } from '../step-up/step-up.service.js';
import { ACR_PASSWORD, ACR_MFA } from '../authn-core/acr.js';
import type { PluginManagerService } from '../plugins/plugin-manager.service.js';
import type { Client, Prisma, Realm } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { JWTPayload } from 'jose';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  /** OIDC Session Management: the server-side session identifier. */
  session_state?: string;
}

/**
 * What the token endpoint knows about a request besides its parameters, so
 * services never read the HTTP request.
 */
export interface TokenRequestContext {
  /** The `Authorization` header (HTTP Basic client authentication). */
  authorization?: string;
  /** The certificate the client presented, if any. */
  clientCert?: PresentedClientCertificate | null;
}

/** See AuthService.newSession. */
interface NewSession {
  id: string;
  data: Omit<Prisma.SessionUncheckedCreateInput, 'id' | 'refreshTokens'>;
}

/**
 * Registered and assurance claims of an access token that only the server
 * sets. `exp`, `iat` and `jti` are set when signing.
 */
/**
 * How long after a code expires a replay by its own client still revokes the
 * tokens issued from it (RFC 6749 §4.1.2).
 */
const REPLAY_REVOCATION_WINDOW_MS = 5 * 60 * 1000;

const PROTECTED_ACCESS_TOKEN_CLAIMS = [
  'iss',
  'sub',
  'aud',
  'azp',
  'scope',
  'typ',
  'sid',
  'acr',
  'amr',
  'nbf',
  'cnf',
  'auth_time',
  'nonce',
] as const;

/**
 * Restores the server's values of the protected claims after mappers and
 * plugins ran: a configured claim named `sub`, `acr` or `aud` must not let a
 * token speak for another user, assurance level or audience.
 */
export function withProtectedClaims(
  payload: Record<string, unknown>,
  protectedClaims: JWTPayload,
): JWTPayload {
  const result: Record<string, unknown> = { ...payload };
  for (const claim of PROTECTED_ACCESS_TOKEN_CLAIMS) {
    if (claim in protectedClaims) {
      result[claim] = protectedClaims[claim];
    } else {
      delete result[claim];
    }
  }
  return result;
}

/**
 * Throws `unauthorized_client` unless the client may use the grant.
 */
function assertGrantAllowed(
  client: Pick<Client, 'grantTypes'>,
  grantType: string,
): void {
  // For the device_code grant (RFC 8628) accept both the full URN and the
  // shorthand alias so that clients stored with either value are permitted
  // (issue #503).  All other grant types must match exactly — with one
  // continuation exception below.
  const DEVICE_URN = 'urn:ietf:params:oauth:grant-type:device_code';
  const isDeviceGrant = grantType === DEVICE_URN || grantType === 'device_code';
  const clientAllowsDevice =
    client.grantTypes.includes(DEVICE_URN) ||
    client.grantTypes.includes('device_code');

  // A `password`-grant client that hands back `mfa_required` must be able
  // to complete the challenge it issued; implicitly permit the
  // `mfa_otp` continuation so admins don't have to grant both side-by-side
  // (finding #23).
  const MFA_OTP_URN = 'urn:ietf:params:oauth:grant-type:mfa-otp';
  const isMfaOtpGrant = grantType === MFA_OTP_URN || grantType === 'mfa_otp';
  const clientAllowsMfaOtp =
    client.grantTypes.includes(MFA_OTP_URN) ||
    client.grantTypes.includes('password');

  const allowed = isDeviceGrant
    ? clientAllowsDevice
    : isMfaOtpGrant
      ? clientAllowsMfaOtp
      : client.grantTypes.includes(grantType);
  if (!allowed) {
    throw new OAuthTokenError(
      'unauthorized_client',
      `Grant type '${grantType}' not allowed for this client`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly lookups: CachedLookupsService,
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
    private readonly userFederationService: UserFederationService,
    private readonly clientAuthenticator: ClientAuthenticator,
    @Optional() private readonly stepUpService?: StepUpService,
    @Optional() private readonly pluginManager?: PluginManagerService,
    @Optional() private readonly smsOtp?: SmsOtpService,
  ) {}

  /**
   * Redeem an authorization code for a client that lives inside this server:
   * forward-auth (proxy-auth), where Idenplane is both the authorization
   * server and the OAuth client. Client authentication proves the caller is
   * the client; here the caller is the server itself, so a secret would prove
   * nothing, and the server never holds the plaintext anyway (only its hash).
   *
   * Not reachable from the token endpoint: it is a separate method, never a
   * body field. In place of the secret it requires PKCE, whose verifier the
   * caller keeps in a cookie on the browser that began the sign-in, so a code
   * is only redeemable by that browser. Every other check of the ordinary
   * grant still runs: client enabled and allowed this grant, code single-use,
   * unexpired and issued to this client, redirect_uri byte-identical.
   */
  async redeemAuthorizationCodeForServerClient(
    realm: Realm,
    params: {
      code: string;
      clientId: string;
      redirectUri: string;
      codeVerifier: string;
    },
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponse> {
    return this.handleAuthorizationCodeGrant(
      realm,
      {
        grant_type: 'authorization_code',
        code: params.code,
        client_id: params.clientId,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      },
      ip,
      userAgent,
      { serverClient: true },
    );
  }

  async handleTokenRequest(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    // One way of authenticating the client per request (RFC 6749 §2.3),
    // checked before anything else as it always was.
    const presented = this.clientAuthenticator.readCredentials({
      body,
      authorization: ctx.authorization,
    });
    // The grant handlers read `client_id` from the parameters; with HTTP
    // Basic it comes from the header. The secret stays out of `body`.
    if (presented.clientId !== undefined && body['client_id'] === undefined) {
      body = { ...body, client_id: presented.clientId };
    }

    const grantType = body['grant_type'];

    if (!grantType) {
      throw new OAuthTokenError(
        'invalid_request',
        'grant_type is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    switch (grantType) {
      case 'password':
        return this.handlePasswordGrant(realm, body, ip, userAgent, ctx);
      case 'client_credentials':
        return this.handleClientCredentialsGrant(realm, body, ip, ctx);
      case 'refresh_token':
        return this.handleRefreshTokenGrant(realm, body, ip, ctx);
      case 'authorization_code':
        return this.handleAuthorizationCodeGrant(realm, body, ip, userAgent, {
          ctx,
        });
      case 'mfa_otp':
        return this.handleMfaOtpGrant(realm, body, ip, userAgent, ctx);
      case 'urn:ietf:params:oauth:grant-type:device_code':
        return this.handleDeviceCodeGrant(realm, body, ip, userAgent, ctx);
      default:
        throw new OAuthTokenError(
          'unsupported_grant_type',
          `Unsupported grant_type: ${grantType}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private async handlePasswordGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    this.logger.warn(
      `Password grant type used by client "${body['client_id']}" in realm "${realm.name}" — ` +
        'this grant is deprecated by OAuth 2.1 and will be removed in a future release. ' +
        'Migrate to the authorization_code grant with PKCE.',
    );

    const { client_id, username, password, scope } = body;

    await this.validateClient(realm, body, 'password', { ctx });

    if (!username || !password) {
      throw new OAuthTokenError(
        'invalid_request',
        'username and password are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    let user = await this.prisma.user.findUnique({
      where: { realmId_username: { realmId: realm.id, username } },
    });

    // Federated users have empty passwordHash — route to LDAP bind instead of
    // rejecting outright. UserFederationService.authenticateViaFederation does
    // the bind-as-service / find-DN / bind-as-user dance against the configured
    // LDAP server, and find-or-imports the user. Realm-scoping is enforced
    // inside that call.
    if (user && user.enabled && !user.passwordHash && user.federationLink) {
      const federationResult =
        await this.userFederationService.authenticateViaFederation(
          realm.id,
          username,
          password,
        );
      if (!federationResult.authenticated) {
        throw new OAuthTokenError(
          'invalid_grant',
          'Invalid credentials',
          HttpStatus.BAD_REQUEST,
        );
      }
      // refresh the user row in case the federation flow updated attributes
      user = await this.prisma.user.findUnique({
        where: { id: federationResult.userId ?? user.id },
      });
    }

    if (!user || !user.enabled || !user.passwordHash) {
      // Last-resort federation attempt for the "user doesn't exist locally"
      // case — `authenticateViaFederation` will import-on-first-login when
      // the federation has `importEnabled=true`.
      if (!user || (!user.passwordHash && !user.federationLink)) {
        const federationResult =
          await this.userFederationService.authenticateViaFederation(
            realm.id,
            username,
            password,
          );
        if (federationResult.authenticated && federationResult.userId) {
          user = await this.prisma.user.findUnique({
            where: { id: federationResult.userId },
          });
        }
      }
      if (!user || !user.enabled) {
        throw new OAuthTokenError(
          'invalid_grant',
          'Invalid credentials',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Brute force check
    const lockStatus = this.bruteForceService.checkLocked(realm, user);
    if (lockStatus.locked) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Account is temporarily locked. Please try again later.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Skip local password check for federated users — already authenticated
    // via LDAP above; no `passwordHash` to compare against.
    const skipLocalPwdCheck = !user.passwordHash && !!user.federationLink;
    const valid =
      skipLocalPwdCheck ||
      (user.passwordHash &&
        (await this.crypto.verifyPassword(user.passwordHash, password)));
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
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid credentials',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Reset brute force failures on success
    await this.bruteForceService.resetFailures(realm.id, user.id);

    // Check password expiry
    if (this.passwordPolicyService.isExpired(user, realm)) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Password has expired. Please change your password.',
        HttpStatus.BAD_REQUEST,
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
          // Factors the user can answer with. For 'sms', request a code via
          // POST .../protocol/openid-connect/mfa/sms, then send it with
          // mfa_method=sms on the mfa_otp grant.
          mfa_methods: await this.availableMfaMethods(realm, user.id),
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (mfaRequired && !mfaEnabled) {
      throw new OAuthTokenError(
        'invalid_grant',
        'MFA setup required. Please set up two-factor authentication.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = this.newSession({
      userId: user.id,
      ipAddress: ip,
      userAgent,
      // Persist so a later refresh preserves the password-level context.
      satisfiedAcr: ACR_PASSWORD,
      amr: ['pwd'],
      expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
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
      session,
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
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    const { client_id, mfa_token, otp, scope } = body;
    const smsMethod = body['mfa_method'] === 'sms';

    // The MFA OTP grant is a custom extension — pass the registered grant-type
    // URN so that clients configured with `urn:ietf:params:oauth:grant-type:mfa-otp`
    // are accepted.  Clients that still carry the legacy `password` grant type are
    // also permitted by passing undefined (skipping the grant-type allowlist check)
    // because the user has already authenticated via the password grant and is
    // simply completing the second factor here.
    await this.validateClient(
      realm,
      body,
      'urn:ietf:params:oauth:grant-type:mfa-otp',
      { ctx },
    );

    if (!mfa_token || !otp) {
      throw new OAuthTokenError(
        'invalid_request',
        'mfa_token and otp are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate with attempt tracking (does not consume the challenge)
    const challenge =
      await this.mfaService.validateMfaChallengeWithAttemptCheck(mfa_token);
    if (!challenge) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired MFA token, or too many failed attempts',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Ensure the challenge was issued for this realm (prevents cross-realm token reuse)
    if (challenge.realmId !== realm.id) {
      this.logger.warn(
        `MFA cross-realm token use attempt: challenge realm ${challenge.realmId} used against realm ${realm.id}`,
      );
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired MFA token, or too many failed attempts',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Ensure the challenge was issued for this client (prevents cross-client token reuse)
    if (challenge.clientId && challenge.clientId !== client_id) {
      this.logger.warn(
        `MFA cross-client token use attempt: challenge client ${challenge.clientId} used against client ${client_id}`,
      );
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired MFA token, or too many failed attempts',
        HttpStatus.BAD_REQUEST,
      );
    }

    // A texted code (mfa_method=sms), or an authenticator then recovery code.
    const { verified, factor } = await this.mfaService.verifySecondFactor(
      challenge.userId,
      smsMethod
        ? {
            method: 'sms',
            code: otp,
            realmId: realm.id,
            purpose: 'login',
            binding: mfa_token,
          }
        : { method: 'otp', code: otp },
    );
    if (!verified) {
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.MFA_VERIFY_ERROR,
        userId: challenge.userId,
        ipAddress: ip,
        error: 'Invalid OTP code',
      });
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid OTP code',
        HttpStatus.BAD_REQUEST,
      );
    }

    // MFA verified — claim the challenge (one token per verified challenge)
    if (!(await this.mfaService.consumeMfaChallenge(mfa_token))) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired MFA token, or too many failed attempts',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
    });
    if (!user) {
      throw new OAuthTokenError(
        'invalid_grant',
        'User not found',
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = this.newSession({
      userId: user.id,
      ipAddress: ip,
      userAgent,
      // Persist so a later refresh preserves the MFA-level context.
      satisfiedAcr: ACR_MFA,
      amr: ['pwd', factor === 'sms' ? 'sms' : 'otp'],
      expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
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
      session,
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
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    const { client_id, scope } = body;
    const client = await this.validateClient(
      realm,
      body,
      'client_credentials',
      { ctx },
    );

    // If client has a service account user, issue tokens through that user
    if (client.serviceAccountUserId) {
      const user = await this.lookups.userProfile(client.serviceAccountUserId);
      if (user) {
        // A machine-to-machine token carries the service account's claims but
        // no session: nobody logs in, so there is nothing to refresh or log
        // out of, and the client simply asks for a new token. Writing nothing
        // keeps this grant cheap under load, and no token can be pushed out by
        // newer ones. Disabling the service account, or revoking a token by
        // its jti, still ends it at introspection.
        return this.issueTokens(
          realm,
          user,
          client_id,
          null,
          scope,
          undefined,
          new Date(),
        );
      }
    }

    // Fallback: basic client_credentials token without user context. The
    // scope is validated like any other grant's, never copied as sent.
    const signingKey = await this.getActiveSigningKey(realm.id);
    const scopes = this.scopesService.parseAndValidate(scope);
    const grantedScope = this.scopesService.toString(
      scopes.length > 0 ? scopes : ['openid'],
    );

    const accessToken = await this.jwkService.signJwt(
      {
        iss: this.getIssuer(realm),
        sub: client.id,
        aud: client_id,
        scope: grantedScope,
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
      scope: grantedScope,
    };
  }

  private async handleRefreshTokenGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    const { refresh_token, client_id, scope } = body;

    if (!refresh_token) {
      throw new OAuthTokenError(
        'invalid_request',
        'refresh_token is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.validateClient(realm, body, 'refresh_token', { ctx });

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
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired refresh token',
        HttpStatus.BAD_REQUEST,
      );
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
      throw new OAuthTokenError(
        'invalid_grant',
        'This refresh token predates client binding. Please log in again.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (storedToken.clientId !== client_id) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Refresh token was not issued to this client',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = storedToken.session.user;
    if (!user.enabled) {
      throw new OAuthTokenError(
        'invalid_grant',
        'The user is disabled',
        HttpStatus.BAD_REQUEST,
      );
    }

    // RFC 6749 §6: a refresh may narrow the scope, never widen it. (A token
    // stored without a scope predates scope tracking; nothing to compare.)
    const grantedScopes = (storedToken.scope ?? '').split(' ').filter(Boolean);
    const requestedScopes = (scope ?? '').split(' ').filter(Boolean);
    const widened =
      storedToken.scope === null
        ? []
        : requestedScopes.filter((s) => !grantedScopes.includes(s));
    if (widened.length > 0) {
      throw new OAuthTokenError(
        'invalid_scope',
        `Scope not granted to this refresh token: ${widened.join(' ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Rotate: the revocation is the claim. Only one request can revoke a
    // live token; a concurrent one using the same token loses, and is
    // treated as the reuse it is (RFC 9700 §4.14): the whole session's
    // refresh tokens are revoked, as for any reuse of a revoked token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: storedToken.id, revoked: false },
      data: { revoked: true },
    });
    if (count === 0) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: storedToken.sessionId },
        data: { revoked: true },
      });
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.TOKEN_REFRESH_ERROR,
        clientId: client_id,
        ipAddress: ip,
        error: 'Refresh token reused concurrently',
      });
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired refresh token',
        HttpStatus.BAD_REQUEST,
      );
    }

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

    // Preserve the session's satisfied auth context across refresh so the
    // rotated tokens keep their acr/amr (and don't silently downgrade to
    // password level). Legacy sessions with no stored context fall back.
    const session = storedToken.session;
    const acr = session.satisfiedAcr ?? ACR_PASSWORD;
    const amr = session.amr.length > 0 ? session.amr : ['pwd'];

    return this.issueTokens(
      realm,
      user,
      client_id,
      storedToken.sessionId,
      scope || storedToken.scope || undefined,
      undefined,
      // The original sign-in time, not the refresh time (OIDC Core §12.2).
      session.authTime ?? session.createdAt,
      acr,
      amr,
      undefined,
      storedToken.isOffline,
    );
  }

  private async handleAuthorizationCodeGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
    opts: { serverClient?: boolean; ctx?: TokenRequestContext } = {},
  ): Promise<TokenResponse> {
    const { code, client_id, redirect_uri, code_verifier } = body;

    if (!code) {
      throw new OAuthTokenError(
        'invalid_request',
        'code is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.validateClient(
      realm,
      body,
      'authorization_code',
      { skipSecret: opts.serverClient === true, ctx: opts.ctx },
    );

    // Atomically mark the code as used in a single conditional UPDATE so that
    // concurrent requests racing to exchange the same code cannot both succeed.
    // Prisma throws P2025 when no row matches the where clause, which happens
    // when: (a) the code does not exist, (b) it was already used by a
    // concurrent request, or (c) it has already expired.  All three cases are
    // treated identically — the caller receives an "invalid or expired" error.
    // The session this exchange creates is recorded on the code, so that a
    // replay of the code can end it.
    const sessionId = randomUUID();
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
        data: { used: true, sessionId },
      });
    } catch (err: unknown) {
      const isPrismaNotFound =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2025';
      if (isPrismaNotFound) {
        await this.revokeReplayedCode(code, client, code_verifier);
        throw new OAuthTokenError(
          'invalid_grant',
          'Invalid or expired authorization code',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }

    if (authCode.clientId !== client.id) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired authorization code',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (authCode.redirectUri !== redirect_uri) {
      throw new OAuthTokenError(
        'invalid_grant',
        'redirect_uri mismatch',
        HttpStatus.BAD_REQUEST,
      );
    }

    // PKCE enforcement: public clients must always use PKCE (OAuth 2.1 / RFC
    // 7636), and so must a server-side client, for which PKCE stands in for
    // the client secret it does not present.
    if (
      (client.clientType === 'PUBLIC' || opts.serverClient === true) &&
      !authCode.codeChallenge
    ) {
      throw new OAuthTokenError(
        'invalid_request',
        'PKCE (code_challenge) is required for public clients',
        HttpStatus.BAD_REQUEST,
      );
    }

    // PKCE verification
    if (authCode.codeChallenge) {
      if (!code_verifier) {
        throw new OAuthTokenError(
          'invalid_request',
          'code_verifier is required for PKCE',
          HttpStatus.BAD_REQUEST,
        );
      }
      const computedChallenge = Buffer.from(
        this.crypto.sha256(code_verifier),
        'hex',
      ).toString('base64url');

      if (computedChallenge !== authCode.codeChallenge) {
        throw new OAuthTokenError(
          'invalid_grant',
          'Invalid code_verifier',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authCode.userId },
    });
    if (!user) {
      throw new OAuthTokenError(
        'invalid_grant',
        'User not found',
        HttpStatus.BAD_REQUEST,
      );
    }

    const lockStatus = this.bruteForceService.checkLocked(realm, user);
    if (lockStatus.locked) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Account is temporarily locked. Please try again later.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Reflect the auth context actually *satisfied* during login (persisted on
    // the code at authorization time), not merely the client-*requested*
    // `acrValues`. Falls back to password-level for legacy/null codes.
    const acr = authCode.satisfiedAcr ?? ACR_PASSWORD;
    const amr = authCode.amr.length > 0 ? authCode.amr : ['pwd'];

    const session = this.newSession(
      {
        userId: user.id,
        ipAddress: ip,
        userAgent,
        // Persist so the refresh_token grant can preserve acr/amr (see
        // handleRefreshTokenGrant).
        satisfiedAcr: acr,
        amr,
        authTime: authCode.authTime ?? authCode.createdAt,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
      sessionId,
    );

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

    return this.issueTokens(
      realm,
      user,
      client_id,
      session,
      authCode.scope ?? undefined,
      authCode.nonce ?? undefined,
      authCode.authTime ?? authCode.createdAt,
      acr,
      amr,
      authCode.code,
      await this.clientAllowsOfflineAccess(client.id),
    );
  }

  private async handleDeviceCodeGrant(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
    userAgent?: string,
    ctx: TokenRequestContext = {},
  ): Promise<TokenResponse> {
    const { device_code, client_id } = body;

    if (!device_code) {
      throw new OAuthTokenError(
        'invalid_request',
        'device_code is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.validateClient(
      realm,
      body,
      'urn:ietf:params:oauth:grant-type:device_code',
      { ctx },
    );

    const deviceCode = await this.prisma.deviceCode.findUnique({
      where: { deviceCode: device_code },
    });

    if (!deviceCode || deviceCode.realmId !== realm.id) {
      throw new OAuthTokenError(
        'authorization_pending',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (deviceCode.expiresAt < new Date()) {
      throw new OAuthTokenError(
        'expired_token',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (deviceCode.denied) {
      throw new OAuthTokenError(
        'access_denied',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!deviceCode.approved || !deviceCode.userId) {
      throw new OAuthTokenError(
        'authorization_pending',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
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
        throw new OAuthTokenError(
          'slow_down',
          undefined,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Polling is within the allowed window — record the timestamp.
    await this.prisma.deviceCode.update({
      where: { id: deviceCode.id },
      data: { lastPolledAt: new Date() },
    });

    if (!deviceCode.approved || !deviceCode.userId) {
      throw new OAuthTokenError(
        'authorization_pending',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Device has been approved — issue tokens
    const user = await this.prisma.user.findUnique({
      where: { id: deviceCode.userId },
    });
    if (!user) {
      throw new OAuthTokenError(
        'invalid_grant',
        'User not found',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check MFA — device code flow does not support interactive MFA
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
    if (mfaEnabled) {
      throw new OAuthTokenError(
        'invalid_grant',
        'MFA verification required. Device code grant does not support MFA. Use authorization_code grant instead.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const mfaRequired = await this.mfaService.isMfaRequired(realm, user.id);
    if (mfaRequired) {
      throw new OAuthTokenError(
        'invalid_grant',
        'MFA setup required. Use authorization_code grant to complete MFA setup.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Clean up the device code
    await this.prisma.deviceCode.delete({ where: { id: deviceCode.id } });

    const session = this.newSession({
      userId: user.id,
      ipAddress: ip,
      userAgent,
      expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
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
      session,
      deviceCode.scope ?? undefined,
      undefined,
      new Date(),
      undefined,
      undefined,
      undefined,
      await this.clientAllowsOfflineAccess(client.id),
    );
  }

  /** Second factors a user can answer an API MFA challenge with. */
  private async availableMfaMethods(
    realm: Realm,
    userId: string,
  ): Promise<string[]> {
    const factors = await this.mfaService.getEnrolledFactors(userId);
    const methods: string[] = [];
    if (factors.includes('totp')) methods.push('totp');
    if (factors.includes('sms') && SmsOtpService.canDeliver(realm)) {
      methods.push('sms');
    }
    methods.push('recovery');
    return methods;
  }

  /**
   * Text a code for an API MFA challenge (from the password grant's
   * `mfa_required` response) to the user's enrolled phone. The client must
   * authenticate as for the mfa_otp grant, and the code only answers that
   * challenge.
   */
  async sendMfaSms(
    realm: Realm,
    body: Record<string, string>,
    ip?: string,
  ): Promise<{
    masked_phone: string;
    expires_in: number;
    resend_after: number;
  }> {
    const { client_id, mfa_token } = body;
    await this.validateClient(
      realm,
      body,
      'urn:ietf:params:oauth:grant-type:mfa-otp',
    );
    if (!mfa_token) {
      throw new OAuthTokenError(
        'invalid_request',
        'mfa_token is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const challenge = await this.mfaService.getMfaChallenge(mfa_token);
    if (
      !challenge ||
      challenge.realmId !== realm.id ||
      (challenge.clientId && challenge.clientId !== client_id)
    ) {
      throw new OAuthTokenError(
        'invalid_grant',
        'Invalid or expired MFA token, or too many failed attempts',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.smsOtp) {
      throw new OAuthTokenError(
        'invalid_request',
        'Text message verification is not available.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const sent = await this.smsOtp.sendCode({
        realm,
        userId: challenge.userId,
        purpose: 'login',
        binding: mfa_token,
        ip,
      });
      const now = Date.now();
      return {
        masked_phone: sent.maskedPhone,
        expires_in: Math.round((sent.expiresAt.getTime() - now) / 1000),
        resend_after: Math.max(
          0,
          Math.round((sent.resendAvailableAt.getTime() - now) / 1000),
        ),
      };
    } catch (err) {
      if (err instanceof SmsOtpError) {
        throw new OAuthTokenError(
          err.code === 'cooldown' || err.code === 'rate_limited'
            ? 'slow_down'
            : 'invalid_request',
          err.message,
          err.code === 'send_failed'
            ? HttpStatus.SERVICE_UNAVAILABLE
            : err.code === 'cooldown' || err.code === 'rate_limited'
              ? HttpStatus.TOO_MANY_REQUESTS
              : HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }
  }

  /**
   * Authenticates the client of a token request (see ClientAuthenticator)
   * and checks it may use the grant. The grant check runs once the client is
   * known and before its secret is checked, so a disallowed grant is
   * `unauthorized_client` whatever the secret.
   */
  private async validateClient(
    realm: Realm,
    body: Record<string, string>,
    grantType?: string,
    opts: { skipSecret?: boolean; ctx?: TokenRequestContext } = {},
  ) {
    const { client } = await this.clientAuthenticator.authenticate({
      realm,
      body,
      authorization: opts.ctx?.authorization,
      clientCert: opts.ctx?.clientCert,
      skipCredentialCheck: opts.skipSecret === true,
      beforeCredentialCheck: grantType
        ? (client) => assertGrantAllowed(client, grantType)
        : undefined,
    });
    return client;
  }

  private async issueTokens(
    realm: Realm,
    user: UserClaimSource,
    clientId: string,
    /**
     * The session the tokens belong to: the id of an existing one (refresh,
     * a browser login's code), a new one from `newSession`, which is created
     * here together with its refresh token, or `null` for a session-less
     * access token alone: no `sid`, no refresh token, no ID token. That is
     * what a service account gets from client_credentials (RFC 6749 §4.4.3).
     */
    session: string | NewSession | null,
    scope?: string,
    nonce?: string,
    authTime?: Date,
    acr?: string,
    amr?: string[],
    code?: string,
    /**
     * Whether `offline_access` may be granted (OIDC Core §11): only for a
     * code-returning grant of a client with that scope assigned, or when
     * refreshing a token that already is offline. Otherwise it is dropped.
     */
    offlineAccess = false,
  ): Promise<TokenResponse> {
    const sessionId =
      typeof session === 'string' ? session : (session?.id ?? null);
    const signingKey = await this.getActiveSigningKey(realm.id);

    // Parse and validate scopes, default to openid
    const scopes = this.scopesService
      .parseAndValidate(scope)
      .filter((s) => offlineAccess || s !== 'offline_access');
    const effectiveScopes = scopes.length > 0 ? scopes : ['openid'];
    const validatedScope = this.scopesService.toString(effectiveScopes);

    // Resolve scope-filtered user claims
    const allowedClaims =
      this.scopesService.getClaimsForScopes(effectiveScopes);
    // The user's roles (direct and through groups) and attribute claims,
    // from the in-process cache. A copy: the token payload, the mappers and
    // the enrichment plugins below may all modify what they are given.
    const { attributeClaims, realmRoles, resourceAccess } = structuredClone(
      await this.lookups.userGrants(user.id, () =>
        loadUserGrants(this.prisma, this.customAttributesService, user.id),
      ),
    );
    const userClaims = resolveUserClaims(user, allowedClaims, attributeClaims);

    // Include roles by default (backward compat) or when 'roles' scope is granted
    const includeRoles = !scope || allowedClaims.has('realm_access');

    // Try to apply protocol mappers from DB scopes
    let mapperClaims: Record<string, unknown> = {};
    try {
      const mappers = structuredClone(
        await this.lookups.scopeMappers(realm.id, effectiveScopes, () =>
          this.scopesService.getScopeMappers(effectiveScopes, realm.id),
        ),
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

    // Claims the server decides. Protocol mappers and enrichment plugins run
    // after them and may add claims, but never change or remove these.
    const protectedClaims: JWTPayload = {
      iss: this.getIssuer(realm),
      sub: user.id,
      aud: clientId,
      scope: validatedScope,
      typ: 'Bearer',
      azp: clientId,
      ...(sessionId ? { sid: sessionId } : {}),
      // RFC 9068 §2.2: surface the authentication context (acr) and methods
      // (amr) in the access token too, so a resource server can make step-up /
      // assurance decisions from the bearer token without needing the id_token.
      // Mirror the id_token resolution (default acr = password).
      acr: acr ?? ACR_PASSWORD,
      ...(amr && amr.length > 0 ? { amr } : {}),
    };

    const accessTokenPayload: JWTPayload = {
      ...protectedClaims,
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
    const enrichedPayload = withProtectedClaims(
      this.pluginManager
        ? await this.pluginManager.enrichToken(
            accessTokenPayload,
            { ...user },
            realm.name,
          )
        : accessTokenPayload,
      protectedClaims,
    );

    const accessToken = await this.jwkService.signJwt(
      enrichedPayload,
      signingKey.privateKey,
      signingKey.kid,
      realm.accessTokenLifespan,
    );

    if (sessionId === null) {
      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: realm.accessTokenLifespan,
        scope: validatedScope,
      };
    }

    // Determine if this is an offline token
    const isOffline = effectiveScopes.includes('offline_access');
    const refreshLifespan = isOffline
      ? realm.offlineTokenLifespan
      : realm.refreshTokenLifespan;

    // Generate opaque refresh token
    const rawRefreshToken = this.crypto.generateSecret(64);
    const refreshTokenHash = this.crypto.sha256(rawRefreshToken);

    const refreshToken = {
      tokenHash: refreshTokenHash,
      scope: validatedScope,
      expiresAt: new Date(Date.now() + refreshLifespan * 1000),
      isOffline,
      clientId,
    };
    if (typeof session === 'string') {
      try {
        await this.prisma.refreshToken.create({
          data: { ...refreshToken, sessionId },
        });
      } catch (err) {
        // The session ended (logout, revocation, or evicted by a newer
        // login) after this request was authorised: that is a grant that
        // no longer holds, not a server error.
        if ((err as { code?: string }).code === 'P2003') {
          throw new OAuthTokenError(
            'invalid_grant',
            'The session has ended',
            HttpStatus.BAD_REQUEST,
          );
        }
        throw err;
      }
    } else if (session) {
      // A new session and its refresh token are one write, so no concurrent
      // login can evict the session while it has no token yet. The cap is
      // enforced afterwards, against the user's other sessions only.
      await this.prisma.session.create({
        data: {
          ...session.data,
          id: session.id,
          refreshTokens: { create: refreshToken },
        },
      });
      await this.enforceSessionLimit(realm, session);
    }

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
        attributeClaims,
      });
    }

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: realm.accessTokenLifespan,
      refresh_token: rawRefreshToken,
      scope: validatedScope,
      session_state: sessionId,
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
    attributeClaims: Record<string, string>;
  }): Promise<string> {
    const allowedClaims = this.scopesService.getClaimsForScopes(params.scopes);
    const userClaims = resolveUserClaims(
      params.user,
      allowedClaims,
      params.attributeClaims,
    );

    // Resolve the ACR claim:
    //  - Use explicitly provided acr (from step-up flow) if available
    //  - Otherwise default to ACR_PASSWORD ("urn:idenplane:acr:password")
    const resolvedAcr = params.acr ?? ACR_PASSWORD;

    // User claims first: an attribute mapped to a registered claim name must
    // not replace the server's value.
    const idTokenPayload: JWTPayload = {
      ...userClaims,
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
    const key = await this.lookups.activeSigningKey(realmId);
    if (!key) {
      throw new Error('No active signing key found for realm');
    }
    return key;
  }

  private getIssuer(realm: Realm): string {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    return `${baseUrl}/realms/${realm.name}`;
  }

  /**
   * A session for a fresh sign-in, not yet written: `issueTokens` creates it
   * together with its refresh token and then applies the realm's session
   * cap. Its id and creation time are fixed now, so the tokens and login
   * events can name it and the cap can order it against concurrent logins.
   */
  private newSession(
    data: Omit<
      Prisma.SessionUncheckedCreateInput,
      'id' | 'refreshTokens' | 'createdAt'
    >,
    id: string = randomUUID(),
  ): NewSession {
    const now = new Date();
    // auth_time defaults to now: the password, MFA and device grants
    // authenticate the user in this request.
    return {
      id,
      data: { ...data, authTime: data.authTime ?? now, createdAt: now },
    };
  }

  /**
   * An administrator opts a client into offline tokens by assigning it the
   * `offline_access` client scope (default or optional).
   */
  private async clientAllowsOfflineAccess(
    clientDbId: string,
  ): Promise<boolean> {
    const where = {
      clientId: clientDbId,
      clientScope: { name: 'offline_access' },
    };
    const [asDefault, asOptional] = await Promise.all([
      this.prisma.clientDefaultScope.count({ where }),
      this.prisma.clientOptionalScope.count({ where }),
    ]);
    return asDefault + asOptional > 0;
  }

  /**
   * RFC 6749 §4.1.2: when a used code is presented again, revoke the tokens
   * issued from it. Ending their session deletes its refresh tokens and makes
   * its access tokens introspect as inactive (they carry its `sid`).
   *
   * Only the code's own client can trigger this, proving itself the way the
   * exchange does (its secret, already checked, or the PKCE verifier), and only
   * shortly after the code expired: a used code that leaked later must not let
   * anyone end the user's session.
   */
  private async revokeReplayedCode(
    code: string,
    client: { id: string; clientType: string },
    codeVerifier: string | undefined,
  ): Promise<void> {
    const replayed = await this.prisma.authorizationCode.findUnique({
      where: { code },
      select: {
        used: true,
        sessionId: true,
        clientId: true,
        codeChallenge: true,
        expiresAt: true,
      },
    });
    if (!replayed?.used || !replayed.sessionId) return;
    if (replayed.clientId !== client.id) return;
    if (Date.now() > replayed.expiresAt.getTime() + REPLAY_REVOCATION_WINDOW_MS)
      return;
    if (client.clientType !== 'CONFIDENTIAL') {
      const proven =
        !!replayed.codeChallenge &&
        !!codeVerifier &&
        Buffer.from(this.crypto.sha256(codeVerifier), 'hex').toString(
          'base64url',
        ) === replayed.codeChallenge;
      if (!proven) return;
    }
    await this.prisma.session.deleteMany({
      where: { id: replayed.sessionId },
    });
    this.logger.warn(
      `Authorization code replayed by client ${client.id}; revoked the tokens issued from it`,
    );
  }

  /**
   * Enforce the per-realm maximum concurrent OAuth sessions for a user, right
   * after `session` was created: of the user's sessions *older* than it, all
   * but the newest `maxSessionsPerUser - 1` are deleted (FIFO), so with the
   * new one the user is at the cap.
   *
   * Only older sessions are considered. Concurrent sign-ins therefore never
   * evict each other's brand-new session from both sides (which, with a cap
   * of 1, would leave the user with none); the newest always survives, and
   * each newer sign-in trims what came before it.
   *
   * A `maxSessionsPerUser` value of 0 means "unlimited" — no eviction occurs.
   */
  private async enforceSessionLimit(
    realm: Realm,
    session: NewSession,
  ): Promise<void> {
    const maxSessions = (realm as Realm & { maxSessionsPerUser?: number })
      .maxSessionsPerUser;
    if (!maxSessions || maxSessions <= 0) return;

    const createdAt = session.data.createdAt as Date;
    const activeSessions = await this.prisma.session.findMany({
      where: {
        userId: session.data.userId,
        user: { realmId: realm.id },
        expiresAt: { gt: new Date() },
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, id: { lt: session.id } },
        ],
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

      // One statement: deleting a session deletes its refresh tokens
      // (ON DELETE CASCADE), so revoking them first only took more locks,
      // which concurrent sign-ins evicting overlapping sessions could take
      // in opposite orders and deadlock on. Eviction is housekeeping: the
      // new session is already written, so a failure here (a deadlock that
      // PostgreSQL broke by aborting this side) must not fail the sign-in;
      // the user's next sign-in trims again.
      try {
        await this.prisma.session.deleteMany({
          where: { id: { in: evictIds } },
        });
      } catch (err) {
        this.logger.warn(
          `Could not evict ${evictIds.length} old session(s) of user ${session.data.userId}: ${String(err)}`,
        );
      }
    }
  }
}
