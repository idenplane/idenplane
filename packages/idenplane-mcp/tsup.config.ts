import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  // @idenplane/http-internal is an unpublished, monorepo-local package —
  // inline it into the bundle rather than leaving a require/import that
  // wouldn't resolve for a real npm install of idenplane-mcp.
  noExternal: ['@idenplane/http-internal'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
