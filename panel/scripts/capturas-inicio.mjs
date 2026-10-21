#!/usr/bin/env node
// Captures of Inicio after the mockup (UD-046): without sends, just sent, analyzed, with the area changed, and with the side panel hidden;
// at 1440x900 and 390x844, in both themes. They are what is compared with `Plataforma Team.png`.
//
//   node scripts/capturas-inicio.mjs
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = fileURLToPath(new URL('../capturas/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const panel = await startPanel(Number(process.env.PANEL_CAPTURES_PORT ?? 8954), { stepMs: 500 })
try {
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['low', { width: 1280, height: 720 }], ['phone', { width: 390, height: 844 }]]) {
    for (const theme of ['light', 'dark']) {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme })
      const page = await context.newPage()
      await login(page, panel.origin, 'bruno')
      const shot = (what) => page.screenshot({ path: `${outDir}inicio-${what}-${name}-${theme}.png` })
      await shot('vacio')
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('El botón de guardar no responde en el móvil. Además sería bueno mostrar un resumen semanal en la portada.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByTestId('send-drawer').waitFor()
      await shot('enviado')
      await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).waitFor({ timeout: 30000 })
      await shot('analizado')
      // Another area for the open message: the box takes its color.
      await page.getByTestId('area-picker').first().click()
      await page.getByRole('menuitemradio', { name: 'Pregunta' }).click()
      await page.waitForTimeout(400)
      await shot('area-cambiada')
      if (name !== 'phone') {
        await page.getByTestId('sidebar-hide').click()
        await shot('panel-oculto')
      }
      await context.close()
    }
  }
} finally {
  await panel.stop()
}
