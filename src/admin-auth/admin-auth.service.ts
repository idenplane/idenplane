import {
  Injectable,
  UnauthorizedException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  /**
   * Maps a raw admin token string to its expiry unix timestamp (seconds).
   * Using a Map instead of a Set lets us evict only truly expired entries
   * rather than clearing the entire collection when it grows large.
   */
  private readonly revokedTokens = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly rateLimitService: RateLimitService,
    private readonly bruteForceService: BruteForceService,
  ) {}

  async login(
    username: string,
    password: string,
    ip: string = 'unknown',
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    rateLimitHeaders: Record<string, string>;
  }> {
    // ── IP-based rate limiting ────────────────────────────────────────────────
    // Applied before any DB work so it protects at network-edge cost.
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

    // ── Reset brute-force counters on successful login ────────────────────────
    await this.bruteForceService.resetFailures(masterRealm.id, user.id);

    // Sign admin JWT with master realm signing key
    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: masterRealm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });

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
      },
      signingKey.privateKey,
      signingKey.kid,
      3600, // 1 hour
    );

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      rateLimitHeaders,
    };
  }

  revokeToken(token: string, expiresInSeconds = 3600): void {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    this.revokedTokens.set(token, expiresAt);
    // Evict only expired entries to prevent unbounded growth.
    // Never clear the whole map — that would make revoked tokens valid again.
    this.evictExpiredRevokedTokens();
  }

  private evictExpiredRevokedTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [token, expiresAt] of this.revokedTokens) {
      if (expiresAt <= now) {
        this.revokedTokens.delete(token);
      }
    }
  }

  async validateAdminToken(
    token: string,
  ): Promise<{ userId: string; roles: string[] }> {
    const revokedExpiry = this.revokedTokens.get(token);
    if (
      revokedExpiry !== undefined &&
      revokedExpiry > Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const masterRealm = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });

    if (!masterRealm) {
      throw new UnauthorizedException('Admin system not initialized');
    }

    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: masterRealm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!signingKey) {
      throw new UnauthorizedException('No signing key found');
    }

    try {
      const payload = await this.jwkService.verifyJwt(
        token,
        signingKey.publicKey,
      );

      if (payload['typ'] !== 'admin') {
        throw new UnauthorizedException('Not an admin token');
      }

      const realmAccess = payload['realm_access'] as
        | { roles?: string[] }
        | undefined;
      const roles = realmAccess?.roles ?? [];

      return { userId: payload.sub as string, roles };
    } catch {
      throw new UnauthorizedException('Invalid admin token');
    }
  }

  hasRole(roles: string[], required: string): boolean {
    if (roles.includes('super-admin')) return true;
    return roles.includes(required);
  }
}
