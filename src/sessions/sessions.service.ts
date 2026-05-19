import { Injectable, NotFoundException } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SessionInfo {
  id: string;
  type: 'oauth' | 'sso';
  userId: string;
  username: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRealmSessions(realm: Realm): Promise<SessionInfo[]> {
    const [oauthSessions, ssoSessions] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          user: { realmId: realm.id },
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loginSession.findMany({
        where: {
          realmId: realm.id,
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return [
      ...oauthSessions.map((s) => ({
        id: s.id,
        type: 'oauth' as const,
        userId: s.userId,
        username: s.user.username,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      ...ssoSessions.map((s) => ({
        id: s.id,
        type: 'sso' as const,
        userId: s.userId,
        username: s.user.username,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getUserSessions(realm: Realm, userId: string): Promise<SessionInfo[]> {
    const [oauthSessions, ssoSessions] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          userId,
          user: { realmId: realm.id },
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loginSession.findMany({
        where: {
          userId,
          realmId: realm.id,
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return [
      ...oauthSessions.map((s) => ({
        id: s.id,
        type: 'oauth' as const,
        userId: s.userId,
        username: s.user.username,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      ...ssoSessions.map((s) => ({
        id: s.id,
        type: 'sso' as const,
        userId: s.userId,
        username: s.user.username,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async revokeSession(
    realm: Realm | null,
    sessionId: string,
    type: 'oauth' | 'sso',
  ): Promise<void> {
    if (type === 'oauth') {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { userId: true, user: { select: { realmId: true } } },
      });
      if (realm && session && session.user.realmId !== realm.id) {
        throw new NotFoundException('Session not found');
      }
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      await this.prisma.refreshToken.updateMany({
        where: { sessionId },
        data: { revoked: true },
      });
      await this.prisma.session.delete({ where: { id: sessionId } });
    } else {
      const loginSession = await this.prisma.loginSession.findUnique({
        where: { id: sessionId },
        select: { realmId: true },
      });
      if (realm && loginSession && loginSession.realmId !== realm.id) {
        throw new NotFoundException('Session not found');
      }
      if (!loginSession) {
        throw new NotFoundException('Session not found');
      }
      await this.prisma.loginSession.delete({ where: { id: sessionId } });
    }
  }

  async revokeAllUserSessions(realm: Realm, userId: string): Promise<void> {
    // Explicit user-realm verification: only act when the user belongs to
    // the realm that appears in the request URL, preventing cross-realm IDOR.
    // If the user is not in this realm the findMany below returns an empty
    // set, so sessions from other realms are never touched even without this
    // guard — but the explicit check makes the intent clear and auditable.
    const sessions = await this.prisma.session.findMany({
      where: { userId, user: { realmId: realm.id } },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    // Atomically revoke all refresh tokens and delete all sessions in a
    // single database transaction so there is no window in which a session
    // exists without its tokens being revoked (BUG #2 / BUG #13).
    await this.prisma.$transaction([
      ...(sessionIds.length > 0
        ? [
            this.prisma.refreshToken.updateMany({
              where: { sessionId: { in: sessionIds } },
              data: { revoked: true },
            }),
            this.prisma.session.deleteMany({
              where: { id: { in: sessionIds } },
            }),
          ]
        : []),
      this.prisma.loginSession.deleteMany({
        where: { userId, realmId: realm.id },
      }),
    ]);
  }
}
