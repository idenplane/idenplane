import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/console/login');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/?$/);
}

test('creates a realm, then creates a client from the Grafana template', async ({ page }) => {
  const realmName = `e2e-${test.info().workerIndex}-${Date.now()}`;

  await login(page);

  await page.goto('/console/realms/create');
  // Non-exact `getByLabel('Name')` also substring-matches "Display Name".
  await page.getByLabel('Name', { exact: true }).fill(realmName);
  await page.getByLabel('Display Name').fill('E2E Test Realm');
  await page.getByRole('button', { name: 'Create Realm' }).click();

  await expect(page).toHaveURL(/\/console\/realms\/?$/);
  // Scoped to <td> rather than getByText: the row itself also carries the
  // realm name in its aria-label, and matching loose text risks resolving
  // to both the row and the cell.
  await expect(page.locator('td', { hasText: realmName })).toBeVisible();

  await page.goto(`/console/realms/${realmName}/clients/new`);
  await page.getByLabel('Start from a template').selectOption({ label: 'Grafana' });

  // Applying a template pre-fills Client ID/Name/Type/Redirect URIs and shows
  // the per-app setup instructions panel.
  await expect(page.locator('#clientId')).toHaveValue('grafana');
  await expect(page.getByText('Setup on the Grafana side:')).toBeVisible();

  await page.getByRole('button', { name: 'Create Client' }).click();

  await expect(page.getByRole('heading', { name: 'Client Created Successfully' })).toBeVisible();

  await page.getByRole('button', { name: 'Go to Clients' }).click();
  await expect(page).toHaveURL(new RegExp(`/console/realms/${realmName}/clients/?$`));
  await expect(page.locator('td', { hasText: 'grafana' })).toBeVisible();
});
