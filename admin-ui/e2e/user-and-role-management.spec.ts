import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/console/login');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/?$/);
}

test('creates a user and a role in a fresh realm', async ({ page }) => {
  const realmName = `e2e-ur-${test.info().workerIndex}-${Date.now()}`;

  await login(page);

  await page.goto('/console/realms/create');
  await page.getByLabel('Name', { exact: true }).fill(realmName);
  await page.getByRole('button', { name: 'Create Realm' }).click();
  await expect(page).toHaveURL(/\/console\/realms\/?$/);

  // ── User ──
  await page.goto(`/console/realms/${realmName}/users/create`);
  await page.getByLabel('Username').fill('e2e-test-user');
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple-1');
  await page.getByRole('button', { name: 'Create User' }).click();

  await expect(page).toHaveURL(new RegExp(`/console/realms/${realmName}/users/?$`));
  await expect(page.locator('td', { hasText: 'e2e-test-user' })).toBeVisible();

  // ── Role ──
  await page.goto(`/console/realms/${realmName}/roles`);
  await page.getByRole('button', { name: 'Create Role' }).click();
  await page.getByLabel('Role Name').fill('e2e-test-role');
  await page.getByLabel('Description').fill('Created by an E2E test');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.locator('td', { hasText: new RegExp('^e2e-test-role$') })).toBeVisible();

  // Delete it back out through the confirm dialog, proving both halves of
  // the delete flow (the guard and the actual removal) work end to end.
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/are you sure you want to delete the role/i)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  await expect(page.getByText(/no roles found in this realm/i)).toBeVisible();
});
