#!/usr/bin/env node
// Captures of the mentions (UD-275) at 1440x900 and 390x844, headless: the list of «@» open over the reply field, and the thread with a mention drawn highlighted.
//
//   CAPS_DIR=/some/dir node scripts/capturas-menciones.mjs
import { mkdirSync } from 'node:fs'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-menciones'
mkdirSync(outDir, { recursive: true })
const SIZES = [['1440x900', { width: 1440, height: 900 }, false], ['390x844', { width: 390, height: 844 }, true]]
const panel = await startPanel(8887, { stepMs: 80 })
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
    const field = page.locator('#reply-field')
    await field.click()
    await field.pressSequentially('Mira esto, por favor @')
    await page.getByRole('listbox').waitFor()
    await page.waitForTimeout(250)
    await shot('01-lista-abierta')
    await field.pressSequentially('cla')
    await page.keyboard.press('Enter')
    await field.pressSequentially('y dime qué recomiendas')
    await page.waitForTimeout(150)
    await shot('02-token-en-el-campo')
    await page.getByRole('button', { name: 'Responder', exact: true }).click()
    await page.locator('[data-mention]').first().waitFor()
    await page.waitForTimeout(400)
    await shot('03-hilo-con-mencion')
    await context.close()
  }
} finally {
  await panel.stop()
}
