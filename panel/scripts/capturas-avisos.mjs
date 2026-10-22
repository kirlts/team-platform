// Screenshots of the notice of the screen (UD-253): centered, at 1440x900 and 390x844, light and dark. CAPTURAS_DIR says where.
import { login, settled, startPanel } from '../src/browser-support.mjs'

const OUT = process.env.CAPTURAS_DIR ?? 'capturas-avisos'
const SIZES = (process.env.CAPTURAS_SIZES ?? '1440x900,390x844').split(',').map((s) => s.split('x').map(Number))
const panel = await startPanel(Number(process.env.PANEL_FIT_PORT ?? 8520), { stepMs: 80 })
try {
  for (const [width, height] of SIZES) {
    for (const scheme of ['light', 'dark']) {
      await panel.control.reset()
      const context = await panel.browser.newContext({ viewport: { width, height }, locale: 'es-CL', colorScheme: scheme })
      const page = await context.newPage()
      await login(page, panel.origin, 'ana')
      await page.goto(`${panel.origin}/team`)
      await page.getByRole('button', { name: /^Desactivar a / }).first().click()
      const notice = page.locator('[data-notice]')
      await notice.waitFor()
      await settled(page)
      const box = await notice.boundingBox()
      console.log(`${width}x${height} ${scheme}: x=${box.x.toFixed(1)} w=${box.width.toFixed(1)} centro=${(box.x + box.width / 2).toFixed(1)} de ${width / 2} y=${box.y.toFixed(1)} h=${box.height.toFixed(1)}`)
      await page.screenshot({ path: `${OUT}/aviso-${width}x${height}-${scheme}.png` })
      await context.close()
    }
  }
} finally {
  await panel.stop()
}
