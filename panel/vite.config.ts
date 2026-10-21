import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Destino del proxy de /api: la API real si PANEL_API está definido; si no,
// el servidor doble de desarrollo (dev-server.mjs). Las rutas viven bajo /api
// en ambos, así que no se reescribe la ruta.
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
    // Ningún activo en línea como data: URI: la CSP sólo admite font-src 'self'.
    assetsInlineLimit: 0,
    // El paquete único mide 506 kB (156 kB comprimidos, medido el 2026-10-20): React, Router, Query y Radix.
    chunkSizeWarningLimit: 600,
    // Base de navegadores de MASTER-SPEC §3: Chrome 111, Safari 16.4, Firefox 128.
    target: ['chrome111', 'safari16.4', 'firefox128'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
  },
})
