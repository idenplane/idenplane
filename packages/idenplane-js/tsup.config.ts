import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    server: 'src/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  external: ['react', 'jose'],
});
