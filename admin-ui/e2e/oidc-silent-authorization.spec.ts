import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('silent OIDC reuses a real session and respects consent, assurance and the requested callback', async ({ page, browser, request }) => {
  test.setTimeout(90_000);
  const base = process.env.E2E_BACKEND_URL ?? 'http://localhost:3000';
  const key = process.env.ADMIN_API_KEY;
  if (!key) throw new Error('Set ADMIN_API_KEY for the disposable E2E backend');
  const realm = `oidc-browser-${randomUUID().slice(0, 8)}`;
  const redirect = `${base}/oidc-test-second-callback`;
  const headers = { 'x-admin-api-key': key };
  const password = 'Disposable-Browser-Test-2026!'; // dummy test password
  let created = false;
  function authorization(clientId: string, prompt?: string) {
    const verifier = randomBytes(48).toString('base64url'), state = randomUUID();
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid', state, nonce: randomUUID(), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    if (prompt) params.set('prompt', prompt);
    return { url: `${base}/realms/${realm}/protocol/openid-connect/auth?${params}`, verifier, state };
  }
  try {
    const made = await request.post(`${base}/admin/realms`, { headers, data: { name: realm } });
    expect(made.ok()).toBeTruthy(); created = true;
    expect((await request.post(`${base}/admin/realms/${realm}/users`, { headers, data: { username: 'browser-user', email: 'browser@example.invalid', password, enabled: true } })).ok()).toBeTruthy();
    for (const client of [{ clientId: 'browser' }, { clientId: 'consent', requireConsent: true }, { clientId: 'step-up', requiredAcr: 'urn:idenplane:acr:mfa' }]) {
      expect((await request.post(`${base}/admin/realms/${realm}/clients`, { headers, data: { clientType: 'PUBLIC', redirectUris: [`${base}/oidc-test-first-callback`, redirect], grantTypes: ['authorization_code'], ...client } })).ok()).toBeTruthy();
    }
    const initial = authorization('browser'); await page.goto(initial.url);
    await page.locator('input[name="username"]').fill('browser-user'); await page.locator('input[name="password"]').fill(password);
    await Promise.all([page.waitForURL(url => url.pathname === '/oidc-test-second-callback'), page.locator('button[type="submit"]').first().click()]);
    let callback = new URL(page.url()); expect(callback.searchParams.get('state')).toBe(initial.state); expect(callback.searchParams.get('code')).toBeTruthy();
    const token = await request.post(`${base}/realms/${realm}/protocol/openid-connect/token`, { form: { grant_type: 'authorization_code', client_id: 'browser', redirect_uri: redirect, code: callback.searchParams.get('code')!, code_verifier: initial.verifier } }); expect(token.ok()).toBeTruthy();
    const silent = authorization('browser', 'none'); await page.goto(silent.url);
    callback = new URL(page.url()); expect(callback.pathname).toBe('/oidc-test-second-callback'); expect(callback.searchParams.get('state')).toBe(silent.state); expect(callback.searchParams.get('code')).toBeTruthy(); expect(callback.searchParams.has('error')).toBe(false);
    for (const [clientId, error] of [['consent', 'consent_required'], ['step-up', 'interaction_required'], ['browser', 'invalid_request']]) {
      const auth = authorization(clientId, error === 'invalid_request' ? 'none login' : 'none'); await page.goto(auth.url);
      callback = new URL(page.url()); expect(callback.pathname).toBe('/oidc-test-second-callback'); expect(callback.searchParams.get('state')).toBe(auth.state); expect(callback.searchParams.get('error')).toBe(error); expect(callback.searchParams.has('code')).toBe(false);
    }
    const anonymous = await browser.newContext();
    try {
      const other = await anonymous.newPage(), auth = authorization('browser', 'none'); await other.goto(auth.url);
      callback = new URL(other.url()); expect(callback.pathname).toBe('/oidc-test-second-callback'); expect(callback.searchParams.get('state')).toBe(auth.state); expect(callback.searchParams.get('error')).toBe('login_required');
    } finally { await anonymous.close(); }
  } finally {
    if (created) expect((await request.delete(`${base}/admin/realms/${realm}`, { headers })).ok()).toBeTruthy();
  }
});
