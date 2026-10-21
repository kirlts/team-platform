#!/usr/bin/env node
// Captures of the flow send → analyze → review → publish (ronda 2, juez B) at 1440x900 and 390x844, in both themes.
//
//   npx vite build && CAPS_DIR=/some/dir node scripts/capturas-ronda2b.mjs [desktop|mobile] [light|dark]
import { mkdirSync } from 'node:fs'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-ronda2b'
mkdirSync(outDir, { recursive: true })
const [, , onlySize, onlyTheme] = process.argv
const SIZES = [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
].filter(([name]) => !onlySize || name === onlySize)
const TEXT = 'Reunión de equipo del lunes. Opinión sobre algo que ya existe.\n\nError: al subir una captura de más de 10 MB el botón Enviar se queda girando.\n\nNueva funcionalidad: queremos poder etiquetar a varias personas.'
const wav = (name) => ({ name, mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) })

for (const [name, size, mobile] of SIZES) {
  for (const theme of ['light', 'dark'].filter((t) => !onlyTheme || t === onlyTheme)) {
    const panel = await startPanel(8794, { build: false, stepMs: 900 })
    const shot = async (page, what) => {
      await page.screenshot({ path: `${outDir}/${name}-${theme}-${what}.png` })
      console.log(`${name}-${theme}-${what}`)
    }
    try {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      await login(page, panel.origin, 'bruno')
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await shot(page, '00-inicio')
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      await bar.fill(Array.from({ length: 8 }, (_, i) => `Párrafo ${i + 1} del texto largo.`).join('\n\n'))
      await shot(page, '01-texto-largo')
      await bar.fill(TEXT)
      await page.locator('input[type=file]:not([capture])').setInputFiles([wav('nota-de-voz.wav'), wav('segunda.wav')])
      await page.getByRole('button', { name: 'Adjuntar' }).click()
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      await page.waitForTimeout(300)
      await shot(page, '02-enlace-enfocado')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.waitForTimeout(700)
      await shot(page, '03-franja-en-analisis')
      await page.getByTestId('tray-control').click()
      await page.waitForTimeout(400)
      await shot(page, '04-ventana-analizando')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
      await page.waitForTimeout(500)
      await shot(page, '05-propuesta')
      const second = page.getByRole('button', { name: /^Abrir el mensaje 2/ })
      if (await second.count()) {
        await second.click()
        await page.waitForTimeout(300)
        await shot(page, '06-mensaje-2')
        const add = page.getByRole('button', { name: 'Agregar destinatario' }).first()
        if (await add.count()) {
          await add.click()
          await page.waitForTimeout(300)
          await shot(page, '07-destinatarios')
          await page.keyboard.press('Escape')
        }
        await page.getByRole('button', { name: /^Área:/ }).first().click()
        await page.waitForTimeout(300)
        await shot(page, '08-area')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
        await page.waitForTimeout(400)
        await shot(page, '09-quitado')
      }
      await page.getByRole('button', { name: 'Original' }).first().click().catch(() => {})
      await page.waitForTimeout(300)
      await shot(page, '10-original-abierto')
      await page.getByRole('button', { name: 'Enviar', exact: false }).filter({ hasText: /Enviar \d/ }).first().click()
      await page.waitForTimeout(700)
      await shot(page, '11-publicado')
      await page.getByTestId('bell').click()
      await page.waitForTimeout(300)
      await shot(page, '12-campana')
    } catch (e) {
      console.error(name, theme, e.message.split('\n')[0])
    } finally {
      await panel.stop()
    }
  }
}
