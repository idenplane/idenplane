import { test, expect } from '@playwright/test';

// Requires a live backend on :3000 with DEMO_MODE=true, which auto-bootstraps
// a master-realm admin user and prefills the login form (see LoginPage.tsx).

test('signs in with the demo admin credentials and reaches the dashboard', async ({ page }) => {
  await page.goto('/console/login');

  await expect(page.getByText('Demo environment')).toBeVisible();
  await expect(page.getByLabel('Username')).not.toHaveValue('');
  // Non-exact `getByLabel('Password')` also substring-matches the "Show
  // password" visibility-toggle button (#1283), so it must be exact here.
  await expect(page.getByLabel('Password', { exact: true })).not.toHaveValue('');

  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  await expect(page).toHaveURL(/\/console\/?$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('rejects an invalid password', async ({ page }) => {
  await page.goto('/console/login');

  await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText(/invalid username or password/i);
  await expect(page).toHaveURL(/\/console\/login$/);
});
