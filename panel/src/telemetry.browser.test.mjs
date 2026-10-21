// Interface telemetry in a real browser (UD-091): `npm run test:telemetry`. The same scenario runs twice, against the
// development double server (dev-server.mjs) and against the real server (src/server.js with the demo modules), and each
// time the Editor's summary has to show what the person did, with no text of anything they wrote.
//
// The scenario: sign in, visit three screens, send a text and publish what the analysis proposes, answer a message,
// close another one, and send one more text that is left unpublished while the page closes (an abandonment).
// Port: PANEL_TELEMETRY_PORT (the double server). The real server takes a free port of its own.

import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { login, ROOT, startPanel } from './browser-support.mjs'

const SENTINEL = 'SENTINELA-texto-privado-4471'
const REPLY_SENTINEL = 'SENTINELA-respuesta-privada-8820'
const csrf = { 'x-team-request': 'panel' }
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => {})
})

async function cookieOf(context) {
  return (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
}

/** Hides the page the way a browser does when the person leaves: the queue is sent with `keepalive`. */
async function hide(page) {
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/telemetry/ui') && r.request().method() === 'POST')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  assert.equal((await sent).status(), 204)
}

async function scenario({ origin, browser, signIn, pick, replier }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  const page = await context.newPage()
  const bodies = []
  const track = (p) => p.on('request', (r) => {
    if (r.url().endsWith('/api/telemetry/ui') && r.method() === 'POST') bodies.push(r.postData() ?? '')
  })
  const dump = async (label, pg = page) => {
    const dir = path.join(process.env.HOME ?? tmpdir(), '.cache/claude-tmp/team-platform-ui')
    mkdirSync(dir, { recursive: true })
    await pg.screenshot({ path: path.join(dir, `telemetry-${label}.png`) }).catch(() => {})
    console.error(`${label}: ${(await pg.locator('body').innerText().catch(() => '')).slice(0, 1500)}`)
  }
  track(page)
  await signIn(page)
  for (const view of [/^Mensajes/, /^Configuración$/]) {
    await page.getByRole('link', { name: view }).first().click()
    await page.locator('main').first().waitFor()
  }
  await page.getByRole('link', { name: /^Inicio$/ }).first().click()

  // Send and publish: the text is the sentinel and must never be seen by the telemetry.
  const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
  await bar.fill(`${SENTINEL}\n\nSegundo punto del mismo texto.`)
  await bar.press('End') // `fill` sets the value without keys: one real key press, whose identity is never read
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await page.getByTestId('tray-control').click()
  const publish = page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ })
  await publish.waitFor({ timeout: 30000 })
  for (let i = 0; i < 50 && (await publish.isDisabled()); i++) await page.waitForTimeout(100) // a required field is filled by the demo analysis
  await publish.click()
  await page.locator('[data-notice]').getByText(/^Se publicó|^Se publicaron/).waitFor({ timeout: 30000 }).catch(async (e) => { await dump('publish'); throw e })

  // Reply and close on a published message. The author cannot answer their own message: a replier is another person.
  const list = await (await page.request.get(`${origin}/api/messages`)).json()
  const first = pick(list.items ?? list)
  const other = replier ? await replier(context) : page
  if (replier) track(other)
  await other.goto(`${origin}/messages/${first.id}`)
  await other.locator('main h1').waitFor()
  await other.getByLabel('Respuesta', { exact: true }).fill(REPLY_SENTINEL, { timeout: 15000 }).catch(async (e) => { await dump('reply', other); throw e })
  await other.getByRole('button', { name: 'Responder', exact: true }).click()
  await other.getByText(REPLY_SENTINEL).first().waitFor()
  if (replier) {
    await hide(other)
    await page.goto(`${origin}/messages/${first.id}`)
    await page.locator('main h1').waitFor()
  }
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.getByRole('button', { name: 'Reabrir', exact: true }).waitFor()

  // Leave the page with a send that was started and never published: the unload sends the abandonment.
  await page.goto(origin)
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Texto que se queda sin publicar.')
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await page.getByTestId('tray-control').waitFor()
  const closed = page.waitForEvent('close')
  await page.close({ runBeforeUnload: false })
  await closed
  const reader = await context.newPage()

  // What the Editor reads.
  let summary
  for (let i = 0; i < 40; i++) {
    summary = await (await reader.request.get(`${origin}/api/telemetry/ui-summary`)).json()
    if (summary.tasks?.send_publish?.abandoned >= 1) break
    await reader.waitForTimeout(150)
  }
  await context.close()
  return { summary, bodies }
}

function check({ summary, bodies }, label) {
  const sp = summary.tasks.send_publish
  assert.ok(sp, `${label}: no send_publish task in the summary: ${JSON.stringify(summary.tasks)}`)
  assert.equal(sp.completed, 1, `${label}: one send was published: ${JSON.stringify(summary.tasks)} errors ${JSON.stringify(summary.errors)}`)
  assert.equal(sp.abandoned, 1, `${label}: one send was left unpublished`)
  assert.ok(sp.clicks.p50 >= 2, `${label}: sending and publishing take at least two clicks, and the summary says ${sp.clicks.p50}`)
  for (const stage of ['feedback', 'analysis', 'publish']) assert.ok(sp.stages_ms[stage].n >= 1 && sp.stages_ms[stage].p50 >= 0, `${label}: stage ${stage}: ${JSON.stringify(sp.stages_ms)}`)
  assert.equal(summary.tasks.reply?.completed, 1, `${label}: one reply`)
  assert.equal(summary.tasks.close?.completed, 1, `${label}: one close`)
  for (const screen of ['home', 'messages', 'settings', 'message-detail']) assert.ok(summary.screens[screen]?.visits >= 1, `${label}: ${screen} was visited`)
  assert.ok(summary.input.pointer_presses > 0 && summary.input.key_presses > 0, `${label}: pointer and keyboard are told apart`)
  assert.ok(summary.viewports.find((v) => v.width === '1280-1535').visits >= 1, `${label}: the 1440 px window is classified`)
  assert.ok(summary.worst_journeys.length >= 3, `${label}: the worst journeys are listed`)
  // Nothing a person wrote is in what was sent nor in what the Editor reads back.
  const everything = JSON.stringify(summary) + bodies.join('\n')
  for (const forbidden of [SENTINEL, REPLY_SENTINEL, 'Segundo punto', 'sin publicar', '@dev.invalid', '@humo.test', 'Ana', '.pdf']) {
    assert.ok(!everything.includes(forbidden), `${label}: the telemetry holds «${forbidden}»`)
  }
  assert.ok(bodies.length > 0, `${label}: the page sent its events`)
  console.log(`${label}: ${bodies.length} batches; send_publish p50 ${sp.duration_ms.p50} ms, ${sp.clicks.p50} clicks; stages ${JSON.stringify(Object.fromEntries(Object.entries(sp.stages_ms).map(([k, v]) => [k, v.p50])))}`)
}

describe('interface telemetry in a browser', () => {
  test('against the double server', async () => {
    const panel = await startPanel(Number(process.env.PANEL_TELEMETRY_PORT ?? 8975), { stepMs: 80 })
    cleanups.push(() => panel.stop())
    const result = await scenario({ origin: panel.origin, browser: panel.browser, signIn: (page) => login(page, panel.origin, 'ana'), pick: (items) => items.find((m) => m.title.startsWith('Probar un resumen semanal')) ?? items[0] })
    check(result, 'double server')
  })

  test('against the real server', async () => {
    const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-telemetry-'))
    const password = 'una clave larga de prueba 1'
    const root = path.resolve(ROOT, '..')
    const env = { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', PROJECT_NAME: 'Humo', ADMIN_EMAIL: 'ana@humo.test', ADMIN_PASSWORD: password,
      ANALYZE_MODULE: path.join(root, 'src/testing/demo-modules.js'), EXTRACT_MODULE: path.join(root, 'src/testing/demo-modules.js') }
    const server = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const listening = new Promise((resolve, reject) => {
      const on = (d) => {
        out += d
        const m = /API listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
        if (m) resolve(m[1])
      }
      server.stdout.on('data', on)
      server.stderr.on('data', on)
      server.once('exit', (code) => reject(new Error(`the server exited with ${code} before listening:\n${out}`)))
    })
    cleanups.push(async () => {
      server.kill('SIGTERM')
      await new Promise((r) => server.once('close', r))
      rmSync(dir, { recursive: true, force: true })
    })
    const port = await listening
    const origin = `http://127.0.0.1:${port}`
    const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
    cleanups.push(() => browser.close())
    const signIn = async (page) => {
      await page.goto(origin)
      await page.getByLabel('Correo').fill('ana@humo.test')
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('link', { name: /^Inicio$/ }).first().waitFor()
    }
    const replier = async (context) => {
      const created = await fetch(`${origin}/api/members`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: await cookieOf(context), 'x-team-request': 'panel' }, body: JSON.stringify({ email: 'beto@humo.test', name: 'Beto', password }) })
      assert.ok(created.ok, `creating the second member: ${created.status} ${await created.text()}`)
      const second = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
      const p = await second.newPage()
      await p.goto(origin)
      await p.getByLabel('Correo').fill('beto@humo.test')
      await p.getByLabel('Contraseña').fill(password)
      await p.getByRole('button', { name: 'Entrar' }).click()
      await p.getByRole('link', { name: /^Inicio$/ }).first().waitFor()
      return p
    }
    check(await scenario({ origin, browser, signIn, pick: (items) => items[0], replier }), 'real server')
  })
})
