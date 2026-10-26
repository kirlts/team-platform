#!/usr/bin/env node
// Screenshots of the messages zone (home, composer with attachments and recipients, list with a filter, the message sheet and a thread
// with Claude's notices) at 1440x900 and 390x844, light and dark, against the double server.
// Flags: --no-build skips the build, --out <dir> picks the output folder, --only <prefix> shoots one view.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
const out = arg('--out') ?? fileURLToPath(new URL('../capturas/mensajes/', import.meta.url))
mkdirSync(out, { recursive: true })
const only = arg('--only')
const panel = await startPanel(Number(process.env.PANEL_CAPTURE_PORT ?? 8871), { build: !process.argv.includes('--no-build') })
const origin = panel.origin
const problems = []
const VPS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }

async function shoot(vp, theme) {
  await panel.control.reset()
  const mobile = vp === 'mobile'
  const context = await panel.browser.newContext({ viewport: VPS[vp], deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, locale: 'es-CL' })
  await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch {} }, theme)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${vp}/${theme}] ${e.message}`))
  await login(page, origin, 'ana')
  const take = async (name, full = false) => {
    if (only && !name.startsWith(only)) return
    await settled(page)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}${name}-${vp}-${theme}.png`, fullPage: full })
    console.log(`${name}-${vp}-${theme}.png`)
  }
  await page.goto(origin)
  await page.locator('main h1').first().waitFor()
  await take('1-inicio', true)
  // New message with attachments and the «Para» control open.
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Corregir el desalineado del menú lateral en la vista de métricas.\n\nAgregar la sincronización con WhatsApp.')
  await page.locator('input[type=file]:not([capture])').first().setInputFiles([
    { name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) },
    { name: 'feedback-del-cliente.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('ejemplo') },
  ])
  await page.waitForTimeout(400)
  await take('2-nuevo')
  const para = page.getByRole('button', { name: /^Para/ }).first()
  if (await para.count()) { await para.click(); await page.waitForTimeout(300); await take('2-nuevo-para') ; await page.keyboard.press('Escape') }
  await page.goto(`${origin}/messages`)
  await page.getByRole('heading', { name: 'Mensajes', level: 1 }).waitFor()
  await take('3-mensajes')
  await page.goto(`${origin}/messages?q=zzzz-nada`)
  await page.getByRole('heading', { name: 'Mensajes', level: 1 }).waitFor()
  await take('3-mensajes-vacio')
  const list = await (await page.request.get(`${origin}/api/messages`)).json()
  const items = list.items ?? list
  const rich = items.find((m) => m.title.startsWith('Revisar la lectura')).id
  await page.goto(`${origin}/messages/${rich}`)
  await page.locator('main h1').waitFor()
  await take('4-detalle', true)
  // Thread with Claude's notices: started, a forward, a failed and retryable session.
  const target = items.find((m) => m.title.startsWith('Confirmar el formato')).id
  await page.route(`**/api/messages/${target}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch(); const body = await res.json()
    const t0 = Date.now()
    body.progress_notes = [{ id: 'p1', body: 'Claude empezó a trabajar', created_at: new Date(t0 - 9 * 60e3).toISOString() }, { id: 'p2', body: 'En espera: entrega a producción\nLa batería corre en el servidor de despliegue.', created_at: new Date(t0 - 5 * 60e3).toISOString() }]
    body.replies.push({ id: '9000', message_id: target, author_id: 'u-ana', body: 'Claude, revisa si el informe acepta PNG.', kind: 'forward', forwarded_to: 'u-bruno', created_at: new Date(t0 - 7 * 60e3).toISOString(), attachments: [], mentions: [] })
    body.replies.push({ id: '9001', message_id: target, author_id: 'u-bruno', body: 'Claude no pudo responder: se acabó el tiempo.', kind: 'answer', created_at: new Date(t0 - 60e3).toISOString(), retryable: true, replaced_by_job_id: null, retrying: false, attachments: [], mentions: [] })
    await route.fulfill({ response: res, json: body })
  })
  await page.goto(`${origin}/messages/${target}`)
  await page.locator('main h1').waitFor()
  await take('5-hilo', true)
  await context.close()
}
try {
  for (const vp of Object.keys(VPS)) for (const theme of ['light', 'dark']) await shoot(vp, theme)
} catch (e) { problems.push(String(e.stack ?? e)) } finally { await panel.stop() }
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
