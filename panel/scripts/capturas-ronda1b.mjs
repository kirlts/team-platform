#!/usr/bin/env node
// Captures of the flow send → analyze → review → publish (ronda 1, juez B) at 1440x900 and 390x844, in both themes.
//
//   npm run build && CAPS_DIR=/some/dir node scripts/capturas-ronda1b.mjs [desktop|mobile]
import { mkdirSync } from 'node:fs'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-ronda1b'
mkdirSync(outDir, { recursive: true })
const only = process.argv[2]
const SIZES = [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
].filter(([name]) => !only || name === only)
const TEXT = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo.'
const wav = (name) => ({ name, mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) })

for (const [name, size, mobile] of SIZES) {
  for (const theme of ['light', 'dark']) {
    const panel = await startPanel(8793, { build: false, stepMs: 700 })
    const shot = async (page, what) => {
      await page.screenshot({ path: `${outDir}/${name}-${theme}-${what}.png` })
      console.log(`${name}-${theme}-${what}`)
    }
    try {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      await login(page, panel.origin, 'bruno')
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      await bar.fill(TEXT)
      await page.locator('input[type=file]:not([capture])').setInputFiles([wav('nota-de-voz-de-la-reunion-del-lunes-con-el-equipo.wav'), wav('segunda.wav'), wav('tercera.wav')])
      await page.getByRole('button', { name: 'Enlace' }).count()
      await page.getByRole('button', { name: 'Adjuntar' }).click()
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      await page.getByLabel('Enlace').fill('https://example.org/informe')
      await page.getByRole('button', { name: 'Agregar' }).click()
      await shot(page, '01-compositor')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByTestId('tray-control').click()
      await page.waitForTimeout(300)
      await shot(page, '02-analizando-t0')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 30000 })
      await page.waitForTimeout(500)
      await shot(page, '03-propuesta')
      const second = page.getByRole('button', { name: /^Abrir el mensaje 2/ })
      if (await second.count()) {
        await second.click()
        await page.waitForTimeout(300)
        await shot(page, '04-propuesta-mensaje-2')
        await page.getByRole('button', { name: 'Destinatarios: agregar' }).count()
        const add = page.getByRole('button', { name: 'Agregar destinatario' }).first()
        if (await add.count()) {
          await add.click()
          await page.waitForTimeout(300)
          await shot(page, '05-destinatarios')
          await page.keyboard.press('Escape')
        }
        await page.getByRole('button', { name: /^Área:/ }).first().click()
        await page.waitForTimeout(300)
        await shot(page, '06-areas')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
        await page.waitForTimeout(400)
        await shot(page, '07-quitado')
      }
      await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).click()
      await page.waitForTimeout(700)
      await shot(page, '08-publicado')
      // A second send, discarded and restored.
      await bar.fill('Otro asunto: revisar el contraste del botón de enviar en el tema claro.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      if (!(await page.getByRole('dialog').count())) await page.getByTestId('tray-control').click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 30000 })
      await page.getByRole('button', { name: 'Descartar' }).last().click()
      await page.waitForTimeout(500)
      await shot(page, '09-descartado')
      await page.locator('[data-notice]').getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 10000 })
      await shot(page, '10-restaurado')
      // A failure.
      await page.keyboard.press('Escape')
      await bar.fill('Esto va a fallar [simular falla]')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      if (!(await page.getByRole('dialog').count())) await page.getByTestId('tray-control').click()
      await page.getByRole('button', { name: 'Reintentar' }).first().waitFor({ timeout: 30000 })
      await page.waitForTimeout(400)
      await shot(page, '11-falla')
      await context.close()
    } catch (err) {
      console.error(name, theme, err.message.split('\n')[0])
    } finally {
      await panel.stop()
    }
  }
}
