import { test, expect, type APIRequestContext } from '@playwright/test';

// Requires a live backend on :3000 with DEMO_MODE=true (see login.spec.ts).
// The console's public sign-up entry hands over to the hosted, themed
// sign-up page, which renders the realm's CAPTCHA provider under a CSP that
// admits that provider on that page only.

async function adminToken(request: APIRequestContext): Promise<string> {
  const demo = await (await request.get('/admin/auth/demo-info')).json();
  const login = await request.post('/admin/auth/login', {
    data: { username: demo.username, password: demo.password },
  });
  expect(login.ok()).toBeTruthy();
  return (await login.json()).access_token as string;
}

test('the console sign-up entry opens the hosted page with CAPTCHA on', async ({ page, request }) => {
  const realmName = `e2e-signup-${test.info().workerIndex}-${Date.now()}`;
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}` };

  const created = await request.post('/admin/realms', { headers, data: { name: realmName } });
  expect(created.ok()).toBeTruthy();
  const updated = await request.patch(`/admin/realms/${realmName}`, {
    headers,
    data: {
      registrationAllowed: true,
      captchaEnabled: true,
      captchaProvider: 'hcaptcha',
      hcaptchaSiteKey: '10000000-ffff-ffff-ffff-000000000001',
      hcaptchaSecretKey: '0x0000000000000000000000000000000000000000',
    },
  });
  expect(updated.ok()).toBeTruthy();

  // Public: no console sign-in first.
  const hosted = page.waitForResponse((res) => res.url().includes(`/realms/${realmName}/register`));
  await page.goto(`/console/register/${realmName}?client_id=web`);
  const response = await hosted;

  await expect(page).toHaveURL(new RegExp(`/realms/${realmName}/register\\?client_id=web$`));
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('.h-captcha')).toHaveAttribute(
    'data-sitekey',
    '10000000-ffff-ffff-ffff-000000000001',
  );
  const csp = response.headers()['content-security-policy'] ?? '';
  const scriptSrc =
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src ')) ?? '';
  expect(scriptSrc).toContain('https://hcaptcha.com');
  expect(scriptSrc).not.toContain('unsafe-inline');
  expect(scriptSrc).not.toContain('unsafe-eval');
});

test('an invalid realm name is not redirected', async ({ page }) => {
  await page.goto('/console/register/a%20b');
  await expect(page.getByRole('heading', { name: 'Invalid sign-up link' })).toBeVisible();
  await expect(page).toHaveURL(/\/console\/register\//);
});
