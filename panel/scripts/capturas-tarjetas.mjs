#!/usr/bin/env node
// Screenshots of the three lists of cards (Inicio, Mensajes, an area) at 1440x900 and 390x844, light and dark (UD-241).
//   node scripts/capturas-tarjetas.mjs <outDir> [port]
// Builds panel/dist unless FIT_SIN_BUILD is set; the dev server and the browser come from browser-support.mjs.
import { mkdirSync } from 'node:fs'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = process.argv[2] ?? 'capturas/tarjetas'
const port = Number(process.argv[3] ?? process.env.PANEL_CAPTURE_PORT ?? 8353)
mkdirSync(outDir, { recursive: true })
const panel = await startPanel(port, { stepMs: 80 })
const VIEWPORTS = { desktop: { width: 1440, height: 900, mobile: false }, mobile: { width: 390, height: 844, mobile: true } }
const VIEWS = [
  ['inicio', '/', 'Últimos mensajes'],
  ['mensajes', '/messages', 'Mensajes'],
  ['area', '/areas/a-error', null],
]
try {
  for (const [vp, cfg] of Object.entries(VIEWPORTS)) {
    for (const theme of ['light', 'dark']) {
      const context = await panel.browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: cfg.mobile ? 2 : 1, isMobile: cfg.mobile, hasTouch: cfg.mobile, colorScheme: theme, locale: 'es-CL' })
      await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch {} }, theme)
      const page = await context.newPage()
      await login(page, panel.origin)
      for (const [name, path] of VIEWS) {
        await page.goto(`${panel.origin}${path}`)
        await page.locator('main h1').first().waitFor()
        await page.locator('article h3').first().waitFor()
        await settled(page)
        await page.waitForTimeout(400)
        const file = `${outDir}/${name}-${vp}-${theme}.png`
        await page.screenshot({ path: file })
        const heights = await page.locator('main article').evaluateAll((els) => els.filter((e) => e.querySelector('h3')).map((e) => e.offsetHeight))
        console.log(file, 'alturas', heights.join(' '))
      }
      await context.close()
    }
  }
} finally {
  await panel.stop()
}
