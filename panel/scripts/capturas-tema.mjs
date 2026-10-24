#!/usr/bin/env node
// Captures of every screen with a host theme (THEME_CSS) loaded, at 1440x900 and 390x844, in the light theme, against dev-server.mjs
// serving panel/dist. They are what is compared against the host's design guide before and after a change.
//
//   npm run build && THEME_CSS=/path/theme.css CAPS_DIR=/some/dir node scripts/capturas-tema.mjs [desktop|mobile] [light|dark]
import { mkdirSync } from 'node:fs'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = process.env.CAPS_DIR ?? '/tmp/capturas-tema'
mkdirSync(outDir, { recursive: true })
const only = process.argv[2]
const theme = process.argv[3] ?? 'light'
const SIZES = [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
].filter(([name]) => !only || name === only)

const csrf = { 'x-team-request': 'panel' }
for (const [name, size, mobile] of SIZES) {
  const panel = await startPanel(Number(process.env.CAPS_PORT ?? 8886), { build: false })
  const shot = async (page, what, full = true) => {
    await settled(page)
    // <main> is the page's own scroller, so a full-page shot grows the window to what <main> holds instead.
    const extra = full ? await page.evaluate(() => { const m = document.querySelector('main#main'); return m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0 }) : 0
    if (extra) { await page.setViewportSize({ width: size.width, height: Math.min(size.height + extra, 6000) }); await settled(page) }
    await page.screenshot({ path: `${outDir}/${name}-${theme}-${what}.png`, fullPage: full })
    if (extra) await page.setViewportSize(size)
    console.log(`${name}-${theme}-${what}`)
  }
  try {
    const context = await panel.browser.newContext({ viewport: size, locale: 'es-CL', colorScheme: theme, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
    const page = await context.newPage()
    await page.goto(panel.origin)
    await page.getByLabel('Correo').waitFor()
    await shot(page, '00-ingreso', false)
    await login(page, panel.origin, 'ana')
    const review = await (await page.request.post(`${panel.origin}/api/_control/review`, { headers: csrf })).json()
    const list = (await (await page.request.get(`${panel.origin}/api/messages?limit=200`)).json()).items
    const find = (re) => list.find((m) => re.test(m.title))?.id
    const replies = find(/Agregar exportación/)
    if (replies) {
      await page.request.post(`${panel.origin}/api/messages/${replies}/replies`, { data: { body: 'Revisado: la exportación queda en la pestaña Datos.', kind: 'answer' }, headers: csrf })
      await page.request.post(`${panel.origin}/api/messages/${replies}/forward`, { data: { member_id: 'u-bruno', comment: 'Para que lo mires' }, headers: csrf }).catch(() => {})
    }
    const go = async (path, what, full = true) => {
      await page.goto(`${panel.origin}${path}`)
      await page.locator('main#main').waitFor()
      await shot(page, what, full)
    }
    await go('/', '01-inicio')
    await go('/messages', '02-mensajes')
    if (review.message_id) await go(`/messages/${review.message_id}`, '03-ficha-revision')
    if (replies) await go(`/messages/${replies}`, '04-ficha-respuestas')
    const long = find(/Hilo largo/)
    if (long) await go(`/messages/${long}`, '05-ficha-hilo-largo')
    const gallery = find(/Galería de seis/)
    if (gallery) await go(`/messages/${gallery}`, '06-ficha-galeria')
    await go('/', '07-envio', false)
    await page.getByRole('button', { name: /^Enviar|^Nuevo mensaje|^Escribir/ }).first().click().catch(() => {})
    await shot(page, '07-envio', false)
    await page.keyboard.press('Escape')
    await go('/areas', '08-areas')
    await go('/areas/a-error', '09-area')
    await go('/team', '10-equipo')
    await go('/settings', '11-ajustes')
    await go('/connections', '12-conexiones')
    await go('/connections/api', '13-conexion-api')
    await go('/', '14-cola', false)
    await page.getByRole('button', { name: /Cola|En curso|Trabajos/ }).first().click().catch(() => {})
    await shot(page, '14-cola', false)
  } catch (err) {
    console.error(name, theme, err.message)
  } finally {
    await panel.stop()
  }
}
