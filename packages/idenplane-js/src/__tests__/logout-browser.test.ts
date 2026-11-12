import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdenplaneClient } from '../client.js';

const endpoint = 'http://localhost:3000/realms/test/protocol/openid-connect/logout';
const base = { url: 'http://localhost:3000', realm: 'test', clientId: 'browser', redirectUri: 'http://localhost:3001/callback', autoRefresh: false };

function setup(options: { refresh?: boolean; idToken?: boolean; revokeFails?: boolean; discoveryFails?: boolean; noEndpoint?: boolean } = {}) {
  const location = { href: 'http://localhost:3001/dashboard' };
  vi.stubGlobal('window', { location });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('.well-known')) {
      if (options.discoveryFails) throw new Error('offline');
      return { ok: true, json: async () => ({ end_session_endpoint: options.noEndpoint ? undefined : endpoint }) };
    }
    if (options.revokeFails) throw new Error('revocation offline');
    return { ok: true, status: 204 };
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new IdenplaneClient({ ...base, postLogoutRedirectUri: 'http://localhost:3001' });
  const storage = (client as unknown as { storage: { set: (k: string, v: string) => void; get: (k: string) => string | null } }).storage;
  storage.set('access_token', 'disposable-access-token');
  if (options.refresh !== false) storage.set('refresh_token', 'disposable-refresh-token');
  if (options.idToken !== false) storage.set('id_token', 'disposable-id-token');
  return { client, storage, fetchMock, location };
}

afterEach(() => vi.unstubAllGlobals());

describe('browser RP-initiated logout', () => {
  it('revokes refresh tokens and navigates to the provider with only the ID token hint', async () => {
    const { client, storage, fetchMock, location } = setup();
    const onLogout = vi.fn(); client.on('logout', onLogout);
    await client.logout();
    const url = new URL(location.href);
    expect(url.origin + url.pathname).toBe(endpoint);
    expect(url.searchParams.get('id_token_hint')).toBe('disposable-id-token');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3001');
    expect(url.searchParams.has('refresh_token')).toBe(false);
    expect(url.searchParams.has('access_token')).toBe(false);
    const post = fetchMock.mock.calls.find(([url]) => url === endpoint);
    expect(post).toBeDefined();
    const init = (post as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(new URLSearchParams(init.body as string).get('refresh_token')).toBe('disposable-refresh-token');
    for (const name of ['access_token', 'refresh_token', 'id_token']) expect(storage.get(name)).toBeNull();
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('performs browser logout even without a refresh token', async () => {
    const { client, location, fetchMock } = setup({ refresh: false });
    await client.logout();
    expect(new URL(location.href).searchParams.get('id_token_hint')).toBe('disposable-id-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still performs browser logout when POST revocation is unavailable', async () => {
    const { client, storage, location } = setup({ revokeFails: true });
    await client.logout();
    expect(location.href).toContain(endpoint);
    expect(storage.get('refresh_token')).toBeNull();
  });

  it('does not send a return URI without an ID token context', async () => {
    const { client, location } = setup({ idToken: false });
    await client.logout();
    expect(location.href).toBe(endpoint);
  });

  it.each([{ discoveryFails: true }, { noEndpoint: true }])('clears local state and falls back safely when discovery cannot supply logout: %j', async options => {
    const { client, storage, location } = setup(options);
    await client.logout();
    expect(storage.get('access_token')).toBeNull();
    expect(location.href).toBe('http://localhost:3001');
  });

  it('retains server-side POST logout without accessing window', async () => {
    const { client, storage, fetchMock } = setup();
    vi.stubGlobal('window', undefined);
    await client.logout();
    expect(storage.get('refresh_token')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
