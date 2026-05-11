import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/console/',
  server: {
    port: 5173,
    proxy: {
      '/admin': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        logLevel: 'warn',
        // Rewrite /admin prefix so backend receives clean path
        rewrite: (path) => path.replace(/^\/admin/, ''),
      },
      // Health checks bypass /admin - direct to backend
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        logLevel: 'warn',
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
