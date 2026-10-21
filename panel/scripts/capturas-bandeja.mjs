#!/usr/bin/env node
// Captures of the tray of sends (UD-025) with 1, 4 and 10 inputs, in both themes, at 1440x900 and 1280x720.
//
//   npm run build && node scripts/capturas-bandeja.mjs
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = fileURLToPath(new URL('../capturas/', import.meta.url))
mkdirSync(outDir, { recursive: true })
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['compact', { width: 1280, height: 720 }]]) {
    for (const theme of ['light', 'dark']) {
      for (const count of [1, 4, 10]) {
        // A fresh dev server per capture: each one starts with an empty tray.
        const panel = await startPanel(8794, { build: false, stepMs: 600 })
        const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme })
        const page = await context.newPage()
        await login(page, panel.origin, 'bruno')
        const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
        for (let i = 1; i <= count; i++) {
          await bar.fill(`Envío ${i} de ${count}: revisar el punto ${i} de la pantalla de inicio y avisar al equipo cuando esté.`)
          await page.getByRole('button', { name: 'Enviar' }).first().click()
        }
        await page.getByRole('region', { name: 'Envíos', exact: true }).waitFor()
        // Mid-way, with some still running, and at the end, with all ready.
        await page.waitForTimeout(count === 1 ? 500 : 1200)
        await page.screenshot({ path: `${outDir}bandeja-${count}-en-curso-${name}-${theme}.png` })
        await page.waitForTimeout(7000)
        await page.screenshot({ path: `${outDir}bandeja-${count}-listos-${name}-${theme}.png` })
        console.log(`capturas/bandeja-${count}-*-${name}-${theme}.png`)
        await context.close()
        await panel.stop()
      }
    }
}
