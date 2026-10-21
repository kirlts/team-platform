// Shared by the browser tests (fits-one-screen, flows): starts the dev server on panel/dist and logs in.
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PASSWORD = randomBytes(12).toString('hex') // the dev server accepts any password of 15 characters or more

/** Builds panel/dist (unless told not to) and serves it with the dev server; returns what a test needs and how to stop it. */
export async function startPanel(port, { build = !process.env.FIT_SIN_BUILD, stepMs = 120 } = {}) {
  if (build) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' })
  const server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PANEL_DEV_PORT: String(port), PANEL_DEV_STATIC: '1', PANEL_DEV_STEP_MS: String(stepMs) },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  await new Promise((r) => setTimeout(r, 900))
  const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  return {
    origin: `http://127.0.0.1:${port}`,
    browser,
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
  await page.getByRole('navigation', { name: 'Navegación' }).waitFor()
}
