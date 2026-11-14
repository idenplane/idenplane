import type { INestApplication } from '@nestjs/common';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MtlsServerService } from '../mtls/mtls-server.js';
import {
  SESSION_EVENTS_PATH,
  SessionEventsGateway,
} from './session-events.gateway.js';

/**
 * Starts the certificate listener (`MTLS_LISTEN_PORT`) when one is
 * configured: the OAuth endpoint aliases through the Express application,
 * and WebSocket upgrades of the session events path through the gateway,
 * which reads a bound token's certificate from the TLS handshake. Resolves
 * to the listener's address, or `null` when mTLS is off.
 */
export function startCertificateListener(
  app: INestApplication,
): Promise<AddressInfo | null> {
  const gateway = app.get(SessionEventsGateway);
  return app
    .get(MtlsServerService)
    .start(app.getHttpAdapter().getInstance() as RequestListener, {
      upgrade: {
        path: SESSION_EVENTS_PATH,
        handle: (req, socket, head) => gateway.handleUpgrade(req, socket, head),
      },
    });
}
