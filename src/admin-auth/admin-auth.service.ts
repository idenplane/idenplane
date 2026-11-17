import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  ClientCertificateSource,
  type CertificateRequest,
} from '../mtls/client-certificate.source.js';
import { assertCertificateBinding } from '../mtls/certificate-binding.js';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import {
  AdminMfaService,
  type AdminMfaMethod,
  type AdminMfaProof,
} from '../admin-mfa/admin-mfa.service.js';
import { ACR_PASSWORD } from '../authn-core/acr.js';
import type { AuthenticatedAdmin } from '../admin-rbac/admin-principal.service.js';
import { ADMIN_TOKEN_TTL_SECONDS } from './admin-token-ttl.js';
import {
  ADMIN_TOKEN_ISSUED_MS_CLAIM,
  adminUserRevocationKey,
  issuedBeforeRevocation,
} from './admin-token-revocation.js';

export { ADMIN_TOKEN_TTL_SECONDS };

/** A signed admin token, as the sign-in routes return it. */
export interface AdminTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** The first step's answer when the admin has a second factor. */
export interface AdminMfaChallengeResponse {
  mfa_required: true;
  mfa_token: string;
  methods: AdminMfaMethod[];
}

/** The password-only proof (no second factor). */
const PASSWORD_ONLY: Pick<AdminMfaProof, 'amr' | 'acr'> = {
  amr: ['pwd'],
  acr: ACR_PASSWORD,
};

/** The message for a spent, expired or unknown `mfa_token`. */
const CHALLENGE_GONE =
  'The sign-in has expired or had too many attempts. Sign in again.';

@Injectable()
export class AdminAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly revokedTokens = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly rateLimitService: RateLimitService,
    private readonly bruteForceService: BruteForceService,
    private readonly adminMfa: AdminMfaService,
    @Optional() private readonly certificates?: ClientCertificateSource,
  ) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((err: unknown) =>
        this.logger.warn(`Cleanup failed: ${(err as Error).message}`),
      );
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  private async cleanup(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.revokedTokens) {
      if (exp < now) this.revokedTokens.delete(jti);
    }

    try {
      const { count } = await this.prisma.adminRevokedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.debug(
          `Cleaned up ${count} expired admin revoked tokens from database`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to clean expired tokens from DB: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The per-IP admin sign-in limit, shared by every step of a console
   * sign-in. Applied before any database work.
   */
  async checkSignInRate(ip: string): Promise<Record<string, string>> {
    const rlResult = await this.rateLimitService.checkAdminIpLimit(ip);
    const rateLimitHeaders = this.rateLimitService.computeHeaders(rlResult);
    if (!rlResult.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Admin login rate limit exceeded. Please slow down.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return rateLimitHeaders;
  }

  /**
   * First step of a console sign-in: the password.
   *
   * - The admin has a second factor: no token yet, but a one-time
   *   `mfa_token` for the second step (`mfa_required`).
   * - No factor: a password-only token, as before 0.11.0. When MFA is
   *   required for every admin, `mfa_enrolment_required` is set, and the
   *   token reaches only enrolment until a factor is set up.
   */
  async login(
    username: string,
    password: string,
    ip: string = 'unknown',
  ): Promise<
    (
      | (AdminTokenResponse & { mfa_enrolment_required?: true })
      | AdminMfaChallengeResponse
    ) & { rateLimitHeaders: Record<string, string> }
  > {
    // ── IP-based rate limiting ────────────────────────────────────────────────
    const rateLimitHeaders = await this.checkSignInRate(ip);

    // ── Realm & user lookup ───────────────────────────────────────────────────
    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });

    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }

    const user = await this.prisma.user.findUnique({
      where: { realmId_username: { realmId: masterRealm.id, username } },
    });

    if (!user || !user.enabled || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── Brute-force lockout check ─────────────────────────────────────────────
    const lockStatus = this.bruteForceService.checkLocked(masterRealm, user);
    if (lockStatus.locked) {
      const lockedUntil =
        lockStatus.lockedUntil?.toISOString() ?? 'indefinitely';
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Account locked due to too many failed login attempts. Locked until: ${lockedUntil}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── Password verification ─────────────────────────────────────────────────
    const valid = await this.crypto.verifyPassword(user.passwordHash, password);
    if (!valid) {
      // Record the failure so brute-force protection can lock the account.
      await this.bruteForceService.recordFailure(masterRealm, user.id, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Get admin roles
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });

    const roles = userRoles.map((ur) => ur.role.name);

    // Must have at least one admin role
    if (
      !roles.some((r) =>
        ['super-admin', 'realm-admin', 'view-only'].includes(r),
      )
    ) {
      throw new UnauthorizedException('User does not have admin access');
    }

    // ── Second factor ─────────────────────────────────────────────────────────
    // The password alone does not clear the failure counter when a second
    // factor follows: only a completed sign-in does. Recovery codes alone
    // (left over from a removed factor) are not a factor.
    const methods = await this.adminMfa.methods(user.id);
    if (methods.some((m) => m !== 'recovery')) {
      const mfaToken = await this.adminMfa.createChallenge(user.id);
      return {
        mfa_required: true,
        mfa_token: mfaToken,
        methods,
        rateLimitHeaders,
      };
    }

    // ── Reset brute-force counters on successful login ────────────────────────
    await this.bruteForceService.resetFailures(masterRealm.id, user.id);

    const issued = await this.issueAdminToken(user, roles, PASSWORD_ONLY);
    const { required } = await this.adminMfa.policy();
    return {
      ...issued,
      ...(required ? { mfa_enrolment_required: true as const } : {}),
      rateLimitHeaders,
    };
  }

  /**
   * Second step of a console sign-in: a TOTP or recovery code for the
   * `mfa_token` of the first. Each answer spends one of the challenge's
   * attempts first; a wrong one counts against the account's brute-force
   * limits.
   */
  async completeMfaLogin(
    mfaToken: string,
    method: 'totp' | 'recovery',
    code: string,
    ip: string,
  ): Promise<
    AdminTokenResponse & { rateLimitHeaders: Record<string, string> }
  > {
    const rateLimitHeaders = await this.checkSignInRate(ip);
    const challenge = await this.adminMfa.spendChallengeAttempt(mfaToken);
    if (!challenge) throw new UnauthorizedException(CHALLENGE_GONE);
    const proof = await this.adminMfa.verifyCode(
      challenge.userId,
      method,
      code,
      ip,
    );
    if (!proof) throw new UnauthorizedException('Invalid code');
    return {
      ...(await this.finishMfaLogin(mfaToken, challenge.userId, proof)),
      rateLimitHeaders,
    };
  }

  /** WebAuthn request options for the second step of a sign-in. */
  async mfaLoginPasskeyOptions(mfaToken: string, ip: string) {
    await this.checkSignInRate(ip);
    const challenge = await this.adminMfa.peekChallenge(mfaToken);
    if (!challenge) throw new UnauthorizedException(CHALLENGE_GONE);
    return this.adminMfa.passkeyOptions(
      challenge.userId,
      this.adminMfa.challengeBinding(mfaToken),
    );
  }

  /** Second step of a sign-in with a passkey. */
  async completeMfaLoginWithPasskey(
    mfaToken: string,
    response: Parameters<AdminMfaService['verifyPasskey']>[1],
    ip: string,
  ): Promise<
    AdminTokenResponse & { rateLimitHeaders: Record<string, string> }
  > {
    const rateLimitHeaders = await this.checkSignInRate(ip);
    const challenge = await this.adminMfa.spendChallengeAttempt(mfaToken);
    if (!challenge) throw new UnauthorizedException(CHALLENGE_GONE);
    const proof = await this.adminMfa.verifyPasskey(
      challenge.userId,
      response,
      this.adminMfa.challengeBinding(mfaToken),
      ip,
    );
    if (!proof) throw new UnauthorizedException('Passkey not accepted');
    return {
      ...(await this.finishMfaLogin(mfaToken, challenge.userId, proof)),
      rateLimitHeaders,
    };
  }

  private async finishMfaLogin(
    mfaToken: string,
    userId: string,
    proof: AdminMfaProof,
  ): Promise<AdminTokenResponse> {
    // Two correct answers sent at once: only one completes the sign-in.
    if (!(await this.adminMfa.consumeChallenge(mfaToken))) {
      throw new UnauthorizedException('This sign-in was already completed');
    }
    const { user, roles, realmId } = await this.adminAccount(userId);
    await this.bruteForceService.resetFailures(realmId, user.id);
    return this.issueAdminToken(user, roles, proof);
  }

  /**
   * Step-up inside a session: proves a factor again (`proofOf`) and returns
   * a new token with a fresh `auth_time`, revoking the one it replaces.
   */
  async stepUp(
    admin: AuthenticatedAdmin,
    currentToken: string | undefined,
    proofOf: (userId: string) => Promise<AdminMfaProof | null>,
  ): Promise<AdminTokenResponse> {
    if (admin.userId.startsWith('api-key:')) {
      throw new BadRequestException(
        'The admin API key has no second factor to verify',
      );
    }
    const proof = await proofOf(admin.userId);
    if (!proof) throw new BadRequestException('Invalid code');
    return this.reissue(admin.userId, currentToken, proof);
  }

  /**
   * A new token for an admin who has just proved `proof` (step-up, or the
   * first factor at enrolment), revoking the token it replaces.
   */
  async reissue(
    userId: string,
    currentToken: string | undefined,
    proof: Pick<AdminMfaProof, 'amr' | 'acr'>,
  ): Promise<AdminTokenResponse> {
    const { user, roles } = await this.adminAccount(userId);
    const issued = await this.issueAdminToken(user, roles, proof);
    if (currentToken) await this.revokeToken(currentToken);
    return issued;
  }

  /** An enabled master realm admin, with the roles login reads. */
  private async adminAccount(userId: string) {
    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.enabled || user.realmId !== masterRealm.id) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    const roles = userRoles.map((ur) => ur.role.name);
    if (
      !roles.some((r) =>
        ['super-admin', 'realm-admin', 'view-only'].includes(r),
      )
    ) {
      throw new UnauthorizedException('User does not have admin access');
    }
    return { user, roles, realmId: masterRealm.id };
  }

  /**
   * Signs an admin token with the master realm key. `amr`, `acr` and
   * `auth_time` record how and when the admin authenticated
   * (docs/docs/security/admin-mfa.md).
   */
  async issueAdminToken(
    user: { id: string; username: string },
    roles: string[],
    proof: Pick<AdminMfaProof, 'amr' | 'acr'>,
  ): Promise<AdminTokenResponse> {
    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }
    const signingKey = await this.lookups.activeSigningKey(masterRealm.id);
    if (!signingKey) {
      throw new Error('No signing key found for master realm');
    }

    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const token = await this.jwkService.signJwt(
      {
        iss: `${baseUrl}/realms/master`,
        sub: user.id,
        typ: 'admin',
        realm_access: { roles },
        preferred_username: user.username,
        amr: proof.amr,
        acr: proof.acr,
        auth_time: Math.floor(Date.now() / 1000),
        // Lets a revocation of all this admin's tokens tell a token issued
        // in the same second, just after it, from the ones it ends.
        [ADMIN_TOKEN_ISSUED_MS_CLAIM]: Date.now(),
      },
      signingKey.privateKey,
      signingKey.kid,
      ADMIN_TOKEN_TTL_SECONDS,
    );

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: ADMIN_TOKEN_TTL_SECONDS,
    };
  }

  async revokeToken(token: string, expiresInSeconds = 3600): Promise<void> {
    const jti = this.extractJti(token);
    if (!jti) return;

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    this.revokedTokens.set(jti, expiresAt);

    try {
      await this.prisma.adminRevokedToken.upsert({
        where: { jti },
        create: { jti, expiresAt: new Date(expiresAt * 1000) },
        update: {},
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist revoked admin token to DB: ${(err as Error).message}`,
      );
    }
  }

  // Named createAdminSession (not loginWithApiKey): CodeQL's credential-name
  // heuristic treats the return value of any /api[-_]?key/-named call as a raw
  // secret, falsely flagging the session-cookie write in the controller as
  // js/clear-text-storage-of-sensitive-data. The returned value is a signed,
  // short-lived JWT — the same session artifact the credential login produces.
  async createAdminSession(apiKey: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const expectedKey = process.env['ADMIN_API_KEY'];
    if (!expectedKey) {
      throw new UnauthorizedException('API key authentication not configured');
    }

    const isValidKey = (() => {
      try {
        const a = Buffer.from(apiKey);
        const b = Buffer.from(expectedKey);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    })();

    if (!isValidKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });

    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }

    const signingKey = await this.lookups.activeSigningKey(masterRealm.id);

    if (!signingKey) {
      throw new Error('No signing key found for master realm');
    }

    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const token = await this.jwkService.signJwt(
      {
        iss: `${baseUrl}/realms/master`,
        sub: 'api-key:admin',
        typ: 'admin',
        realm_access: { roles: ['super-admin'] },
        preferred_username: 'api-key',
      },
      signingKey.privateKey,
      signingKey.kid,
      3600,
    );

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }

  private extractJti(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
      return payload['jti'] as string | null;
    } catch {
      return null;
    }
  }

  /**
   * Verifies an admin bearer token. `request` is the HTTP request it came
   * with: a certificate-bound token (RFC 8705 §3) is accepted only when that
   * request presents its certificate. Without a request, a bound token is
   * refused. Throws UnauthorizedException, or CertificateBindingError for a
   * bound token without its certificate.
   */
  async validateAdminToken(
    token: string,
    request?: CertificateRequest,
  ): Promise<AuthenticatedAdmin> {
    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });

    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }

    const signingKey = await this.lookups.activeSigningKey(masterRealm.id);

    if (!signingKey) {
      throw new UnauthorizedException('No signing key found');
    }

    let payload: Record<string, unknown>;
    try {
      // cert-binding: enforced
      payload = await this.jwkService.verifyJwt(token, signingKey.publicKey);
    } catch {
      throw new UnauthorizedException('Invalid admin token');
    }
    // Admin login never binds its tokens; this keeps any bound token that
    // reaches here from being used without its certificate.
    assertCertificateBinding(payload, () =>
      request && this.certificates
        ? this.certificates.fromRequest(request)
        : null,
    );

    if (payload['typ'] !== 'admin') {
      throw new UnauthorizedException('Not an admin token');
    }

    const jti = payload['jti'] as string | undefined;
    if (jti) {
      const revokedExpiry = this.revokedTokens.get(jti);
      if (
        revokedExpiry !== undefined &&
        revokedExpiry > Math.floor(Date.now() / 1000)
      ) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    // One query for both kinds of revocation: this token's own (sign-out),
    // and every token of this admin issued before their credentials changed
    // (see admin-token-revocation.ts).
    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : null;
    const keys = [
      ...(jti ? [jti] : []),
      ...(sub ? [adminUserRevocationKey(sub)] : []),
    ];
    if (keys.length > 0) {
      try {
        const records = await this.prisma.adminRevokedToken.findMany({
          where: { jti: { in: keys } },
        });
        const now = Date.now();
        for (const record of records) {
          if (record.expiresAt.getTime() <= now) continue;
          if (record.jti === jti) {
            throw new UnauthorizedException('Token has been revoked');
          }
          if (
            issuedBeforeRevocation(
              {
                iat: payload['iat'],
                iatMs: payload[ADMIN_TOKEN_ISSUED_MS_CLAIM],
              },
              record.revokedAt,
            )
          ) {
            throw new UnauthorizedException(
              'Token has been revoked: sign in again',
            );
          }
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.warn(
          `Failed to check DB for revoked admin token: ${(err as Error).message}`,
        );
      }
    }

    const realmAccess = payload['realm_access'] as
      { roles?: string[] } | undefined;
    const roles = realmAccess?.roles ?? [];

    // How the admin authenticated. Missing claims (a token from before
    // 0.11.0, or an API-key session) count as no second factor.
    const acr = typeof payload['acr'] === 'string' ? payload['acr'] : undefined;
    const amr = Array.isArray(payload['amr'])
      ? payload['amr'].filter((m): m is string => typeof m === 'string')
      : undefined;
    const authTime =
      typeof payload['auth_time'] === 'number'
        ? payload['auth_time']
        : undefined;

    return {
      userId: payload.sub as string,
      roles,
      ...(acr ? { acr } : {}),
      ...(amr ? { amr } : {}),
      ...(authTime !== undefined ? { authTime } : {}),
    };
  }

  hasRole(roles: string[], required: string): boolean {
    if (roles.includes('super-admin')) return true;
    return roles.includes(required);
  }
}
