#!/usr/bin/env node
// Captures of the screens that round 2 of judge A touched, at 1440x900 and 390x844, in both themes.
//
//   npm run build && CAPS_DIR=/some/dir node scripts/capturas-ronda2a.mjs [desktop|mobile]
import { mkdirSync } from 'node:fs'
import { login, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-ronda2a'
mkdirSync(outDir, { recursive: true })
const only = process.argv[2]
const SIZES = [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
].filter(([name]) => !only || name === only)

for (const [name, size, mobile] of SIZES) {
  for (const theme of ['light', 'dark']) {
    const panel = await startPanel(8794, { build: false })
    const shot = async (page, what, full = false) => {
      await page.screenshot({ path: `${outDir}/${name}-${theme}-${what}.png`, fullPage: full })
      console.log(`${name}-${theme}-${what}`)
    }
    try {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      // Sign-in with nothing typed: the error takes its reserved row.
      await page.goto(panel.origin)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await shot(page, '00-login-error')
      await login(page, panel.origin, 'ana')
      const go = async (path, what, full = false) => {
        await page.goto(`${panel.origin}${path}`)
        await page.locator('main').first().waitFor()
        await page.waitForTimeout(500)
        await shot(page, what, full)
      }
      await go('/', '01-inicio', mobile)
      await go('/messages', '02-mensajes', mobile)
      // Filter applied: the button wears it.
      await page.getByRole('button', { name: /^Filtro/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /Estado/ }).click()
      await page.waitForTimeout(300)
      await shot(page, '03-filtro-aplicado')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Filtro/ }).click()
      await page.waitForTimeout(200)
      await shot(page, '04-filtro-menu')
      await page.keyboard.press('Escape')
      await page.goto(`${panel.origin}/messages`)
      await page.locator('main article').first().click()
      await page.locator('main h1').first().waitFor()
      await page.waitForTimeout(500)
      await shot(page, '05-ficha', mobile)
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await page.waitForTimeout(500)
      await shot(page, '06-ficha-cerrada', mobile)
      await go('/areas', '07-areas', mobile)
      await page.getByRole('button', { name: /^Eliminar/ }).first().click()
      await page.waitForTimeout(500)
      await shot(page, '08-plantilla-eliminada', mobile)
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^Campos e instrucciones/ }).first().click()
      await page.waitForTimeout(400)
      await shot(page, '09-plantilla-modal')
      await page.getByRole('checkbox').first().click()
      await page.waitForTimeout(400)
      await shot(page, '10-plantilla-modal-guardado')
      await page.getByRole('button', { name: 'Listo' }).click()
      await page.getByRole('button', { name: 'Plantilla', exact: true }).click()
      await page.waitForTimeout(400)
      await shot(page, '11-plantilla-nueva')
      await page.keyboard.press('Escape')
      await go('/settings', '12-configuracion', mobile)
      await go('/team', '13-equipo', mobile)
      await go('/connections/api', '14-conexion')
      await page.keyboard.press('Tab')
      await shot(page, '15-foco')
      // A failing list: icon, reason and Reintentar.
      await page.route(/\/api\/messages(\?|$)/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fallo de prueba' } }) }))
      await page.goto(`${panel.origin}/messages`)
      await page.getByRole('button', { name: 'Reintentar' }).waitFor({ timeout: 15000 })
      await shot(page, '16-error-carga')
    } finally {
      await panel.stop()
    }
  }
}
