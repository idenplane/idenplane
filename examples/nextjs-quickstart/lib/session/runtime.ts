import { Pool } from 'pg';
import { createRemoteJWKSet } from 'jose';
import { SessionCipher } from './crypto.ts';
import { PostgresSessionStore } from './postgres-store.ts';
import { createServerSessionService } from './service.ts';

let service: ReturnType<typeof createServerSessionService> | undefined;
export function serverSessionService() {
  if (service) return service;
  const { SESSION_APP_ORIGIN, SESSION_DATABASE_URL, SESSION_ENCRYPTION_KEY, SESSION_CLIENT_SECRET } = process.env;
  if (!SESSION_APP_ORIGIN || !SESSION_DATABASE_URL || !SESSION_CLIENT_SECRET || !SESSION_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(SESSION_ENCRYPTION_KEY)) throw new Error('Server sessions are not configured');
  const url = (process.env.NEXT_PUBLIC_IDENPLANE_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const realm = encodeURIComponent(process.env.NEXT_PUBLIC_IDENPLANE_REALM ?? 'quickstart');
  const issuer = url + '/realms/' + realm;
  const internalIssuer = (process.env.IDENPLANE_INTERNAL_URL ?? url).replace(/\/$/, '') + '/realms/' + realm;
  const keys = createRemoteJWKSet(new URL(internalIssuer + '/protocol/openid-connect/certs'));
  const pool = new Pool({ connectionString: SESSION_DATABASE_URL, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  pool.on('error', () => { /* Requests fail closed; never log credentials. */ });
  service = createServerSessionService({ appOrigin: SESSION_APP_ORIGIN, issuer, internalIssuer, clientId: process.env.SESSION_CLIENT_ID ?? 'nextjs-session', clientSecret: SESSION_CLIENT_SECRET, allowInsecureLocalhost: process.env.SESSION_ALLOW_INSECURE_LOCALHOST === 'true' }, new PostgresSessionStore(pool, new SessionCipher(Buffer.from(SESSION_ENCRYPTION_KEY, 'hex'))), keys);
  return service;
}

export async function handleSessionRequest(action: 'login' | 'callback' | 'profile' | 'logout', request: Request, userId?: string): Promise<Response> {
  try { return await serverSessionService()[action](request, userId); }
  catch { return Response.json({ error: 'session_unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }); }
}
