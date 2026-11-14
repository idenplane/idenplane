import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import type { IncomingMessage } from 'http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { TokenBlacklistService } from '../tokens/token-blacklist.service.js';
import { CacheBusService } from '../cache/cache-bus.service.js';
import { ClientCertificateSource } from '../mtls/client-certificate.source.js';
import { assertCertificateBinding } from '../mtls/certificate-binding.js';

/** The bus topic session events travel on between processes. */
const TOPIC = 'session-events';

export const SESSION_EVENTS_PATH = '/ws/events';

const UNAUTHORIZED =
  'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

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
 *
 * It serves the main port ({@link attach}) and the certificate listener
 * (`MTLS_LISTEN_PORT`, through {@link handleUpgrade}), with one
 * `WebSocketServer` for both. On the listener the certificate of a bound
 * token is read from the TLS handshake.
 */
@Injectable()
export class SessionEventsGateway implements OnModuleDestroy {
  private readonly logger = new Logger(SessionEventsGateway.name);
  private readonly connections = new Map<string, Set<WebSocket>>();
  /** One per process, whichever servers feed it upgrades. */
  private readonly wss = new WebSocketServer({ noServer: true });
  /** Servers whose upgrades already come here: attaching twice is a no-op. */
  private readonly attached = new WeakSet<EventEmitter>();

  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly blacklist: TokenBlacklistService,
    private readonly bus: CacheBusService,
    @Optional() private readonly certificates?: ClientCertificateSource,
  ) {
    // An event is raised by whichever process runs the job that found it
    // (the leader); the user's sockets may be held by any process. Every
    // process hears it and pushes to the sockets it holds.
    bus.onMessage(TOPIC, (message) => {
      const { userId, type, event } = message as {
        userId: string;
        type: string;
        event: object;
      };
      this.broadcast(userId, type, event);
    });
  }

  /**
   * Wire the WebSocket upgrade handler onto an HTTP(S) server. Idempotent:
   * a server already attached keeps its one handler.
   */
  attach(server: EventEmitter): void {
    if (this.attached.has(server)) return;
    this.attached.add(server);
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) =>
      this.handleUpgrade(req, socket, head),
    );
  }

  /**
   * Accepts or refuses one upgrade request: only {@link SESSION_EVENTS_PATH},
   * and only with a valid token (bound tokens with their certificate).
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy());
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== SESSION_EVENTS_PATH) {
      socket.destroy();
      return;
    }

    this.authenticate(url.searchParams, req)
      .then((auth) => {
        if (!auth) {
          socket.end(UNAUTHORIZED);
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.registerConnection(auth.userId, ws);
          ws.on('close', () => this.unregisterConnection(auth.userId, ws));
          ws.on('error', () => this.unregisterConnection(auth.userId, ws));
        });
      })
      .catch((error: unknown) => {
        this.logger.debug(
          `WebSocket auth failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        socket.end(UNAUTHORIZED);
      });
  }

  /** Going away: every open socket gets a close frame (1001). */
  onModuleDestroy(): void {
    for (const sockets of this.connections.values()) {
      for (const ws of sockets) ws.close(1001, 'Server shutting down');
    }
    this.wss.close();
  }

  /** Push a session-termination event to every connection for this user. */
  emitSessionTerminated(userId: string, event: SessionTerminatedEvent): void {
    this.publish(userId, 'session.terminated', event);
  }

  /**
   * Push a step-up-required event to every connection for this user, so a
   * client application can prompt for re-authentication immediately instead
   * of only discovering the requirement on its next API call.
   */
  emitStepUpRequired(userId: string, event: StepUpRequiredEvent): void {
    this.publish(userId, 'session.stepup_required', event);
  }

  /** To every process, which each push to the sockets they hold. */
  private publish(userId: string, type: string, event: object): void {
    void this.bus.publish(TOPIC, { userId, type, event });
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
    req?: IncomingMessage,
  ): Promise<{ userId: string } | null> {
    const token = searchParams.get('token');
    const realmName = searchParams.get('realm');
    if (!token || !realmName) return null;

    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) return null;

    const signingKey = await this.lookups.activeSigningKey(realm.id);
    if (!signingKey) return null;

    let payload;
    try {
      // cert-binding: enforced
      payload = await this.jwkService.verifyJwt(token, signingKey.publicKey);
    } catch {
      return null;
    }
    // RFC 8705 §3: a certificate-bound token needs its certificate: from the
    // TLS handshake on the certificate listener, or from a trusted proxy's
    // header. Read inside this promise, so a malformed header is a refusal
    // and never an uncaught throw in the upgrade handler.
    try {
      assertCertificateBinding(payload, () =>
        req && this.certificates ? this.certificates.fromRequest(req) : null,
      );
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
