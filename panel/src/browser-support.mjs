// Shared by the browser tests (fits-one-screen, flows): starts the dev server on panel/dist and logs in.
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

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
  }
  return {
    hold: () => order('hold'),
    release: () => order('release'),
    /** One step of every waiting analysis; with `inputId`, only that send, and with `finish` all the way to its proposal. */
    step: ({ inputId, finish = false } = {}) => order(`step?${new URLSearchParams({ ...(inputId ? { input_id: inputId } : {}), ...(finish ? { finish: '1' } : {}) })}`),
    reset: () => order('reset'),
  }
}

/** Builds panel/dist (unless told not to) and serves it with the dev server; returns what a test needs and how to stop it. */
export async function startPanel(port, { build = !process.env.FIT_SIN_BUILD, stepMs = 120 } = {}) {
  if (build) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' })
  const server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PANEL_DEV_PORT: String(port), PANEL_DEV_STATIC: '1', PANEL_DEV_STEP_MS: String(stepMs), PANEL_DEV_CONTROL: '1', PANEL_DEV_EXIT_WITH_PARENT: '1' },
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
  const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
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
  await page.goto(origin)
  await page.getByLabel('Correo').fill(`${who}@dev.invalid`)
  await page.getByLabel('Contraseña').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  // The sign-in page is also a <main>: waiting for any <main> returned while the person was still signing in (H-901). Only the signed-in shell has #main.
  await page.locator('main#main').waitFor()
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

/** Opens the folded «Plantillas» section of the view of an area (UD-041). */
export async function openTemplates(page) {
  await page.getByRole('button', { name: /^Plantillas/, expanded: false }).click()
}
