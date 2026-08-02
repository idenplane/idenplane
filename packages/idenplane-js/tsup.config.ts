import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    server: 'src/server.ts',
    // Separate entry (not just bundled into index/server) so consumers that
    // can't afford `jose` in their bundle — e.g. Next.js Edge Middleware —
    // can import `idenplane-sdk/token` directly without pulling in `server.ts`'s
    // `jose`-dependent verifyToken/JWKS machinery. token.ts has zero runtime
    // imports of its own.
    token: 'src/token.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  external: ['react', 'jose'],
});
