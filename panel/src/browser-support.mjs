// Shared by the browser tests (fits-one-screen, flows): starts the dev server on panel/dist and logs in.
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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
    /** An agent member with a worked message (its timing) and one running now (UD-262). Returns { done_id, live_id }. With `deliver`, the one running now is in its delivery (UD-263). */
    execution: ({ deliver = false } = {}) => order(`execution${deliver ? '?deliver=1' : ''}`),
  }
}

/**
 * The engine the suites run on: `BROWSER=firefox` or `BROWSER=webkit`; Chromium by default (TASK-019). Only Chromium takes the
 * Ozone flag that lets it start without a display.
 */
export const ENGINE = process.env.BROWSER ?? 'chromium'
export function launchBrowser() {
  if (!playwright[ENGINE]?.launch) throw new Error(`BROWSER=${ENGINE} no es un motor de Playwright (chromium, firefox o webkit)`)
  return playwright[ENGINE].launch({ headless: true, ...(ENGINE === 'chromium' ? { args: ['--ozone-platform=headless'] } : {}) })
}

/**
 * Builds panel/dist (unless told not to) and serves it with the dev server; returns what a test needs and how to stop it.
 * `base` mounts the panel and its API under a path (H-3721): `origin` then ends with that path (no trailing slash), so
 * `${origin}/api/…` and `page.goto(origin)` keep working; `host` is the bare origin.
 */
export async function startPanel(port, { build = !process.env.FIT_SIN_BUILD, stepMs = 120, base = '/' } = {}) {
  if (build) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' })
  const server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PANEL_DEV_PORT: String(port), PANEL_DEV_STATIC: '1', PANEL_DEV_STEP_MS: String(stepMs), PANEL_DEV_CONTROL: '1', PANEL_DEV_EXIT_WITH_PARENT: '1', PANEL_DEV_BASE: base },
    // The pipe on stdin is what ties the server to this process: it closes when this process ends, and the server leaves with it.
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  // The server says when it listens; a port already taken makes it exit. Neither is guessed with a pause: a test never talks to a server that is not its own (H-900).
  await new Promise((resolve, reject) => {
    let said = ''
    server.stdout.on('data', (chunk) => {
      said += chunk
      if (said.includes('[dev-server] DEVELOPMENT DOUBLE SERVER')) resolve()
    })
    server.once('exit', (code) => reject(new Error(`el servidor de ejemplo salió con ${code} antes de escuchar en el puerto ${port}; ¿está ocupado?`)))
    server.once('error', reject)
  })
  const browser = await launchBrowser()
  const host = `http://127.0.0.1:${port}`
  const origin = `${host}${base.replace(/\/+$/, '')}`
  return {
    origin,
    host,
    browser,
    control: controlOf(origin),
    async stop() {
      await browser.close()
      server.kill()
    },
  }
}

/** Logs in as one of the dev members (ana is the Editor). */
export async function login(page, origin, who = 'ana') {
  // The requests are watched from the first navigation, so that what the shell asks for while it opens is known when it is open.
  const requests = watchRequests(page)
  try {
    await page.goto(origin)
    await page.getByLabel('Correo').fill(`${who}@dev.invalid`)
    await page.getByLabel('Contraseña').fill(PASSWORD)
    await page.getByRole('button', { name: 'Entrar' }).click()
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

/** Opens the «Plantillas» section of the view of an area (UD-041); since UD-252 it is born open, and then nothing is clicked. */
export async function openTemplates(page) {
  const fold = page.getByRole('button', { name: /^Plantillas/ })
  await fold.waitFor()
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
}
