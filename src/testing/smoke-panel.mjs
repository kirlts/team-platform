// Humo del panel compilado contra esta API: levanta el servidor real con el panel de panel/dist, entra por el
// formulario, envía un input con texto y una imagen, espera la propuesta por SSE, la publica y comprueba que el
// mensaje aparece en Mensajes. Falla si el navegador registra errores de consola, violaciones de la CSP,
// peticiones a otro origen o respuestas 4xx/5xx inesperadas.
//
//   (cd panel && npm ci && npm run build) && node src/testing/smoke-panel.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(path.join(rootDir, 'panel/node_modules/playwright/index.mjs'))
const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-smoke-'))
const TEST_PASSWORD = 'una clave larga de prueba 1'
const env = { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', PROJECT_NAME: 'Humo', ADMIN_EMAIL: 'ana@humo.test', ADMIN_PASSWORD: TEST_PASSWORD,
  ANALYZE_MODULE: path.join(rootDir, 'src/testing/demo-modules.js'), EXTRACT_MODULE: path.join(rootDir, 'src/testing/demo-modules.js') }

const serverProc = spawn(process.execPath, ['src/server.js'], { cwd: rootDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
let outText = ''
serverProc.stdout.on('data', (d) => { outText += d })
serverProc.stderr.on('data', (d) => { outText += d })
const problems = []
let browser
try {
  for (let i = 0; i < 200 && !/API escuchando/.test(outText); i++) await new Promise((r) => setTimeout(r, 50))
  const portNumber = /API escuchando en http:\/\/127\.0\.0\.1:(\d+)/.exec(outText)?.[1]
  if (!portNumber) throw new Error(`el servidor no arrancó:\n${outText}`)
  const ORIGIN_URL = `http://127.0.0.1:${portNumber}`

  // Un segundo miembro para ver que el equipo lo recibe.
  const loginResponse = await fetch(`${ORIGIN_URL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@humo.test', password: TEST_PASSWORD }) })
  const cookie = loginResponse.headers.getSetCookie()[0].split(';')[0]
  await fetch(`${ORIGIN_URL}/api/members`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-team-request': 'panel' }, body: JSON.stringify({ email: 'beto@humo.test', name: 'Beto', password: TEST_PASSWORD }) })

  browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) problems.push(`consola: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`excepción: ${e.message}`))
  page.on('request', (r) => { const u = new URL(r.url()); if (['http:', 'https:'].includes(u.protocol) && u.origin !== ORIGIN_URL) problems.push(`petición a otro origen: ${r.url()}`) })
  page.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/me'))) problems.push(`respuesta ${r.status()}: ${r.request().method()} ${r.url()}`) })
  await page.addInitScript(() => window.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)))

  await page.goto(ORIGIN_URL)
  await page.getByLabel('Correo').fill('ana@humo.test')
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByText('Humo', { exact: true }).first().waitFor({ timeout: 10000 }) // project_name de GET /me
  console.log('entró; el nombre del proyecto llegó desde GET /me')

  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('El botón de guardar no responde en la pantalla de ajustes.')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await page.locator('input[type=file]:not([capture])').setInputFiles([{ name: 'captura.png', mimeType: 'image/png', buffer: png }])
  await page.getByRole('button', { name: 'Enviar', exact: true }).first().click()
  console.log('input enviado; se espera la propuesta por SSE')
  await page.getByRole('region', { name: 'Análisis' }).getByRole('button', { name: 'Enviar' }).waitFor({ timeout: 20000 })
  console.log('propuesta lista')
  await page.getByRole('region', { name: 'Análisis' }).getByRole('button', { name: 'Enviar' }).click()
  // La publicación se comprueba contra la API y en pantalla: el mensaje sale de «Sin mensajes» a «Últimos mensajes».
  let publishedCount = 0
  for (let i = 0; i < 100 && publishedCount === 0; i++) {
    publishedCount = (await (await fetch(`${ORIGIN_URL}/api/messages`, { headers: { cookie } })).json()).total
    if (publishedCount === 0) await new Promise((r) => setTimeout(r, 100))
  }
  if (publishedCount !== 1) throw new Error(`se esperaba 1 mensaje publicado y hay ${publishedCount}`)
  await page.getByText('Sin mensajes', { exact: true }).first().waitFor({ state: 'hidden', timeout: 10000 })
  await page.getByRole('link', { name: 'Mensajes', exact: true }).first().click()
  await page.getByText('Mensaje de prueba').first().waitFor({ timeout: 10000 })
  console.log('mensaje publicado: visible en Últimos mensajes y en la vista Mensajes')

  // Las demás vistas del editor cargan sus datos sin respuestas de error.
  for (const view of ['Equipo', 'Configuración']) {
    await page.getByRole('link', { name: view, exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    console.log(`vista ${view}: carga sin errores`)
  }
  await page.locator('nav').getByText('Idea', { exact: true }).first().click() // Áreas > una plantilla
  await page.waitForLoadState('networkidle')
  console.log('vista de un área: carga sin errores')
  await page.screenshot({ path: path.join(process.env.TMPDIR ?? tmpdir(), 'smoke-panel.png') })
} catch (error) {
  problems.push(`fallo del recorrido: ${error.message}`)
} finally {
  await browser?.close()
  serverProc.kill('SIGTERM')
  await new Promise((r) => serverProc.on('close', r))
  rmSync(dir, { recursive: true, force: true })
}
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error('--- registro del servidor ---\n' + outText.split('\n').slice(-12).join('\n'))
  process.exit(1)
}
console.log('humo del panel: sin errores de consola, CSP ni respuestas inesperadas')
