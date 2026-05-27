import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/console/',
  server: {
    port: 5173,
    proxy: {
      // Admin API — controllers are mounted under `admin/...`, so forward the
      // path unchanged (do NOT strip `/admin`, or every admin call 404s).
      '/admin': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      // Root-mounted controllers the admin-ui also calls (no `/admin` prefix):
      // realm registration endpoints and the first-run setup wizard.
      '/realms': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/setup-wizard': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Explicit build output config for cache headers at deployment
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
})
