import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    middleware: 'src/middleware.ts',
    server: 'src/server.ts',
    api: 'src/api.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['authme-sdk', 'next', 'react'],
});
