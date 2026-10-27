// Layer 5 of the test strategy (docs/TEST.md, «Política de recorrido»; H-46, DT-008): the main flow of the panel, run
// in a real browser against the Docker image, with an attachment of every kind and fake providers chosen by an
// environment variable. It runs only when TEAM_PLATFORM_IMAGE names a built image (`npm run test:image` builds one
// and sets it), so `npm test` stays free of Docker.
//
// What it does, in two parts on the same instance. First the path of a new instance (publication «Al analizar», on by
// default since UD-070): signs in, writes a message with an image, an audio, a video, a PDF, a Word document and a text
// file, and finds the message in Mensajes once the analysis publishes it on its own, with no Enviar in between. Then the
// review path, which a new instance does not take: it sets publication «Tras revisar» in Configuración, sends again,
// waits for the proposal through the event stream, publishes it with Enviar and finds the second message. It fails on any
// console error, CSP violation, request to another origin or unexpected 4xx/5xx response.
//
//   (cd panel && npm ci) && TEAM_PLATFORM_IMAGE=team-platform:local node --test src/image-walkthrough.docker.test.js

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { makeAudio, makeDocx, makeImage, makePdf, makeVideo } from './extract/test/helpers.js'

const image = process.env.TEAM_PLATFORM_IMAGE
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = `team-platform-walkthrough-${process.pid}`
const PASSWORD = 'a long password for the walkthrough 1'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-walkthrough-'))

after(() => {
  if (image) try { docker('rm', '-f', name) } catch { /* it was never created */ }
  rmSync(dir, { recursive: true, force: true })
})

test('layer 5: the main flow of the panel on the image, with an attachment of every kind', { skip: image ? false : 'TEAM_PLATFORM_IMAGE is not set (npm run test:image)', timeout: 180_000 }, async () => {
  docker('run', '-d', '--name', name, '-p', '127.0.0.1::3000',
    '-e', 'ADMIN_EMAIL=ana@walkthrough.test', '-e', `ADMIN_PASSWORD=${PASSWORD}`, '-e', 'PROJECT_NAME=Recorrido',
    '-e', 'PROVIDERS_MODULE=./testing/walkthrough-providers-module.js', image)
  const port = docker('port', name, '3000/tcp').split('\n')[0].split(':').at(-1)
  const origin = `http://127.0.0.1:${port}`
  let status = 'starting'
  for (let i = 0; i < 90 && status === 'starting'; i++) {
    status = docker('inspect', '--format', '{{.State.Health.Status}}', name)
    if (status === 'starting') await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  assert.equal(status, 'healthy', docker('logs', name))

  const files = [
    { file: path.join(dir, 'captura.png'), type: 'image/png', make: (f) => makeImage(f) },
    { file: path.join(dir, 'nota.m4a'), type: 'audio/mp4', make: (f) => makeAudio(f, 3) },
    { file: path.join(dir, 'pantalla.mp4'), type: 'video/mp4', make: (f) => makeVideo(f, { screens: 2, secondsPerScreen: 2 }) },
    { file: path.join(dir, 'informe.pdf'), type: 'application/pdf', make: (f) => makePdf(f, 3) },
    { file: path.join(dir, 'minuta.docx'), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', make: (f) => makeDocx(f, 3) },
    { file: path.join(dir, 'apuntes.txt'), type: 'text/plain', make: (f) => writeFileSync(f, 'Apuntes de la reunión.\nEl botón de guardar no responde.\n') }
  ]
  for (const f of files) await f.make(f.file)

  const { chromium } = await import(path.join(rootDir, 'panel/node_modules/playwright/index.mjs'))
  const problems = []
  const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) problems.push(`console: ${m.text()}`) })
    page.on('pageerror', (e) => problems.push(`exception: ${e.message}`))
    page.on('request', (r) => { const u = new URL(r.url()); if (['http:', 'https:'].includes(u.protocol) && u.origin !== origin) problems.push(`request to another origin: ${r.url()}`) })
    page.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/me'))) problems.push(`response ${r.status()}: ${r.request().method()} ${r.url()}`) })
    await page.addInitScript(() => window.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)))

    await page.goto(origin)
    await page.getByLabel('Correo').fill('ana@walkthrough.test')
    await page.getByLabel('Contraseña').fill(PASSWORD)
    await page.getByRole('button', { name: 'Entrar' }).click()
    const compose = page.getByLabel('Nuevo mensaje', { exact: true }).last()
    await compose.waitFor({ timeout: 15_000 })
    await compose.fill('El botón de guardar no responde en la pantalla de ajustes. Adjunto todo lo que tengo.')
    await page.locator('input[type=file]:not([capture])').setInputFiles(files.map((f) => f.file))
    await page.getByRole('button', { name: 'Enviar', exact: true }).first().click()

    // New instance: publication is automatic (UD-070), so the analysis publishes the message and no proposal waits for Enviar.
    await page.getByRole('link', { name: 'Mensajes', exact: true }).first().click()
    await page.getByText('Walkthrough message').first().waitFor({ timeout: 90_000 })

    // Review path: the Editor sets publication by hand, the proposal waits as `proposed` and Enviar publishes it.
    await page.getByRole('link', { name: 'Configuración', exact: true }).first().click()
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings/publication') && r.request().method() === 'PATCH')
    await page.getByRole('radio', { name: 'Tras revisar' }).click()
    assert.equal((await saved).status(), 200)
    await page.getByRole('link', { name: 'Inicio', exact: true }).first().click()
    const second = page.getByLabel('Nuevo mensaje', { exact: true }).last()
    await second.waitFor({ timeout: 15_000 })
    await second.fill('La pantalla de equipo tarda en abrir. Segundo envío del recorrido, esta vez con revisión previa.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).first().click()
    const analysis = page.getByRole('region', { name: 'Análisis' })
    await analysis.getByRole('button', { name: 'Enviar' }).waitFor({ timeout: 90_000 })
    await analysis.getByRole('button', { name: 'Enviar' }).click()
    await page.getByRole('link', { name: 'Mensajes', exact: true }).first().click()
    await page.getByText('Walkthrough message').nth(1).waitFor({ timeout: 15_000 })

    for (const view of ['Equipo', 'Configuración']) {
      await page.getByRole('link', { name: view, exact: true }).first().click()
      await page.waitForLoadState('networkidle')
    }
  } finally {
    await browser.close()
  }
  assert.deepEqual(problems, [], `${problems.join('\n')}\n--- container log ---\n${docker('logs', '--tail', '12', name)}`)
})
