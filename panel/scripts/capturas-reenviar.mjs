#!/usr/bin/env node
// Captures of «Reenviar» (UD-272) at 1440x900 and 390x844: the window empty (button off, what is missing), the window filled, and the thread with a forward.
//
//   CAPS_DIR=/some/dir node scripts/capturas-reenviar.mjs
import { mkdirSync } from 'node:fs'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-reenviar'
mkdirSync(outDir, { recursive: true })
const SIZES = [['1440x900', { width: 1440, height: 900 }, false], ['390x844', { width: 390, height: 844 }, true]]
const panel = await startPanel(8886, { stepMs: 80 })
try {
  for (const [name, size, mobile] of SIZES) {
    await panel.control.reset()
    const { done_id: id } = await panel.control.execution()
    const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: 'light', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
    const page = await context.newPage()
    const shot = async (what) => { await page.screenshot({ path: `${outDir}/${name}-${what}.png` }); console.log(`${name}-${what}`) }
    await login(page, panel.origin, 'ana')
    await page.goto(`${panel.origin}/messages/${id}`)
    await page.locator('main h1').waitFor()
    await settled(page)
    await shot('01-ficha')
    await page.getByTestId('forward-open').click()
    await page.getByRole('dialog').waitFor()
    await page.waitForTimeout(250)
    await shot('02-ventana-vacia')
    await page.getByTestId('forward-member').selectOption({ label: 'Claude' })
    await page.getByTestId('forward-comment').fill('Investiga por qué el botón Agendar sigue diciendo Reservar en la ficha del paciente y dime qué recomiendas. Quiero el análisis en un PDF.')
    await page.waitForTimeout(150)
    await shot('03-ventana-llena')
    await page.getByTestId('forward-submit').click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.getByTestId('forward-notice').waitFor()
    await page.waitForTimeout(400)
    await shot('04-hilo-con-reenvio')
    await context.close()
  }
} finally {
  await panel.stop()
}
