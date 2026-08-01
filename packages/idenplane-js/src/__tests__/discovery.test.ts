import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscoveryClient } from '../discovery.js';

const oidcDiscovery = {
  issuer: 'http://localhost:3000/realms/test',
  authorization_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/auth',
  token_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/token',
  userinfo_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/userinfo',
  jwks_uri: 'http://localhost:3000/realms/test/protocol/openid-connect/certs',
  end_session_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/logout',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'email'],
  token_endpoint_auth_methods_supported: ['none'],
  claims_supported: ['sub', 'name', 'email'],
};

describe('DiscoveryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the discovery document from the realm well-known URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(oidcDiscovery),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DiscoveryClient('http://localhost:3000', 'test');
    const config = await client.getConfig();

    expect(config).toEqual(oidcDiscovery);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/realms/test/.well-known/openid-configuration',
    );
  });

  it('caches the document across calls instead of re-fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(oidcDiscovery),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DiscoveryClient('http://localhost:3000', 'test');
    await client.getConfig();
    await client.getConfig();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws and evicts the cache when the fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DiscoveryClient('http://localhost:3000', 'test');
    await expect(client.getConfig()).rejects.toThrow('Failed to fetch OIDC discovery document');

    // A subsequent call retries rather than serving a poisoned cache.
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
    const config = await client.getConfig();
    expect(config).toEqual(oidcDiscovery);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetchDiscovery() unconditionally re-fetches, bypassing the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(oidcDiscovery),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DiscoveryClient('http://localhost:3000', 'test');
    await client.getConfig();
    await client.fetchDiscovery();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
