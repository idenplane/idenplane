import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MTLS_CONFIG, type MtlsConfig } from './mtls-config.js';

/** A realm path segment: no `.`/`..`, no encoded separators or dots. */
const REALM = '(?!\\.{1,2}/)[A-Za-z0-9._~-]+';
const OIDC = `/realms/${REALM}/protocol/openid-connect`;

/**
 * The only paths the certificate listener serves: the RFC 8705 §5
 * `mtls_endpoint_aliases` (token, introspection, revocation, userinfo, device
 * authorization) plus discovery and the JWKS a client needs to use them.
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
];

/** True when the raw request target is one of {@link MTLS_ALIAS_PATHS}. */
export function isMtlsAliasPath(url: string | undefined): boolean {
  // Origin-form only (RFC 9112 §3.2.1). The raw path is matched, not a
  // normalised one, so the router sees exactly what was checked.
  if (!url || !url.startsWith('/')) return false;
  const queryAt = url.search(/[?#]/);
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  if (path.includes('%') || path.includes('\\') || path.includes('//')) {
    return false;
  }
  return MTLS_ALIAS_PATHS.some((pattern) => pattern.test(path));
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The optional HTTPS listener that asks every client for a certificate
 * (`MTLS_LISTEN_PORT`). It accepts any certificate at the handshake
 * (`rejectUnauthorized: false`): the handshake proves possession of the key,
 * and whether the certificate is trusted is decided per realm, per request.
 * Requests go to the same Express application as the main port.
 */
@Injectable()
export class MtlsServerService implements OnApplicationShutdown {
  private readonly logger = new Logger(MtlsServerService.name);
  private server: Server | null = null;

  constructor(@Inject(MTLS_CONFIG) private readonly config: MtlsConfig) {}

  /**
   * Starts the listener when one is configured; resolves to its address, or
   * `null` when mTLS is off. Throws when the certificate or key cannot be read.
   */
  async start(handler: RequestHandler): Promise<AddressInfo | null> {
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
      `mTLS listener on ${address?.address}:${address?.port} (RFC 8705 endpoint aliases only)`,
    );
    return address;
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
    });
  }
}
