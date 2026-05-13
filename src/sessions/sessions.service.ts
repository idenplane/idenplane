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
    // Get all session IDs for this user in this realm
    const sessions = await this.prisma.session.findMany({
      where: { userId, user: { realmId: realm.id } },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length > 0) {
      // Revoke all refresh tokens for these sessions in a single operation
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: sessionIds } },
        data: { revoked: true },
      });

      // Delete all sessions
      await this.prisma.session.deleteMany({
        where: { id: { in: sessionIds } },
      });
    }

    // Revoke all SSO sessions
    await this.prisma.loginSession.deleteMany({
      where: { userId, realmId: realm.id },
    });
  }
}
