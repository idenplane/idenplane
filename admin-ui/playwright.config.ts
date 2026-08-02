import { defineConfig, devices } from '@playwright/test';

// Real end-to-end tests: a Chromium browser drives the admin console (served
// by `vite dev` on :5173) against a live backend on :3000. CI starts both
// processes (with DEMO_MODE=true so an admin user is auto-bootstrapped) and
// waits for /health before running these; see the `admin-ui-e2e` job in
// .github/workflows/ci.yml. There is no webServer entry here because the
// backend needs a database migration step that Playwright can't orchestrate.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
