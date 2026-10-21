#!/usr/bin/env node
// Captures of what the model generated (UD-026): Inicio with a proposal open (the AI surface) and the detail
// of a published message (the origin mark), at 390x844, 1440x900 and 1280x720, in both themes.
//
//   npm run build && node scripts/capturas-ia.mjs
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login, startPanel } from './../src/browser-support.mjs'

const outDir = fileURLToPath(new URL('../capturas/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const SIZES = [
  ['mobile', { width: 390, height: 844 }, true],
  ['desktop', { width: 1440, height: 900 }, false],
  ['compact', { width: 1280, height: 720 }, false],
]
const TEXT = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?'

for (const [name, size, mobile] of SIZES) {
  for (const theme of ['light', 'dark']) {
    const panel = await startPanel(8792, { build: false, stepMs: 150 })
    try {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      await login(page, panel.origin, 'bruno')
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(TEXT)
      await page.locator('input[type=file]:not([capture])').setInputFiles([{ name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) }])
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${outDir}ia-inicio-${name}-${theme}.png` })
      // With the original open: the row stops repeating its words.
      await page.locator('button[aria-expanded]').filter({ hasText: 'Original' }).first().click()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${outDir}ia-inicio-original-${name}-${theme}.png` })
      // Publish and open the detail of the first message: it carries the origin mark.
      await page.locator('button[aria-expanded]').filter({ hasText: 'Original' }).first().click()
      await page.getByRole('button', { name: 'Enviar', exact: true }).last().click()
      await page.waitForTimeout(800)
      const body = await (await page.request.get(`${panel.origin}/api/messages`)).json()
      const made = (body.items ?? body).find((m) => m.input_id)
      await page.goto(`${panel.origin}/messages/${made.id}`)
      await page.locator('main h1').waitFor()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${outDir}ia-detalle-${name}-${theme}.png` })
      console.log(`capturas/ia-*-${name}-${theme}.png`)
      await context.close()
    } finally {
      await panel.stop()
    }
  }
}
