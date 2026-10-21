#!/usr/bin/env node
// Captures of the top bar (UD-100): the bar, a state menu and an area menu, 1440x900 and 390x844, both themes.
//   CAPS_DIR=/dir node scripts/capturas-barra.mjs
import { mkdirSync } from 'node:fs'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-barra'
mkdirSync(outDir, { recursive: true })
const panel = await startPanel(Number(process.env.PANEL_CAPS_PORT ?? 9024), { build: false })
try {
  for (const [name, size, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    for (const theme of ['light', 'dark']) {
      const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage()
      await login(page, panel.origin, 'ana')
      await page.getByTestId('status-bar').waitFor()
      await settled(page)
      const shot = (what) => page.screenshot({ path: `${outDir}/${name}-${theme}-${what}.png` })
      await shot('1-barra')
      if (mobile) {
        await page.getByTestId('summary-menu').click()
        await settled(page)
        await shot('2-resumen')
      } else {
        await page.getByTestId('state-button').first().click()
        await settled(page)
        await shot('2-estado')
        await page.keyboard.press('Escape')
        await page.getByTestId('area-pending').first().click()
        await settled(page)
        await shot('3-area')
      }
      await context.close()
    }
  }
} finally {
  await panel.stop()
}
