import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeIp } from './cidr.js';
import type { MtlsProxyConfig } from './mtls-config.js';

const LOG_INTERVAL_MS = 60_000;
/** Bound on remembered peers, so spoofed sources cannot grow it forever. */
const MAX_TRACKED_PEERS = 10_000;

export interface ProxyHeaderLogger {
  warn(message: string): void;
}

type Next = (err?: unknown) => void;

/**
 * Keeps the client-certificate headers out of requests that did not come
 * from a trusted proxy, before any route sees them. A client talking to the
 * server directly could otherwise claim any certificate.
 *
 * `reject` (the default) answers 400 `invalid_request`; `strip` deletes the
 * headers and lets the request through. Each peer is logged at most once a
 * minute.
 */
export function createTrustedProxyCertHeaderMiddleware(
  proxy: MtlsProxyConfig,
  logger: ProxyHeaderLogger,
  now: () => number = Date.now,
): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  const headers = [proxy.certHeader, proxy.chainHeader].filter(
    (name): name is string => name !== undefined,
  );
  const lastLogged = new Map<string, number>();

  const logOncePerMinute = (peer: string): void => {
    const time = now();
    const previous = lastLogged.get(peer);
    if (previous !== undefined && time - previous < LOG_INTERVAL_MS) return;
    if (lastLogged.size >= MAX_TRACKED_PEERS) {
      for (const [key, at] of lastLogged) {
        if (time - at >= LOG_INTERVAL_MS) lastLogged.delete(key);
      }
      if (lastLogged.size >= MAX_TRACKED_PEERS) lastLogged.clear();
    }
    lastLogged.set(peer, time);
    logger.warn(
      `Client certificate header from untrusted peer ${peer} ` +
        `(${proxy.untrustedHeaderAction === 'strip' ? 'stripped' : 'rejected'}); ` +
        'only peers in MTLS_TRUSTED_PROXY_CIDRS may send it',
    );
  };

  return (req, res, next) => {
    const present = headers.filter((name) => req.headers[name] !== undefined);
    if (present.length === 0) {
      next();
      return;
    }
    const remote = req.socket?.remoteAddress;
    if (proxy.trustedProxies.contains(remote)) {
      next();
      return;
    }
    logOncePerMinute(remote ? normalizeIp(remote) : 'unknown');
    if (proxy.untrustedHeaderAction === 'strip') {
      for (const name of present) delete req.headers[name];
      next();
      return;
    }
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: 'invalid_request',
        error_description:
          'Client certificate headers are only accepted from a trusted proxy',
      }),
    );
  };
}
