import type { Server as HttpServer } from 'http';
import { Injectable, Logger } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { TokenBlacklistService } from '../tokens/token-blacklist.service.js';

export const SESSION_EVENTS_PATH = '/ws/events';

export interface SessionTerminatedEvent {
  sessionId: string;
  reason: string;
  timestamp: string;
}

export interface StepUpRequiredEvent {
  sessionId: string;
  requiredAcr: string;
  reason: string;
  timestamp: string;
}

/**
 * Real-time push for session lifecycle events, replacing the polling-based
 * "did my session get revoked?" pattern. A client connects to
 * `SESSION_EVENTS_PATH` with `?token=<access_token>&realm=<realmName>`; the
 * token is verified exactly like the /userinfo endpoint (realm signing key,
 * blacklist, session-still-exists check) before the socket is accepted.
 *
 * Connections are registered by userId, so a client only ever receives
 * events about that user's own sessions.
 */
@Injectable()
export class SessionEventsGateway {
  private readonly logger = new Logger(SessionEventsGateway.name);
  private readonly connections = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly blacklist: TokenBlacklistService,
  ) {}

  /** Wire the WebSocket upgrade handler onto the app's underlying HTTP server. */
  attach(server: HttpServer): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.pathname !== SESSION_EVENTS_PATH) {
        socket.destroy();
        return;
      }

      this.authenticate(url.searchParams)
        .then((auth) => {
          if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            this.registerConnection(auth.userId, ws);
            ws.on('close', () => this.unregisterConnection(auth.userId, ws));
            ws.on('error', () => this.unregisterConnection(auth.userId, ws));
          });
        })
        .catch((error: unknown) => {
          this.logger.debug(
            `WebSocket auth failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        });
    });
  }

  /** Push a session-termination event to every connection for this user. */
  emitSessionTerminated(userId: string, event: SessionTerminatedEvent): void {
    this.broadcast(userId, 'session.terminated', event);
  }

  /**
   * Push a step-up-required event to every connection for this user, so a
   * client application can prompt for re-authentication immediately instead
   * of only discovering the requirement on its next API call.
   */
  emitStepUpRequired(userId: string, event: StepUpRequiredEvent): void {
    this.broadcast(userId, 'session.stepup_required', event);
  }

  private broadcast<T extends object>(
    userId: string,
    type: string,
    event: T,
  ): void {
    const sockets = this.connections.get(userId);
    if (!sockets || sockets.size === 0) return;

    const payload = JSON.stringify({ type, ...event });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private async authenticate(
    searchParams: URLSearchParams,
  ): Promise<{ userId: string } | null> {
    const token = searchParams.get('token');
    const realmName = searchParams.get('realm');
    if (!token || !realmName) return null;

    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) return null;

    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: realm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!signingKey) return null;

    let payload;
    try {
      payload = await this.jwkService.verifyJwt(token, signingKey.publicKey);
    } catch {
      return null;
    }

    const jti = payload['jti'];
    if (jti && (await this.blacklist.isBlacklisted(jti))) return null;

    const sid = payload['sid'] as string | undefined;
    if (sid) {
      const session = await this.prisma.session.findUnique({
        where: { id: sid },
      });
      if (!session) return null;
    }

    const userId = payload.sub;
    if (!userId) return null;

    return { userId };
  }

  private registerConnection(userId: string, ws: WebSocket): void {
    const sockets = this.connections.get(userId) ?? new Set<WebSocket>();
    sockets.add(ws);
    this.connections.set(userId, sockets);
  }

  private unregisterConnection(userId: string, ws: WebSocket): void {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) this.connections.delete(userId);
  }
}
