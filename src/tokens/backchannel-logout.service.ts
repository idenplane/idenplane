import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { createConcurrencyLimiter } from '../common/utils/concurrency-limiter.util.js';
import type { Realm } from '@prisma/client';

/** The `events` member of a logout token (Back-Channel Logout 1.0 §2.4). */
export const BACKCHANNEL_LOGOUT_EVENT =
  'http://schemas.openid.net/event/backchannel-logout';

/** The explicit JWT type of a logout token (Back-Channel Logout 1.0 §2.4). */
export const LOGOUT_TOKEN_TYPE = 'logout+jwt';

/** How long a logout token is valid. The RP checks it on receipt. */
const LOGOUT_TOKEN_LIFETIME_SECONDS = 120;

/** How long one POST to an RP may take before it is abandoned. */
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * At most this many logout tokens are in flight at once, process-wide, so
 * signing a user out of many sessions, or many users at once (a SCIM
 * deactivation run), cannot open an unbounded number of connections.
 */
const MAX_CONCURRENT_DELIVERIES = 8;

/**
 * At most this many logout tokens wait for a slot. Beyond it a delivery is
 * dropped and logged rather than queued, so a burst cannot grow memory
 * without bound while slow RPs time out.
 */
const MAX_PENDING_DELIVERIES = 10_000;

/** A session that has ended, and the clients it was used with. */
export interface EndedSession {
  /** The session id: the `sid` its ID tokens carried. */
  id: string;
  /** Its user: the `sub` its tokens carried. */
  userId: string;
  /** The `client_id`s of the clients that hold tokens of the session. */
  clientIds: readonly (string | null)[];
}

export interface NotifyOptions {
  /**
   * The sessions are every OAuth session their users had (signing a user
   * out everywhere). Only then may a client that does not require `sid` get
   * a single `sub`-only token per user: a token without `sid` tells the RP
   * to end all of that user's sessions (Back-Channel Logout 1.0 §2.4).
   */
  allSessionsOfUser?: boolean;
}

interface LogoutTarget {
  clientId: string;
  uri: string;
  sub: string;
  sid?: string;
}

/**
 * OpenID Connect Back-Channel Logout 1.0, the OP side: tells relying
 * parties that sessions they hold have ended, by POSTing a signed logout
 * token to each client's registered `backchannel_logout_uri`.
 *
 * Every way a session ends calls `notifySessionsEnded` once the session is
 * gone from the database: RP-initiated logout, the admin API (one session or
 * all of a user's), the forced sign-out on a credential change, disabling a
 * user, SCIM deactivation, and the SSO idle timeout. See
 * docs/docs/guides/authentication.mdx ("Back-Channel Logout").
 *
 * Delivery is fire-and-forget: it runs after the caller's work has
 * committed, with a timeout and bounded concurrency, and a failure is logged,
 * never thrown. There is no retry: a logout token is valid for two minutes,
 * so a later retry would need a fresh token, and an RP that was unreachable
 * still ends the session when it next checks its tokens (the refresh token
 * and session are already revoked).
 */
@Injectable()
export class BackchannelLogoutService {
  private readonly logger = new Logger(BackchannelLogoutService.name);
  private readonly limit = createConcurrencyLimiter(MAX_CONCURRENT_DELIVERIES);
  private pending = 0;

  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
  ) {}

  /**
   * The sessions with these ids, and the clients each was used with. Read
   * it before deleting the sessions: deleting a session deletes its refresh
   * tokens, which are what name its clients.
   */
  async endedSessions(sessionIds: readonly string[]): Promise<EndedSession[]> {
    if (sessionIds.length === 0) return [];
    const sessions = await this.prisma.session.findMany({
      where: { id: { in: [...sessionIds] } },
      select: {
        id: true,
        userId: true,
        refreshTokens: { select: { clientId: true }, distinct: ['clientId'] },
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      clientIds: s.refreshTokens.map((t) => t.clientId),
    }));
  }

  /**
   * Send logout tokens for sessions that have ended. Call it after the
   * transaction that ended them has committed. Returns at once: the
   * deliveries run in the background and never throw.
   */
  notifySessionsEnded(
    realm: Pick<Realm, 'id' | 'name'>,
    sessions: readonly EndedSession[],
    options: NotifyOptions = {},
  ): void {
    if (!sessions.some((s) => s.clientIds.some((c) => c))) return;
    void this.dispatch(realm, sessions, options).catch((err: unknown) => {
      this.logger.warn(
        `Back-channel logout for realm ${realm.name} failed: ${errorMessage(err)}`,
      );
    });
  }

  /**
   * Resolves once every logout token for these sessions has been delivered
   * or has failed. Never rejects for a delivery failure.
   */
  async dispatch(
    realm: Pick<Realm, 'id' | 'name'>,
    sessions: readonly EndedSession[],
    options: NotifyOptions = {},
  ): Promise<void> {
    const clientIds = [
      ...new Set(
        sessions.flatMap((s) =>
          s.clientIds.filter((c): c is string => typeof c === 'string'),
        ),
      ),
    ];
    if (clientIds.length === 0) return;

    const clients = await this.prisma.client.findMany({
      where: {
        realmId: realm.id,
        clientId: { in: clientIds },
        backchannelLogoutUri: { not: null },
      },
      select: {
        clientId: true,
        backchannelLogoutUri: true,
        backchannelLogoutSessionRequired: true,
      },
    });
    if (clients.length === 0) return;

    const targets = logoutTargets(
      clients,
      sessions,
      options.allSessionsOfUser === true,
    );
    if (targets.length === 0) return;

    const signingKey = await this.lookups.activeSigningKey(realm.id);
    if (!signingKey) {
      this.logger.warn(
        `No active signing key in realm ${realm.name}: ${targets.length} back-channel logout token(s) not sent`,
      );
      return;
    }

    const issuer = `${process.env['BASE_URL'] ?? 'http://localhost:3000'}/realms/${realm.name}`;

    await Promise.all(
      targets.map((target) => {
        if (this.pending >= MAX_PENDING_DELIVERIES) {
          this.logger.warn(
            `Back-channel logout to ${target.clientId} in realm ${realm.name} dropped: ${MAX_PENDING_DELIVERIES} deliveries already pending`,
          );
          return Promise.resolve();
        }
        this.pending++;
        return this.limit(() =>
          this.deliver(realm, issuer, signingKey, target),
        ).finally(() => {
          this.pending--;
        });
      }),
    );
  }

  private async deliver(
    realm: Pick<Realm, 'name'>,
    issuer: string,
    signingKey: { privateKey: string; kid: string },
    target: LogoutTarget,
  ): Promise<void> {
    try {
      // §2.4: iss, aud, iat, jti (set by signJwt), events, and sub and/or
      // sid. Never a nonce, so a logout token cannot pass as an ID token.
      const payload: Record<string, unknown> = {
        iss: issuer,
        sub: target.sub,
        aud: target.clientId,
        events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
        ...(target.sid ? { sid: target.sid } : {}),
      };
      const logoutToken = await this.jwkService.signJwt(
        payload,
        signingKey.privateKey,
        signingKey.kid,
        LOGOUT_TOKEN_LIFETIME_SECONDS,
        LOGOUT_TOKEN_TYPE,
      );

      const response = await fetch(target.uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: logoutToken }).toString(),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        // Never follow a redirect: the logout token goes to the registered
        // URI only, not wherever that server points (ASVS 5.0 V15.3.2).
        redirect: 'error',
      });
      // The body is not used; release the connection.
      await response.body?.cancel().catch(() => undefined);

      if (!response.ok) {
        this.logger.warn(
          `Back-channel logout to ${target.clientId} in realm ${realm.name} returned ${response.status}`,
        );
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Back-channel logout to ${target.clientId} in realm ${realm.name} failed: ${errorMessage(err)}`,
      );
    }
  }
}

/**
 * One logout token per client and session, carrying `sub` and `sid` (the
 * spec allows both, and `sid` keeps the RP from ending the user's other
 * sessions). The one exception: when every session of the user ended and
 * the client does not require `sid` (`backchannel_logout_session_required`),
 * one `sub`-only token per client and user, which tells the RP to end all of
 * them.
 */
function logoutTargets(
  clients: readonly {
    clientId: string;
    backchannelLogoutUri: string | null;
    backchannelLogoutSessionRequired: boolean;
  }[],
  sessions: readonly EndedSession[],
  allSessionsOfUser: boolean,
): LogoutTarget[] {
  const targets: LogoutTarget[] = [];
  for (const client of clients) {
    const uri = client.backchannelLogoutUri;
    if (!uri) continue;
    const used = sessions.filter((s) => s.clientIds.includes(client.clientId));
    if (client.backchannelLogoutSessionRequired || !allSessionsOfUser) {
      for (const s of used) {
        targets.push({
          clientId: client.clientId,
          uri,
          sub: s.userId,
          sid: s.id,
        });
      }
    } else {
      for (const sub of new Set(used.map((s) => s.userId))) {
        targets.push({ clientId: client.clientId, uri, sub });
      }
    }
  }
  return targets;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
