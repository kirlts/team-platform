import { login, settled, startPanel } from './browser-support.mjs'
const panel = await startPanel(8513, { build: false, stepMs: 80 })
const out = process.env.OUT
try {
  const shot = async (who, url, vp, name, fn) => {
    const context = await panel.browser.newContext({ viewport: vp, locale: 'es-CL', colorScheme: 'light' })
    const page = await context.newPage()
    await login(page, panel.origin, who)
    await page.goto(panel.origin + url)
    await page.locator('main article, main section').first().waitFor()
    await settled(page)
    if (fn) console.log(name, JSON.stringify(await fn(page)))
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
    await context.close()
  }
  await shot('bruno', '/messages', { width: 1440, height: 900 }, 'bruno', (p) => p.$$eval('main article', (rs) => rs.map((r) => [r.querySelector('h3')?.textContent.slice(0, 20), !!r.querySelector('[data-testid=row-check]'), !!r.querySelector('[data-testid=card-delete]')])))
  await shot('ana', '/messages', { width: 390, height: 844 }, 'phone', (p) => p.$$eval('main article', (rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height))))
  await shot('ana', '/areas/a-error', { width: 1440, height: 900 }, 'area', (p) => p.$$eval('[data-testid=row-check]', (rs) => rs.length))
} finally { await panel.stop() }
