import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'node18',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: ['tests/*.test.ts'],
    outDir: 'dist/tests',
    format: ['esm'],
    dts: false,
    clean: false,
    target: 'node18',
    sourcemap: true,
  },
]);
