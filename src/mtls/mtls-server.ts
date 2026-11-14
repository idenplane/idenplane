import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MTLS_CONFIG, type MtlsConfig } from './mtls-config.js';

/** A realm path segment: no `.`/`..`, no encoded separators or dots. */
const REALM = '(?!\\.{1,2}/)[A-Za-z0-9._~-]+';
const OIDC = `/realms/${REALM}/protocol/openid-connect`;

/**
 * The only paths the certificate listener serves: the RFC 8705 §5
 * `mtls_endpoint_aliases` (token, introspection, revocation, userinfo, device
 * authorization) plus discovery, the JWKS a client needs to use them, and
 * the MFA SMS endpoint that completes the mfa_otp grant.
 * Everything else, admin API and login pages included, is 404 here.
 */
export const MTLS_ALIAS_PATHS: readonly RegExp[] = [
  new RegExp(`^/realms/${REALM}/\\.well-known/openid-configuration$`),
  new RegExp(`^${OIDC}/token$`),
  new RegExp(`^${OIDC}/token/introspect$`),
  new RegExp(`^${OIDC}/revoke$`),
  new RegExp(`^${OIDC}/userinfo$`),
  new RegExp(`^${OIDC}/auth/device$`),
  new RegExp(`^${OIDC}/certs$`),
  // Texts the code a password grant's mfa_required challenge is answered
  // with, so a certificate-authenticated client can complete mfa_otp here.
  new RegExp(`^${OIDC}/mfa/sms$`),
];

/**
 * The path of a raw request target, or `null` when it is not a plain
 * origin-form path (RFC 9112 §3.2.1). The raw path is matched, not a
 * normalised one, so the router sees exactly what was checked.
 */
function rawPath(url: string | undefined): string | null {
  if (!url || !url.startsWith('/')) return null;
  const queryAt = url.search(/[?#]/);
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  if (path.includes('%') || path.includes('\\') || path.includes('//')) {
    return null;
  }
  return path;
}

/** True when the raw request target is one of {@link MTLS_ALIAS_PATHS}. */
export function isMtlsAliasPath(url: string | undefined): boolean {
  const path = rawPath(url);
  return (
    path !== null && MTLS_ALIAS_PATHS.some((pattern) => pattern.test(path))
  );
}

/**
 * True when the raw request target of an upgrade is exactly `allowed` (a
 * query string is allowed; nothing else about the path may differ).
 */
export function isMtlsUpgradePath(
  url: string | undefined,
  allowed: string,
): boolean {
  return rawPath(url) === allowed;
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** The one WebSocket endpoint the listener upgrades, and who handles it. */
export interface MtlsUpgradeRoute {
  /** The exact path, e.g. `/ws/events`. */
  path: string;
  handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export interface MtlsListenerOptions {
  /** Without it every upgrade is refused. */
  upgrade?: MtlsUpgradeRoute;
}

const NOT_FOUND_UPGRADE =
  'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

/**
 * The optional HTTPS listener that asks every client for a certificate
 * (`MTLS_LISTEN_PORT`). It accepts any certificate at the handshake
 * (`rejectUnauthorized: false`): the handshake proves possession of the key,
 * and whether the certificate is trusted is decided per realm, per request.
 * Requests go to the same Express application as the main port.
 *
 * Upgrades (WebSocket) are served for one path only, the
 * {@link MtlsUpgradeRoute} given to {@link start}; any other upgrade is
 * refused with 404. The handler sees the TLS socket, so the peer certificate
 * is read from the handshake exactly as for HTTP requests here.
 */
@Injectable()
export class MtlsServerService implements OnApplicationShutdown {
  private readonly logger = new Logger(MtlsServerService.name);
  private server: Server | null = null;
  /** Sockets handed to the upgrade handler, ended on shutdown. */
  private readonly upgraded = new Set<Duplex>();

  constructor(@Inject(MTLS_CONFIG) private readonly config: MtlsConfig) {}

  /**
   * Starts the listener when one is configured; resolves to its address, or
   * `null` when mTLS is off. Throws when the certificate or key cannot be read.
   */
  async start(
    handler: RequestHandler,
    options: MtlsListenerOptions = {},
  ): Promise<AddressInfo | null> {
    const listener = this.config.listener;
    if (!listener || this.server) return this.address();

    const [cert, key, passphrase, ca] = await Promise.all([
      readFile(listener.certFile),
      readFile(listener.keyFile),
      listener.keyPassphraseFile
        ? readFile(listener.keyPassphraseFile, 'utf8').then((text) =>
            text.trim(),
          )
        : Promise.resolve(undefined),
      listener.handshakeCaFile
        ? readFile(listener.handshakeCaFile)
        : Promise.resolve(undefined),
    ]);

    const server = createServer(
      {
        cert,
        key,
        passphrase,
        ca,
        minVersion: listener.minVersion,
        requestCert: true,
        rejectUnauthorized: false,
      },
      (req, res) => {
        if (!isMtlsAliasPath(req.url)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ statusCode: 404, message: 'Not Found' }));
          return;
        }
        handler(req, res);
      },
    );

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) =>
      this.onUpgrade(options.upgrade, req, socket, head),
    );

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(listener.port, listener.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (err) =>
      this.logger.error(`mTLS listener error: ${err.message}`),
    );
    this.server = server;
    const address = this.address();
    this.logger.log(
      `mTLS listener on ${address?.address}:${address?.port} (RFC 8705 endpoint aliases${options.upgrade ? ` and WebSocket ${options.upgrade.path}` : ''} only)`,
    );
    return address;
  }

  private onUpgrade(
    route: MtlsUpgradeRoute | undefined,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    // A reset by the peer must not become an unhandled 'error' event.
    socket.on('error', () => socket.destroy());
    if (!this.server || !route || !isMtlsUpgradePath(req.url, route.path)) {
      socket.end(NOT_FOUND_UPGRADE);
      return;
    }
    this.upgraded.add(socket);
    socket.once('close', () => this.upgraded.delete(socket));
    try {
      route.handle(req, socket, head);
    } catch (err) {
      this.logger.error(
        `mTLS upgrade handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      socket.destroy();
    }
  }

  address(): AddressInfo | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address : null;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
      // An upgraded socket is no longer an HTTP connection the server can
      // close, yet it keeps close() from completing: end them here. The
      // WebSocket gateway has already sent its close frames by now.
      for (const socket of this.upgraded) socket.destroy();
      this.upgraded.clear();
    });
  }
}
