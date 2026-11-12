import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import type { LoginSession, Realm, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { UserFederationService } from '../user-federation/user-federation.service.js';
import { PasswordMigrationService } from '../migration/password-migration.service.js';
import { ACR_MFA, acrStrength, strongestAcr } from '../authn-core/acr.js';
import type { AuthContext } from '../authn-core/auth-context.js';

/** How an SSO session was established (OIDC acr / RFC 8176 amr). */
export type LoginSessionAuthContext = AuthContext;

@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly bruteForceService: BruteForceService,
    @Optional() private readonly federationService?: UserFederationService,
    @Optional() private readonly passwordMigration?: PasswordMigrationService,
  ) {}

  async validateCredentials(
    realm: Realm,
    username: string,
    password: string,
    ip?: string,
  ): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { realmId_username: { realmId: realm.id, username } },
    });

    // If user exists with a federation link, authenticate via LDAP
    if (user && user.federationLink && this.federationService) {
      if (!user.enabled) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const lockStatus = this.bruteForceService.checkLocked(realm, user);
      if (lockStatus.locked) {
        throw new UnauthorizedException(
          'Account is temporarily locked. Please try again later.',
        );
      }

      const result = await this.federationService.authenticateViaFederation(
        realm.id,
        username,
        password,
      );

      if (result.authenticated) {
        await this.bruteForceService.resetFailures(realm.id, user.id);
        return user;
      }

      await this.bruteForceService.recordFailure(realm, user.id, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Local user with password hash
    if (user && user.enabled && user.passwordHash) {
      const lockStatus = this.bruteForceService.checkLocked(realm, user);
      if (lockStatus.locked) {
        throw new UnauthorizedException(
          'Account is temporarily locked. Please try again later.',
        );
      }

      let valid = await this.crypto.verifyPassword(user.passwordHash, password);

      // If Argon2 fails, try migrated password format
      if (
        !valid &&
        user.passwordAlgorithm &&
        user.passwordAlgorithm !== 'argon2' &&
        this.passwordMigration
      ) {
        valid = await this.passwordMigration.verifyMigratedPassword(
          password,
          user.passwordHash,
          user.passwordAlgorithm,
        );
        if (valid) {
          // Upgrade hash to Argon2 on successful migrated login
          await this.passwordMigration.rehashToArgon2(user.id, password);
        }
      }

      if (!valid) {
        await this.bruteForceService.recordFailure(realm, user.id, ip);
        throw new UnauthorizedException('Invalid credentials');
      }

      await this.bruteForceService.resetFailures(realm.id, user.id);
      return user;
    }

    // User not found locally — try LDAP federation (import on first login)
    if (!user && this.federationService) {
      const result = await this.federationService.authenticateViaFederation(
        realm.id,
        username,
        password,
      );

      if (result.authenticated && result.userId) {
        const importedUser = await this.prisma.user.findUnique({
          where: { id: result.userId },
        });
        if (importedUser) {
          return importedUser;
        }
      }
    }

    throw new UnauthorizedException('Invalid credentials');
  }

  async createLoginSession(
    realm: Realm,
    user: User,
    ip?: string,
    userAgent?: string,
    existingSessionToken?: string,
    authContext: LoginSessionAuthContext = {},
  ): Promise<string> {
    // Session-fixation prevention: invalidate the pre-existing session cookie
    // before issuing a new one so an attacker cannot pre-plant a known token.
    if (existingSessionToken) {
      const oldTokenHash = this.crypto.sha256(existingSessionToken);
      await this.prisma.loginSession
        .delete({ where: { tokenHash: oldTokenHash } })
        .catch(() => {
          // Session may already be expired/absent — silently ignore.
        });
    }

    const token = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(token);

    const created = await this.prisma.loginSession.create({
      data: {
        userId: user.id,
        realmId: realm.id,
        tokenHash,
        ipAddress: ip,
        userAgent,
        satisfiedAcr: authContext.acr ?? null,
        amr: authContext.amr ?? [],
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
      select: { id: true, createdAt: true },
    });

    // FIFO eviction after the new session exists, against the user's older
    // sessions only: concurrent sign-ins never evict each other from both
    // sides (with a cap of 1 that would leave none), the newest survives,
    // and each newer sign-in trims what came before it.
    const maxSessions = realm.maxSessionsPerUser;
    if (maxSessions !== undefined && maxSessions > 0) {
      const others = await this.prisma.loginSession.findMany({
        where: {
          userId: user.id,
          realmId: realm.id,
          expiresAt: { gt: new Date() },
          OR: [
            { createdAt: { lt: created.createdAt } },
            { createdAt: created.createdAt, id: { lt: created.id } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (others.length >= maxSessions) {
        const toDelete = others.slice(0, others.length - maxSessions + 1);
        await this.prisma.loginSession.deleteMany({
          where: { id: { in: toDelete.map((s) => s.id) } },
        });
      }
    }

    return token;
  }

  async validateLoginSession(
    realm: Realm,
    sessionToken: string,
  ): Promise<User | null> {
    const tokenHash = this.crypto.sha256(sessionToken);

    const session = await this.prisma.loginSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.realmId !== realm.id ||
      session.expiresAt < new Date()
    ) {
      return null;
    }

    if (!session.user.enabled) {
      return null;
    }

    if (realm.mfaRequired && !(await this.sessionSatisfiesMfa(session))) {
      return null;
    }

    return session.user;
  }

  /**
   * In a realm that requires MFA, an SSO session only counts once a second
   * factor is behind it: either it was established with one, or a step-up has
   * raised it since. Every reader of IDENPLANE_SESSION goes through
   * `validateLoginSession`, so this one check covers silent SSO, SAML, the
   * account pages and the admin step-up flows alike — including password-only
   * sessions that predate this check or the realm turning MFA on.
   */
  private async sessionSatisfiesMfa(session: {
    id: string;
    satisfiedAcr: string | null;
  }): Promise<boolean> {
    if (acrStrength(session.satisfiedAcr) >= acrStrength(ACR_MFA)) return true;
    const stepUps = await this.prisma.stepUpRecord.findMany({
      where: { sessionId: session.id, expiresAt: { gt: new Date() } },
      select: { acrLevel: true },
    });
    const acr = strongestAcr(
      session.satisfiedAcr,
      ...stepUps.map((s) => s.acrLevel),
    );
    return acrStrength(acr) >= acrStrength(ACR_MFA);
  }

  /**
   * The login session behind an SSO session token, as stored: no realm,
   * expiry or user checks (`validateLoginSession` does those).
   */
  async findLoginSession(sessionToken: string): Promise<LoginSession | null> {
    const tokenHash = this.crypto.sha256(sessionToken);
    return this.prisma.loginSession.findUnique({ where: { tokenHash } });
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findUserByUsername(
    realm: Realm,
    username: string,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { realmId_username: { realmId: realm.id, username } },
    });
  }
}
