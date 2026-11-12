import { validSessionId } from './crypto.ts';

export interface BrowserSessionPolicy {
  origin: string;
  secure: boolean;
  sessionName: string;
  loginName: string;
}

export function browserSessionPolicy(appOrigin: string, allowInsecureLocalhost = false): BrowserSessionPolicy {
  const url = new URL(appOrigin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Session application origin must contain only scheme, host and port');
  const secure = url.protocol === 'https:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!secure && !(allowInsecureLocalhost && local && url.protocol === 'http:')) throw new Error('HTTPS is required for server sessions');
  return { origin: url.origin, secure, sessionName: secure ? '__Host-idenplane_session' : 'idenplane_session_dev', loginName: secure ? '__Host-idenplane_login' : 'idenplane_login_dev' };
}

export function sameOriginPost(request: Request, policy: BrowserSessionPolicy): boolean {
  if (request.method !== 'POST' || request.headers.get('origin') !== policy.origin) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

export function readSessionCookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0] === name);
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return validSessionId(value) ? value : null;
}

export function sessionCookie(policy: BrowserSessionPolicy, kind: 'session' | 'login', value: string, lifetimeSeconds: number): string {
  if (!validSessionId(value) || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 86400) throw new Error('Invalid session cookie');
  return `${kind === 'session' ? policy.sessionName : policy.loginName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetimeSeconds}${policy.secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(policy: BrowserSessionPolicy, kind: 'session' | 'login'): string {
  return `${kind === 'session' ? policy.sessionName : policy.loginName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${policy.secure ? '; Secure' : ''}`;
}
