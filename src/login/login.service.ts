import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import type { Realm, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { UserFederationService } from '../user-federation/user-federation.service.js';
import { PasswordMigrationService } from '../migration/password-migration.service.js';

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

    const maxSessions = realm.maxSessionsPerUser;
    if (maxSessions !== undefined && maxSessions > 0) {
      // Count active SSO (login) sessions for this user in this realm
      const activeSessions = await this.prisma.loginSession.findMany({
        where: {
          userId: user.id,
          realmId: realm.id,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      // FIFO eviction: delete the oldest sessions until we are below the limit
      if (activeSessions.length >= maxSessions) {
        const toDelete = activeSessions.slice(
          0,
          activeSessions.length - maxSessions + 1,
        );
        await this.prisma.loginSession.deleteMany({
          where: { id: { in: toDelete.map((s) => s.id) } },
        });
      }
    }

    const token = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(token);

    await this.prisma.loginSession.create({
      data: {
        userId: user.id,
        realmId: realm.id,
        tokenHash,
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + realm.refreshTokenLifespan * 1000),
      },
    });

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

    return session.user;
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
