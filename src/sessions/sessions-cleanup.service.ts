import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BackchannelLogoutService,
  type EndedSession,
} from '../tokens/backchannel-logout.service.js';

/** An idle OAuth session the clean-up deleted, with its realm. */
interface IdleSessionRow extends EndedSession {
  realmId: string;
  realmName: string;
}

@Injectable()
export class SessionsCleanupService {
  private readonly logger = new Logger(SessionsCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backchannelLogout: BackchannelLogoutService,
  ) {}

  @Interval(3_600_000) // every hour
  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();

    // Delete expired OAuth sessions.  RefreshTokens are deleted automatically
    // via the onDelete: Cascade relation defined in the Prisma schema.
    // An offline session's expiresAt is set from the realm's offline
    // lifespan when it is created (sessions/session-lifetime.ts), so this
    // keeps offline tokens until their own session expires.  Runs on every
    // instance: deleting what has expired is idempotent, so no leader is
    // needed.
    const oauthResult = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired SSO / browser login sessions.
    const ssoResult = await this.prisma.loginSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete SSO sessions gone idle in realms with an idle timeout. They are
    // already refused when used (LoginService.validateLoginSession); this
    // only keeps them from piling up. The timeout is per realm, so the
    // comparison needs the realm's column. Prisma stores timestamps as UTC
    // in a column without a time zone, hence `now() AT TIME ZONE 'UTC'`.
    const idleCount = await this.prisma.$executeRaw`
      DELETE FROM "login_sessions" AS ls
       USING "realms" AS r
       WHERE r."id" = ls."realm_id"
         AND r."sso_session_idle_timeout" > 0
         AND ls."last_activity_at" <
             (now() AT TIME ZONE 'UTC')
             - make_interval(secs => r."sso_session_idle_timeout")`;

    // End OAuth sessions gone idle. A normal session's refresh token is
    // issued for at most the realm's idle timeout (session-lifetime.ts), so
    // once every token it has is past its expiry (each rotation issues a
    // later one, so this is the newest token going unused) it can never be
    // used again: it has ended, though its expiresAt is still ahead. A
    // session whose tokens were revoked but have not expired is not idle and
    // is left alone, as before. Delete it
    // and tell its clients (back-channel logout), as for any other ended
    // session. Offline sessions are exempt by construction: an offline
    // token lives for the offline lifespan, so a session holding one still
    // has a live token. A session with no refresh token at all (an
    // impersonation session) is left to its expiry. This runs before the
    // refresh token clean-up below, which would otherwise delete the expired
    // tokens that name the session's clients.
    const idleSessions = await this.prisma.$queryRaw<IdleSessionRow[]>`
      DELETE FROM "sessions" AS s
       USING "users" AS u, "realms" AS r
       WHERE u."id" = s."user_id"
         AND r."id" = u."realm_id"
         AND r."sso_session_idle_timeout" > 0
         AND s."expires_at" >= (now() AT TIME ZONE 'UTC')
         AND EXISTS (SELECT 1 FROM "refresh_tokens" AS rt
                      WHERE rt."session_id" = s."id")
         AND NOT EXISTS (SELECT 1 FROM "refresh_tokens" AS rt
                          WHERE rt."session_id" = s."id"
                            AND rt."expires_at" >= (now() AT TIME ZONE 'UTC'))
      RETURNING s."id" AS "id", s."user_id" AS "userId",
        r."id" AS "realmId", r."name" AS "realmName",
        ARRAY(SELECT DISTINCT rt."client_id"
                FROM "refresh_tokens" AS rt
               WHERE rt."session_id" = s."id"
                 AND rt."client_id" IS NOT NULL) AS "clientIds"`;
    this.announceEnded(idleSessions);

    // Delete any refresh tokens that have individually expired but whose
    // parent session is still alive (e.g. an offline session whose scope was
    // narrowed on refresh to a normal, shorter-lived refresh token).
    const refreshResult = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired authorization codes that were never exchanged.
    const authCodeResult = await this.prisma.authorizationCode.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired proxy (forward-auth) sessions. Nothing else prunes these:
    // the proxy only re-checks a session when its cookie expires, so without
    // this the table grows for the lifetime of the deployment.
    const proxyResult = await this.prisma.proxySession.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired impersonation sessions.
    const impersonationResult =
      await this.prisma.impersonationSession.deleteMany({
        where: { expiresAt: { lt: now } },
      });

    const total =
      oauthResult.count +
      ssoResult.count +
      idleCount +
      idleSessions.length +
      refreshResult.count +
      authCodeResult.count +
      proxyResult.count +
      impersonationResult.count;

    if (total > 0) {
      this.logger.debug(
        `Session cleanup removed ${oauthResult.count} OAuth session(s), ` +
          `${ssoResult.count} SSO session(s), ` +
          `${idleCount} idle SSO session(s), ` +
          `${idleSessions.length} idle OAuth session(s), ` +
          `${refreshResult.count} refresh token(s), ` +
          `${authCodeResult.count} authorization code(s), ` +
          `${proxyResult.count} proxy session(s), ` +
          `${impersonationResult.count} impersonation session(s)`,
      );
    }
  }

  /** Back-channel logout for deleted sessions, one dispatch per realm. */
  private announceEnded(rows: readonly IdleSessionRow[]): void {
    const byRealm = new Map<string, { name: string; ended: EndedSession[] }>();
    for (const row of rows) {
      const entry = byRealm.get(row.realmId) ?? {
        name: row.realmName,
        ended: [],
      };
      entry.ended.push({
        id: row.id,
        userId: row.userId,
        clientIds: row.clientIds,
      });
      byRealm.set(row.realmId, entry);
    }
    for (const [id, { name, ended }] of byRealm) {
      this.backchannelLogout.notifySessionsEnded({ id, name }, ended);
    }
  }
}
