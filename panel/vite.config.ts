import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Target of the API proxy: the real API if PANEL_API is defined; otherwise
// the development double server (dev-server.mjs). The route is not rewritten.
const apiTarget = process.env.PANEL_API ?? `http://127.0.0.1:${process.env.PANEL_DEV_PORT ?? '8787'}`
// H-3721: in development the mount point comes from VITE_BASE_PATH and VITE_API_BASE (src/lib/base.ts).
const devBase = process.env.VITE_BASE_PATH ?? '/'
const devApi = (process.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')

export default defineConfig(({ command }) => ({
  // The build is relative: the server that serves index.html writes the real base into it (src/api/index.js,
  // `mountedIndex`), so one build serves any path. CSS urls stay relative to the stylesheet.
  base: command === 'build' ? './' : devBase,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: { [devApi]: { target: apiTarget, changeOrigin: false } },
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
}))
