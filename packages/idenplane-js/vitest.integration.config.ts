import { defineConfig } from 'vitest/config';

// Runs only integration/**, which needs a live Idenplane server (see
// integration/README.md). Kept separate from vitest.config.ts so a plain
// `npm test` never attempts these without one.
export default defineConfig({
  test: {
    include: ['integration/**/*.integration.test.ts'],
    testTimeout: 20_000,
  },
});
