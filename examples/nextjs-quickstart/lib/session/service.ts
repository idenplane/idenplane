import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { PostgresSessionStore } from './postgres-store.ts';
import { browserSessionPolicy, sameOriginPost, readSessionCookie, sessionCookie, clearSessionCookie } from './browser-policy.ts';

interface SessionConfig {
  appOrigin: string; issuer: string; internalIssuer: string; clientId: string; clientSecret: string;
  allowInsecureLocalhost?: boolean; lifetimeSeconds?: number; idleSeconds?: number;
}
interface LoginTransaction { verifier: string; nonce: string }
interface Profile { id: string; username?: string; name?: string; email?: string }
interface ServerSession {
  accessToken: string; refreshToken: string; idToken: string; nonce: string;
  subject: string; accessExpiresAt: number; profile: Profile;
}
class RejectedCredentials extends Error {}

export function createServerSessionService(config: SessionConfig, store: PostgresSessionStore, keys: JWTVerifyGetKey) {
  const policy = browserSessionPolicy(config.appOrigin, config.allowInsecureLocalhost);
  const issuer = config.issuer.replace(/\/$/, ''), internalIssuer = config.internalIssuer.replace(/\/$/, '');
  for (const value of [issuer, internalIssuer]) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(config.allowInsecureLocalhost && !policy.secure && url.protocol === 'http:'))) throw new Error('HTTPS is required for the identity provider');
  }
  if (!config.clientId || !config.clientSecret) throw new Error('A confidential server client is required');
  const callbackUrl = policy.origin + '/api/session/callback', returnUrl = policy.origin + '/server-session';
  const lifetime = config.lifetimeSeconds ?? 28800, idle = config.idleSeconds ?? 1800;
  const baseHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer' };
  const reply = (status: number, error: string) => Response.json({ error }, { status, headers: baseHeaders });
  const redirect = (location: string, cookies: string[] = []) => {
    const headers = new Headers({ ...baseHeaders, Location: location });for (const cookie of cookies) headers.append('Set-Cookie', cookie);
    return new Response(null, { status: 303, headers });
  };
  const unauthorized = () => {
    const response = reply(401, 'unauthorized');response.headers.append('Set-Cookie', clearSessionCookie(policy, 'session'));return response;
  };
  async function exchange(body: URLSearchParams): Promise<Record<string, unknown>> {
    body.set('client_id', config.clientId);body.set('client_secret', config.clientSecret);
    const response = await fetch(internalIssuer + '/protocol/openid-connect/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(5000),
    });
    if (response.status >= 400 && response.status < 500) throw new RejectedCredentials('Provider rejected credentials');
    if (!response.ok) throw new Error('Provider unavailable');
    return response.json();
  }
  async function verifyTokens(tokens: Record<string, unknown>, nonce: string, subject?: string): Promise<ServerSession> {
    if (tokens.token_type !== 'Bearer' || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.id_token !== 'string') throw new RejectedCredentials('Incomplete token response');
    const options = { issuer, audience: config.clientId, algorithms: ['RS256'], requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'] };
    let access: JWTPayload, identity: JWTPayload;
    try {
      [{ payload: access }, { payload: identity }] = await Promise.all([jwtVerify(tokens.access_token, keys, options), jwtVerify(tokens.id_token, keys, options)]);
    } catch { throw new RejectedCredentials('Invalid signed credentials'); }
    if (access.typ !== 'Bearer' || identity.typ !== 'ID' || access.azp !== config.clientId || identity.azp !== config.clientId || typeof access.sub !== 'string' || !access.sub || access.sub !== identity.sub || (subject && access.sub !== subject)) throw new RejectedCredentials('Invalid token identity');
    // The initial callback requires nonce; a refresh may omit it per OIDC.
    if ((!subject || identity.nonce !== undefined) && identity.nonce !== nonce) throw new RejectedCredentials('Invalid nonce');
    const scopes = new Set(typeof access.scope === 'string' ? access.scope.split(' ') : []);
    if (!scopes.has('profile')) throw new RejectedCredentials('Profile scope required');
    return {
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
      nonce, subject: access.sub, accessExpiresAt: Number(access.exp) * 1000,
      profile: { id: access.sub, username: typeof access.preferred_username === 'string' ? access.preferred_username : undefined, name: typeof access.name === 'string' ? access.name : undefined, email: scopes.has('email') && typeof access.email === 'string' ? access.email : undefined },
    };
  }

  return {
    async login(request: Request): Promise<Response> {
      if (!sameOriginPost(request, policy)) return reply(403, 'forbidden');
      try {
        const verifier = randomBytes(48).toString('base64url'), nonce = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
        const transaction = await store.createLogin({ verifier, nonce }, state);
        const url = new URL(issuer + '/protocol/openid-connect/auth');
        url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: callbackUrl, response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        return redirect(url.toString(), [sessionCookie(policy, 'login', transaction, 600)]);
      } catch { return reply(503, 'session_unavailable'); }
    },
    async callback(request: Request): Promise<Response> {
      const url = new URL(request.url), transaction = readSessionCookie(request, policy.loginName), state = url.searchParams.get('state');
      if (request.method !== 'GET' || !transaction || !state || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length > 1) return redirect(returnUrl + '?error=login_failed');
      try {
        const pending = await store.consumeLogin<LoginTransaction>(transaction, state);
        if (!pending || url.searchParams.has('error') || !url.searchParams.get('code')) return redirect(returnUrl + '?error=login_failed');
        const tokens = await exchange(new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: callbackUrl, code_verifier: pending.verifier }));
        const data = await verifyTokens(tokens, pending.nonce);
        const previous = readSessionCookie(request, policy.sessionName);if (previous) await store.revokeSession(previous);
        const session = await store.createSession(data, lifetime, idle);
        return redirect(returnUrl, [clearSessionCookie(policy, 'login'), sessionCookie(policy, 'session', session, lifetime)]);
      } catch { return redirect(returnUrl + '?error=login_failed', [clearSessionCookie(policy, 'login')]); }
    },
    async profile(request: Request, requestedUserId?: string): Promise<Response> {
      const session = readSessionCookie(request, policy.sessionName);if (!session) return unauthorized();
      try {
        const result = await store.withSession<ServerSession, { forbidden?: boolean; profile?: Profile }>(session, async data => {
          if (requestedUserId !== undefined && requestedUserId !== data.subject) return { value: { forbidden: true } };
          if (data.accessExpiresAt - Date.now() > 30000) return { value: { profile: data.profile } };
          const tokens = await exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refreshToken }));
          const next = await verifyTokens(tokens, data.nonce, data.subject);
          return { data: next, value: { profile: next.profile } };
        });
        if (!result) return unauthorized();
        if (result.forbidden) return reply(403, 'forbidden');
        return Response.json({ profile: result.profile }, { headers: baseHeaders });
      } catch (error) {
        if (error instanceof RejectedCredentials) {
          try { await store.revokeSession(session); } catch { return reply(503, 'session_unavailable'); }
          return unauthorized();
        }
        return reply(503, 'session_unavailable');
      }
    },
    async logout(request: Request): Promise<Response> {
      if (!sameOriginPost(request, policy)) return reply(403, 'forbidden');
      const session = readSessionCookie(request, policy.sessionName);
      if (!session) return redirect(returnUrl, [clearSessionCookie(policy, 'session')]);
      let data: ServerSession | null;
      try { data = await store.revokeSession<ServerSession>(session); } catch { return reply(503, 'session_unavailable'); }
      const cookies = [clearSessionCookie(policy, 'session'), clearSessionCookie(policy, 'login')];
      if (!data) return redirect(returnUrl, cookies);
      // Local revocation is already committed. Provider availability cannot
      // restore the deleted session; browser navigation also clears IdP SSO.
      try {
        await fetch(internalIssuer + '/protocol/openid-connect/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, refresh_token: data.refreshToken }), signal: AbortSignal.timeout(5000) });
      } catch { /* Provider logout is best effort; local revocation is final. */ }
      const url = new URL(issuer + '/protocol/openid-connect/logout');
      url.search = new URLSearchParams({ id_token_hint: data.idToken, post_logout_redirect_uri: returnUrl }).toString();
      return redirect(url.toString(), cookies);
    },
  };
}
