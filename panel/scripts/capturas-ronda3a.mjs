#!/usr/bin/env node
// Captures of the screens that round 3 of judge A touched, at 1440x900 and 390x844, in both themes, for an account
// with many pending messages (ana) and for one with few (bruno).
//
//   npm run build && CAPS_DIR=/some/dir node scripts/capturas-ronda3a.mjs [desktop|mobile] [who]
import { mkdirSync } from 'node:fs'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-ronda3a'
mkdirSync(outDir, { recursive: true })
const only = process.argv[2]
const who = process.argv[3] ?? 'ana'
const SIZES = [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
].filter(([name]) => !only || name === only)

for (const [name, size, mobile] of SIZES) {
  for (const theme of ['light', 'dark']) {
    const panel = await startPanel(8885, { build: false })
    const shot = async (page, what, full = false) => {
      await page.screenshot({ path: `${outDir}/${who}-${name}-${theme}-${what}.png`, fullPage: full })
      console.log(`${who}-${name}-${theme}-${what}`)
    }
    try {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      await login(page, panel.origin, who)
      const go = async (path, what, full = false) => {
        await page.goto(`${panel.origin}${path}`)
        await page.locator('main').first().waitFor()
        await page.waitForTimeout(500)
        await shot(page, what, full)
      }
      await go('/', '01-inicio', mobile)
      await page.getByTestId('bell').click()
      await page.waitForTimeout(300)
      await shot(page, '02-campana')
      await page.keyboard.press('Escape')
      await go('/messages', '03-mensajes', mobile)
      await page.getByRole('button', { name: /^Filtro/ }).click()
      await page.waitForTimeout(250)
      await shot(page, '04-filtro')
      await page.keyboard.press('Escape')
      await go('/areas', '05-areas', mobile)
      await page.getByRole('button', { name: /^Campos e instrucciones|^Editar/ }).first().click().catch(() => {})
      await page.waitForTimeout(400)
      await shot(page, '06-plantilla')
      await page.keyboard.press('Escape')
      await go('/settings', '07-ajustes', mobile)
      await go('/team', '08-equipo', mobile)
      await go('/connections/api', '09-conexion')
      if (mobile) {
        await go('/', '10-inicio-inicio')
        await page.getByRole('button', { name: /Abrir|menú|Navegación/i }).first().click().catch(() => {})
        await page.waitForTimeout(400)
        await shot(page, '11-menu')
      }
    } catch (err) {
      console.error(name, theme, err.message)
    } finally {
      await panel.stop()
    }
  }
}
