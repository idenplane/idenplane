/**
 * Integration test for idenplane-sdk/server — exercises `verifyToken`
 * against a real Idenplane instance's real token issuance and JWKS
 * endpoints, rather than a mocked `jose` module (see
 * ../src/__tests__/server.test.ts for the unit-level, mocked version).
 *
 * Prerequisites:
 *   A running Idenplane instance reachable at IDENPLANE_URL, with an
 *   admin API key matching IDENPLANE_ADMIN_TOKEN.
 *
 * Environment variables:
 *   IDENPLANE_URL          (default: http://localhost:3000)
 *   IDENPLANE_ADMIN_TOKEN  (default: dev-admin-key)
 *
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { verifyToken } from '../src/server.js';

const IDENPLANE_URL = process.env['IDENPLANE_URL'] ?? 'http://localhost:3000';
const IDENPLANE_ADMIN_TOKEN = process.env['IDENPLANE_ADMIN_TOKEN'] ?? 'dev-admin-key';
const TEST_REALM = `sdk-it-${Date.now()}`;
const TEST_CLIENT_ID = 'sdk-it-client';

async function skipReason(): Promise<string | false> {
  try {
    const res = await fetch(`${IDENPLANE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? false : `Idenplane at ${IDENPLANE_URL} answered /health with ${res.status}`;
  } catch {
    return `no Idenplane instance reachable at ${IDENPLANE_URL} — start one and set IDENPLANE_URL/IDENPLANE_ADMIN_TOKEN`;
  }
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${IDENPLANE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': IDENPLANE_ADMIN_TOKEN,
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

describe.skipIf(await skipReason())('verifyToken against a live server', () => {
  let clientSecret: string;

  beforeAll(async () => {
    await adminFetch('/admin/realms', {
      method: 'POST',
      body: JSON.stringify({ name: TEST_REALM, displayName: 'SDK Integration Test' }),
    });

    const client = await adminFetch(`/admin/realms/${TEST_REALM}/clients`, {
      method: 'POST',
      body: JSON.stringify({
        clientId: TEST_CLIENT_ID,
        name: 'SDK Integration Test Client',
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
      }),
    });
    clientSecret = client.clientSecret;
  });

  afterAll(async () => {
    await fetch(`${IDENPLANE_URL}/admin/realms/${TEST_REALM}`, {
      method: 'DELETE',
      headers: { 'x-admin-api-key': IDENPLANE_ADMIN_TOKEN },
    }).catch(() => undefined);
  });

  it('validates a real access token issued by the server', async () => {
    const tokenRes = await fetch(
      `${IDENPLANE_URL}/realms/${TEST_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: TEST_CLIENT_ID,
          client_secret: clientSecret,
        }),
      },
    );
    expect(tokenRes.ok).toBe(true);
    const { access_token: accessToken } = await tokenRes.json();
    expect(typeof accessToken).toBe('string');

    const payload = await verifyToken(accessToken, {
      issuerUrl: IDENPLANE_URL,
      realm: TEST_REALM,
    });

    expect(payload.azp).toBe(TEST_CLIENT_ID);
    expect(payload.iss).toBe(`${IDENPLANE_URL}/realms/${TEST_REALM}`);
    expect(typeof payload.exp).toBe('number');
  });

  it('rejects a token verified against the wrong realm', async () => {
    const tokenRes = await fetch(
      `${IDENPLANE_URL}/realms/${TEST_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: TEST_CLIENT_ID,
          client_secret: clientSecret,
        }),
      },
    );
    const { access_token: accessToken } = await tokenRes.json();

    await expect(
      verifyToken(accessToken, { issuerUrl: IDENPLANE_URL, realm: 'master' }),
    ).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const tokenRes = await fetch(
      `${IDENPLANE_URL}/realms/${TEST_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: TEST_CLIENT_ID,
          client_secret: clientSecret,
        }),
      },
    );
    const { access_token: accessToken } = await tokenRes.json();
    const tampered = accessToken.slice(0, -4) + 'abcd';

    await expect(
      verifyToken(tampered, { issuerUrl: IDENPLANE_URL, realm: TEST_REALM }),
    ).rejects.toThrow();
  });
});
