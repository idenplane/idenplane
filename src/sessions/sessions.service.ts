import { Injectable, NotFoundException } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { revokeAdminTokensOfUser } from '../admin-auth/admin-token-revocation.js';
import { notIdleWhere } from './session-lifetime.js';
import {
  BackchannelLogoutService,
  type EndedSession,
} from '../tokens/backchannel-logout.service.js';

/** The realm whose users are the admins of the console. */
const MASTER_REALM = 'master';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly backchannelLogout: BackchannelLogoutService,
  ) {}

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
          ...notIdleWhere(realm),
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
          ...notIdleWhere(realm),
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
    type?: 'oauth' | 'sso',
  ): Promise<void> {
    // When the caller doesn't say which table the session lives in, try both.
    // Sessions are split across `Session` (OAuth-refresh-backed) and
    // `LoginSession` (hosted-form/SSO) — the listing endpoint returns both
    // as a merged list with a `type` field, but admins routinely paste the
    // id without threading the type through. Returning 404 when the id
    // exists in the *other* table is a UX cliff (#37).
    const tryOauth = !type || type === 'oauth';
    const trySso = !type || type === 'sso';

    if (tryOauth) {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          userId: true,
          user: {
            select: { realmId: true, realm: { select: { name: true } } },
          },
        },
      });
      if (session) {
        if (realm && session.user.realmId !== realm.id) {
          throw new NotFoundException('Session not found');
        }
        // Its clients, read while its refresh tokens still name them.
        const ended = await this.backchannelLogout.endedSessions([sessionId]);
        await this.prisma.refreshToken.updateMany({
          where: { sessionId },
          data: { revoked: true },
        });
        await this.prisma.session.delete({ where: { id: sessionId } });
        this.backchannelLogout.notifySessionsEnded(
          { id: session.user.realmId, name: session.user.realm.name },
          ended,
        );
        return;
      }
      if (type === 'oauth') {
        throw new NotFoundException('Session not found');
      }
      // fall through to sso when type was unspecified
    }

    if (trySso) {
      const loginSession = await this.prisma.loginSession.findUnique({
        where: { id: sessionId },
        select: { realmId: true },
      });
      if (loginSession) {
        if (realm && loginSession.realmId !== realm.id) {
          throw new NotFoundException('Session not found');
        }
        await this.prisma.loginSession.delete({ where: { id: sessionId } });
        return;
      }
    }

    throw new NotFoundException('Session not found');
  }

  /**
   * Signs a user out everywhere in this realm, in one transaction:
   *
   * - every OAuth session ends and its refresh tokens are revoked, offline
   *   ones included;
   * - every browser SSO session ends, except the one named by
   *   `keepLoginSessionTokenHash` (the caller's own, when a user changes
   *   their password in the account console);
   * - every forward-auth proxy session ends;
   * - for a `master` realm user, every admin console token they hold stops
   *   working (see admin-auth/admin-token-revocation.ts).
   *
   * Used by the admin "sign out all sessions", disabling a user, SCIM
   * deactivation, and every credential change: a password set or reset by
   * an admin or by the user, and an admin removing a user's second factors.
   * Access tokens already issued stay valid until they expire
   * (`accessTokenLifespan`); they are stateless JWTs.
   *
   * Every statement selects by user and realm, not by a list read first, so
   * a session created while this runs cannot be missed. Only users of this
   * realm are touched (cross-realm IDOR): a user id from another realm
   * matches nothing.
   *
   * Once the transaction has committed, every client an ended OAuth session
   * was used with gets a back-channel logout token (offline sessions
   * included: their offline tokens are revoked too). That runs in the
   * background and cannot fail or slow down this call.
   */
  async revokeAllUserSessions(
    realm: Pick<Realm, 'id' | 'name'>,
    userId: string,
    options: { keepLoginSessionTokenHash?: string } = {},
  ): Promise<void> {
    const ofUser = { userId, user: { realmId: realm.id } };
    const keep = options.keepLoginSessionTokenHash;
    const [, ended] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { session: ofUser },
        data: { revoked: true },
      }),
      // Deleting a session deletes its refresh tokens (ON DELETE CASCADE);
      // revoking them first also ends a refresh racing with this one. The
      // statement returns what it deleted, with the clients named by each
      // session's refresh tokens (still visible to it), so exactly the
      // sessions that ended are announced.
      this.prisma.$queryRaw<EndedSession[]>`
        DELETE FROM "sessions" AS s
         USING "users" AS u
         WHERE u."id" = s."user_id"
           AND u."realm_id" = ${realm.id}
           AND s."user_id" = ${userId}
        RETURNING s."id" AS "id", s."user_id" AS "userId",
          ARRAY(SELECT DISTINCT rt."client_id"
                  FROM "refresh_tokens" AS rt
                 WHERE rt."session_id" = s."id"
                   AND rt."client_id" IS NOT NULL) AS "clientIds"`,
      this.prisma.loginSession.deleteMany({
        where: {
          userId,
          realmId: realm.id,
          ...(keep ? { tokenHash: { not: keep } } : {}),
        },
      }),
      this.prisma.proxySession.deleteMany({ where: ofUser }),
      ...(realm.name === MASTER_REALM
        ? [revokeAdminTokensOfUser(this.prisma, userId)]
        : []),
    ]);
    this.backchannelLogout.notifySessionsEnded(realm, ended);
  }
}
