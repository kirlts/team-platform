import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Target of the /api proxy: the real API if PANEL_API is defined; otherwise,
// the development double server (dev-server.mjs). The routes live under /api
// in both, so the route is not rewritten.
const apiTarget = process.env.PANEL_API ?? `http://127.0.0.1:${process.env.PANEL_DEV_PORT ?? '8787'}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    // No asset inlined as a data: URI: the CSP only admits font-src 'self'.
    assetsInlineLimit: 0,
    // The single bundle is 506 kB (156 kB compressed, measured 2026-10-20): React, Router, Query and Radix.
    chunkSizeWarningLimit: 600,
    // Browser baseline from MASTER-SPEC §3: Chrome 111, Safari 16.4, Firefox 128.
    target: ['chrome111', 'safari16.4', 'firefox128'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
  },
})
