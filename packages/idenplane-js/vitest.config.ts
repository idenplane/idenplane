import { defineConfig } from 'vitest/config';

// integration/ holds tests that need a live Idenplane server and run via
// `npm run test:integration` (see vitest.integration.config.ts) — excluded
// here so plain `npm test` stays a fast, server-less unit run.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'integration/**',
    ],
  },
});
