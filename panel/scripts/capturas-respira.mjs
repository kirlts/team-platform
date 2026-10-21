#!/usr/bin/env node
// Captures of Inicio's air (UD-110): at rest and with a send open, at the five widths of the brief, in both themes.
//
//   PANEL_CAPTURES_PORT=9033 CAPTURES_DIR=/path node scripts/capturas-respira.mjs
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPTURES_DIR ?? fileURLToPath(new URL('../capturas/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const SIZES = [[1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [390, 844]]
const panel = await startPanel(Number(process.env.PANEL_CAPTURES_PORT ?? 8954), { stepMs: 500 })
try {
  for (const [width, height] of SIZES) {
    for (const theme of ['light', 'dark']) {
      const context = await panel.browser.newContext({ viewport: { width, height }, locale: 'es-CL', colorScheme: theme })
      const page = await context.newPage()
      await login(page, panel.origin, 'bruno')
      await page.locator('main h1').first().waitFor()
      await page.waitForLoadState('networkidle')
      const name = `${width}x${height}-${theme}`
      await page.screenshot({ path: `${outDir}/respira-reposo-${name}.png` })
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('El botón de guardar no responde en el móvil. Además sería bueno mostrar un resumen semanal en la portada.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByTestId('send-drawer').waitFor()
      await page.getByTestId('published-message').first().waitFor({ timeout: 30000 })
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `${outDir}/respira-envio-${name}.png` })
      await context.close()
    }
  }
} finally {
  await panel.stop()
}
