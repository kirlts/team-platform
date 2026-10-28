// Shared by the browser tests (fits-one-screen, flows): starts the dev server on panel/dist and logs in.
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as playwright from 'playwright'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PASSWORD = randomBytes(12).toString('hex') // the dev server accepts any password of 15 characters or more

/**
 * Orders to the example server (H-901). A test that needs «a send being analyzed» does not race the server's clock: it holds the
 * analysis (`hold`), looks at the state it wanted, and moves it by itself (`step`) or lets it run (`release`). `reset` puts the sample
 * data back as it was born, so one test never inherits what another one left.
 */
function controlOf(origin) {
  const order = async (path) => {
    const res = await fetch(`${origin}/api/_control/${path}`, { method: 'POST' })
    if (!res.ok) throw new Error(`el servidor de ejemplo rechazó la orden ${path}: ${res.status}`)
    return res.json().catch(() => ({}))
  }
  return {
    hold: () => order('hold'),
    release: () => order('release'),
    /** One step of every waiting analysis; with `inputId`, only that send, and with `finish` all the way to its proposal. */
    step: ({ inputId, finish = false } = {}) => order(`step?${new URLSearchParams({ ...(inputId ? { input_id: inputId } : {}), ...(finish ? { finish: '1' } : {}) })}`),
    reset: () => order('reset'),
    /** One message per state of the work of an agent in the sheet (B7). Returns { queued, machine, session, delivering, failed_session, failed_delivery }, the ids; `steps` is how many calls the history of `session` has. */
    agentWork: ({ steps } = {}) => order(`agent-work${steps ? `?steps=${steps}` : ''}`),
    /** An agent member with a worked message (its timing) and one running now (UD-262). Returns { done_id, live_id }. With `deliver`, the one running now is in its delivery (UD-263). */
    /** UD-275: a message whose delivery is held for review. Returns { message_id }. */
    review: () => order('review'),
    execution: ({ deliver = false } = {}) => order(`execution${deliver ? '?deliver=1' : ''}`),
  }
}

/**
 * The engine the suites run on: `BROWSER=firefox` or `BROWSER=webkit`; Chromium by default (TASK-019). Only Chromium takes the
 * Ozone flag that lets it start without a display.
 */
export const ENGINE = process.env.BROWSER ?? 'chromium'
/**
 * The browser of this Playwright version has to be on the disk, and a run that lacks it fails at once saying which one (2026-10-25: on the deploy
 * server the image carried the browser of another Playwright version, `launch` failed after the example server was already running, the server
 * kept the test process alive and the run hung 20 minutes with the machine idle).
 */
export function assertBrowserInstalled() {
  if (!playwright[ENGINE]?.launch) throw new Error(`BROWSER=${ENGINE} no es un motor de Playwright (chromium, firefox o webkit)`)
  const executable = playwright[ENGINE].executablePath()
  if (!executable || !existsSync(executable)) {
    throw new Error(`falta el navegador ${ENGINE} de Playwright ${playwrightVersion()}: no existe ${executable}. Se instala con «npx playwright install ${ENGINE}» (y sus dependencias del sistema con «npx playwright install-deps ${ENGINE}»)`)
  }
}
function playwrightVersion() {
  try { return execFileSync('node', ['-p', "require('playwright/package.json').version"], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '(versión desconocida)' }
}
/** Playwright's own default limit for `launch` (30 s, its documentation). Measured 2026-10-25: 33-47 ms in 5 runs on the notebook, so a launch that takes this long is stuck. */
export const LAUNCH_TIMEOUT_MS = 30_000
/** Same budget as the launch, declared as a courtesy cut-off and not as a measurement: the server printed its line in 142-167 ms in 5 runs (2026-10-25). */
export const SERVER_START_TIMEOUT_MS = 30_000
/** Courtesy cut-off (not a measurement): `vite build` took 2.5-4 s in 3 runs with the machine at load 26 (2026-10-25). */
export const BUILD_TIMEOUT_MS = 120_000
export function launchBrowser() {
  assertBrowserInstalled()
  return playwright[ENGINE].launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS, ...(ENGINE === 'chromium' ? { args: ['--ozone-platform=headless'] } : {}) })
}

/**
 * Builds the panel and serves it with the dev server; returns what a test needs and how to stop it. The build goes to a folder of this
 * process alone: `vite build` empties its output folder, so two tests building into panel/dist at the same time (they run in parallel)
 * deleted each other's index.html while the other was serving it. With `build: false` (or FIT_SIN_BUILD) the server reads the panel/dist
 * somebody built once before the tests, and nothing here writes to it; if there is none, it builds one of its own.
 * `base` mounts the panel and its API under a path (H-3721): `origin` then ends with that path (no trailing slash), so
 * `${origin}/api/…` and `page.goto(origin)` keep working; `host` is the bare origin.
 */
export async function startPanel(requestedPort, { build = !process.env.FIT_SIN_BUILD, stepMs = 120, base = '/', fixedPort = process.env.PANEL_FIXED_PORTS === '1' } = {}) {
  // Before the build and before any child process: a missing browser is known at once and nothing is left running.
  assertBrowserInstalled()
  // The port is the system's choice (0) unless the caller or PANEL_FIXED_PORTS=1 asks for that exact one: files that run in parallel used to
  // share a few hard-coded numbers (8742, 8806, 8967) and one of the two servers left. The port that came out is read from the server's own line.
  const port = fixedPort ? requestedPort : 0
  // The build that the runner made once (PANEL_DEV_DIST) or panel/dist is served as it is. Without either (a test run alone, outside the runner), it builds its own instead of serving nothing.
  const shared = process.env.PANEL_DEV_DIST && existsSync(join(process.env.PANEL_DEV_DIST, 'index.html'))
  const dist = !shared && (build || !existsSync(join(ROOT, 'dist', 'index.html'))) ? mkdtempSync(join(tmpdir(), 'panel-dist-')) : null
  const dropDist = () => dist && rmSync(dist, { recursive: true, force: true })
  if (dist) {
    try {
      execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'ignore', timeout: BUILD_TIMEOUT_MS })
    } catch (error) {
      dropDist()
      throw error
    }
  }
  const server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...(dist ? { PANEL_DEV_DIST: dist } : {}), PANEL_DEV_PORT: String(port), PANEL_DEV_STATIC: '1', PANEL_DEV_STEP_MS: String(stepMs), PANEL_DEV_CONTROL: '1', PANEL_DEV_EXIT_WITH_PARENT: '1', PANEL_DEV_BASE: base },
    // The pipe on stdin is what ties the server to this process: it closes when this process ends, and the server leaves with it.
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  // The server says when it listens; a port already taken makes it exit. Neither is guessed with a pause: a test never talks to a server that is not its own (H-900).
  // Whatever fails from here on takes the server down with it: the open handle of the child keeps this process alive, and a test runner whose
  // `before` threw then waits for it for ever (the hang of 2026-10-25).
  let browser
  let listening
  try {
    listening = await new Promise((resolve, reject) => {
      let said = ''
      // wall-clock-ok: the courtesy cut-off of a start that never comes (SERVER_START_TIMEOUT_MS), not a wait: the success path is the server's own line.
      const timer = setTimeout(() => reject(new Error(`el servidor de ejemplo no escuchó en el puerto ${port} en ${SERVER_START_TIMEOUT_MS} ms`)), SERVER_START_TIMEOUT_MS)
      server.stdout.on('data', (chunk) => {
        said += chunk
        const line = said.match(/\[dev-server\] DEVELOPMENT DOUBLE SERVER with sample data at http:\/\/127\.0\.0\.1:(\d+)/)
        if (line) { clearTimeout(timer); resolve(Number(line[1])) }
      })
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`el servidor de ejemplo salió con ${code} antes de escuchar en el puerto ${port}; ¿está ocupado?`)) })
      server.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    browser = await launchBrowser()
  } catch (error) {
    await browser?.close().catch(() => {})
    server.kill()
    dropDist()
    throw error
  }
  const host = `http://127.0.0.1:${listening}`
  const origin = `${host}${base.replace(/\/+$/, '')}`
  return {
    origin,
    host,
    browser,
    control: controlOf(origin),
    async stop() {
      await browser.close()
      server.kill()
      dropDist()
    },
  }
}

/**
 * Logs in as one of the dev members (ana is the Editor). The session is opened by the API of the context (the cookie goes in the jar the page
 * uses), so the page loads once, already inside, instead of loading the sign-in page, filling its form and loading the shell after it:
 * measured 2026-10-25: the CPU of the whole browser suite went from 247 s to 201 s. `{ form: true }` goes through the sign-in form, for the
 * tests whose subject is the form (login-support, the entry page).
 */
export async function login(page, origin, who = 'ana', { form = false } = {}) {
  // The requests are watched from the first navigation, so that what the shell asks for while it opens is known when it is open.
  const requests = watchRequests(page)
  try {
    if (form) {
      await page.goto(origin)
      await page.getByLabel('Correo').fill(`${who}@dev.invalid`)
      await page.getByLabel('Contraseña').fill(PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
    } else {
      const res = await page.context().request.post(`${origin}/api/auth/login`, { data: { email: `${who}@dev.invalid`, password: PASSWORD }, headers: { 'x-team-request': 'panel' } })
      if (!res.ok()) throw new Error(`login de ${who}: ${res.status()}`)
      await page.goto(origin)
    }
    // The sign-in page is also a <main>: waiting for any <main> returned while the person was still signing in (H-901). Only the signed-in shell has #main.
    await page.locator('main#main').waitFor()
    // Firefox never fires `load` for a page opened over a document of the same address that still has a video thumbnail loading (measured: 9 of 10
    // navigations), and `page.goto` waits for it. Nothing is in flight when the shell has finished asking, so the next navigation starts from a quiet page.
    if (ENGINE === 'firefox') {
      await requests.idle()
      // A video thumbnail has its first frame once it has data for it; until then it still holds the page.
      await page.evaluate(() =>
        Promise.all([...document.querySelectorAll('video')].map((v) => (v.readyState >= 2 || v.error ? undefined : new Promise((resolve) => { v.addEventListener('loadeddata', resolve, { once: true }); v.addEventListener('error', resolve, { once: true }) })))),
      )
    }
  } finally {
    requests.stop()
  }
}

/**
 * Waits for the page to be quiet, by what it does and not by a guessed pause (H-901): fonts loaded, every finite animation and
 * transition finished, and two frames drawn after that, so the layout and the effects the last change set off have run.
 * Infinite animations (the background) never finish and do not count.
 */
export async function settled(page) {
  await page.evaluate(async () => {
    const running = () => document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity && a.playState === 'running')
    await document.fonts.ready
    for (;;) {
      await Promise.allSettled(running().map((a) => a.finished))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (running().length === 0) return
    }
  })
}

/**
 * Counts the requests of a page that are still in flight, leaving out the event stream: it is an open request by design (live updates), and
 * Firefox counts it as in flight while Chromium does not, so `waitForLoadState('networkidle')` never returns in Firefox (TASK-019).
 * Start it before navigating; `idle()` returns once nothing else has been in flight for `quietMs` (the same 500 ms that `networkidle` uses).
 */
export function watchRequests(page, { quietMs = 500 } = {}) {
  const inFlight = new Set()
  let lastChange = Date.now()
  const isStream = (r) => r.resourceType() === 'eventsource' || new URL(r.url()).pathname.endsWith('/api/events')
  const start = (r) => {
    if (isStream(r)) return
    inFlight.add(r)
    lastChange = Date.now()
  }
  const end = (r) => {
    if (inFlight.delete(r)) lastChange = Date.now()
  }
  // The document being left cancels what it had in flight without any event (measured: an image or a video of the previous page stayed «in flight» for good
  // in 5 of 8 loads), so the count starts again at each navigation, as Playwright's own `networkidle` does.
  const navigated = (frame) => {
    if (frame !== page.mainFrame()) return
    inFlight.clear()
    lastChange = Date.now()
  }
  page.on('framenavigated', navigated)
  page.on('request', start)
  page.on('requestfinished', end)
  page.on('requestfailed', end)
  return {
    /** Frames are the clock of the wait, so a slow machine waits longer instead of giving up on a guess. */
    async idle({ timeout = 30000 } = {}) {
      const deadline = Date.now() + timeout
      // wall-clock-ok: the quiet period that Playwright's own `networkidle` defines (500 ms without a request), used only by the Firefox login.
      while (inFlight.size > 0 || Date.now() - lastChange < quietMs) {
        if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded with ${inFlight.size} requests in flight: ${[...inFlight].map((r) => r.url().replace(/^https?:\/\/[^/]+/, '')).slice(0, 6).join(', ')}`)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      }
    },
    stop() {
      page.off('framenavigated', navigated)
      page.off('request', start)
      page.off('requestfinished', end)
      page.off('requestfailed', end)
    },
  }
}

/** Opens the folded boxes of Configuración (Proveedores y claves, Datos, Cola, Auditoría): their content is drawn, and read from the server, once they are open. */
export async function openFolds(page) {
  await page.locator('main [data-data-reset]').first().waitFor() // the boxes are drawn when the view is; «Datos» is for every member
  const closed = page.locator('main :is([data-providers], [data-data-reset], [data-audit], [data-queue-box]) h2 button[aria-expanded="false"]')
  while ((await closed.count()) > 0) await closed.first().click()
}

/** Opens the window of a template from the view of an area (UD-297): the name of its row, the first one or the one called `name`. */
export async function openTemplate(page, name) {
  const open = name ? page.getByRole('button', { name: `Abrir ${name}`, exact: true }) : page.getByTestId('template-open').first()
  await open.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

/** Opens the «Plantillas» section of the view of an area (UD-041); since UD-252 it is born open, and then nothing is clicked. */
export async function openTemplates(page) {
  const fold = page.getByRole('button', { name: /^Plantillas/ })
  await fold.waitFor()
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
}

/**
 * The built panel for a test that serves it with the real server (PANEL_DIR): the build of the runner (PANEL_DEV_DIST), else panel/dist when
 * it exists, else one built here into a folder of its own, which `drop()` removes. A worktree has no panel/dist, so a file run alone served a blank page.
 */
export function builtPanelDir() {
  const shared = process.env.PANEL_DEV_DIST
  if (shared && existsSync(join(shared, 'index.html'))) return { dir: shared, drop: () => {} }
  if (existsSync(join(ROOT, 'dist', 'index.html'))) return { dir: join(ROOT, 'dist'), drop: () => {} }
  const dir = mkdtempSync(join(tmpdir(), 'panel-dist-'))
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'ignore', timeout: BUILD_TIMEOUT_MS })
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  return { dir, drop: () => rmSync(dir, { recursive: true, force: true }) }
}
