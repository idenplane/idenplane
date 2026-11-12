import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdenplaneClient } from '../client.js';

const config = { url: 'http://localhost:3000', realm: 'test', clientId: 'browser', redirectUri: 'http://localhost:3001/callback', autoRefresh: false };
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const location = { href: 'http://localhost:3001/' };
  vi.stubGlobal('window', { sessionStorage: storage, location, history: { replaceState: vi.fn() } });
  const claims = btoa(JSON.stringify({ sub: 'user', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const token = 'eyJhbGciOiJSUzI1NiJ9.' + claims + '.signature'; // dummy JWT
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('.well-known') ? {
    authorization_endpoint: config.url + '/authorize', token_endpoint: config.url + '/token', end_session_endpoint: config.url + '/logout',
  } : { access_token: token, id_token: token, refresh_token: 'disposable-refresh', token_type: 'Bearer', expires_in: 3600 } }));
  vi.stubGlobal('fetch', fetchMock);
  async function begin() {
    const client = new IdenplaneClient(config); await client.login();
    const state = new URL(location.href).searchParams.get('state')!;
    location.href = config.redirectUri + '?code=disposable-code&state=' + state;
    return { client, state };
  }
  return { values, storage, location, fetchMock, begin };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('short-lived browser login transactions with memory tokens', () => {
  it('survives a new SDK instance after navigation without persisting tokens', async () => {
    const { values, begin } = setup(); await begin();
    expect(values.size).toBe(1);
    const freshClient = new IdenplaneClient(config);
    expect(await freshClient.handleCallback()).toBe(true);
    expect(freshClient.getAccessToken()).toBeTruthy();
    expect(values.size).toBe(0);
    expect(new IdenplaneClient(config).getAccessToken()).toBeNull();
  });

  it('rejects transactions older than ten minutes before exchanging a code', async () => {
    vi.useFakeTimers();const { begin, fetchMock } = setup(); await begin();
    vi.setSystemTime(Date.now() + 600001);
    expect(await new IdenplaneClient(config).handleCallback()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched state without destroying the pending valid login', async () => {
    const { begin, location, values, fetchMock } = setup(); const { state } = await begin();
    location.href = config.redirectUri + '?code=disposable-code&state=attacker';
    const client = new IdenplaneClient(config);
    expect(await client.handleCallback()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(values.size).toBe(1);
    location.href = config.redirectUri + '?code=disposable-code&state=' + state;
    expect(await client.handleCallback()).toBe(true);
  });

  it.each([{ clientId: 'other-client' }, { realm: 'other-realm' }, { redirectUri: 'http://localhost:3001/other' }, { url: 'http://localhost:4000' }])('isolates identities: %j', async other => {
    const { begin } = setup();await begin();
    expect(await new IdenplaneClient({ ...config, ...other }).handleCallback()).toBe(false);
    expect(await new IdenplaneClient(config).handleCallback()).toBe(true);
  });

  it('does not navigate when browser storage is blocked', async () => {
    const { storage, location } = setup();
    storage.setItem = () => { throw new Error('storage denied'); };
    await expect(new IdenplaneClient(config).login()).rejects.toThrow('storage denied');
    expect(location.href).toBe('http://localhost:3001/');
  });

  it('rejects corrupt transaction data', async () => {
    const { values, begin, fetchMock } = setup();await begin();
    for (const key of values.keys()) values.set(key, '{invalid');
    expect(await new IdenplaneClient(config).handleCallback()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes a pending transaction on logout', async () => {
    const { begin, values } = setup();const { client } = await begin();
    await client.logout();expect(values.size).toBe(0);
  });
});
