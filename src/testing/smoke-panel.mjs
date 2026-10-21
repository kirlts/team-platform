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

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(path.join(raiz, 'panel/node_modules/playwright/index.mjs'))
const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-smoke-'))
const CLAVE = 'una clave larga de prueba 1'
const env = { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', PROJECT_NAME: 'Humo', ADMIN_EMAIL: 'ana@humo.test', ADMIN_PASSWORD: CLAVE,
  ANALYZE_MODULE: path.join(raiz, 'src/testing/demo-modules.js'), EXTRACT_MODULE: path.join(raiz, 'src/testing/demo-modules.js') }

const servidor = spawn(process.execPath, ['src/server.js'], { cwd: raiz, env, stdio: ['ignore', 'pipe', 'pipe'] })
let salida = ''
servidor.stdout.on('data', (d) => { salida += d })
servidor.stderr.on('data', (d) => { salida += d })
const problemas = []
let navegador
try {
  for (let i = 0; i < 200 && !/API escuchando/.test(salida); i++) await new Promise((r) => setTimeout(r, 50))
  const puerto = /API escuchando en http:\/\/127\.0\.0\.1:(\d+)/.exec(salida)?.[1]
  if (!puerto) throw new Error(`el servidor no arrancó:\n${salida}`)
  const ORIGEN = `http://127.0.0.1:${puerto}`

  // Un segundo miembro para ver que el equipo lo recibe.
  const entrada = await fetch(`${ORIGEN}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@humo.test', password: CLAVE }) })
  const cookie = entrada.headers.getSetCookie()[0].split(';')[0]
  await fetch(`${ORIGEN}/api/members`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-team-request': 'panel' }, body: JSON.stringify({ email: 'beto@humo.test', name: 'Beto', password: CLAVE }) })

  navegador = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  const page = await contexto.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) problemas.push(`consola: ${m.text()}`) })
  page.on('pageerror', (e) => problemas.push(`excepción: ${e.message}`))
  page.on('request', (r) => { const u = new URL(r.url()); if (['http:', 'https:'].includes(u.protocol) && u.origin !== ORIGEN) problemas.push(`petición a otro origen: ${r.url()}`) })
  page.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/me'))) problemas.push(`respuesta ${r.status()}: ${r.request().method()} ${r.url()}`) })
  await page.addInitScript(() => window.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)))

  await page.goto(ORIGEN)
  await page.getByLabel('Correo').fill('ana@humo.test')
  await page.getByLabel('Contraseña').fill(CLAVE)
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
  let publicados = 0
  for (let i = 0; i < 100 && publicados === 0; i++) {
    publicados = (await (await fetch(`${ORIGEN}/api/messages`, { headers: { cookie } })).json()).total
    if (publicados === 0) await new Promise((r) => setTimeout(r, 100))
  }
  if (publicados !== 1) throw new Error(`se esperaba 1 mensaje publicado y hay ${publicados}`)
  await page.getByText('Sin mensajes', { exact: true }).first().waitFor({ state: 'hidden', timeout: 10000 })
  await page.getByRole('link', { name: 'Mensajes', exact: true }).first().click()
  await page.getByText('Mensaje de prueba').first().waitFor({ timeout: 10000 })
  console.log('mensaje publicado: visible en Últimos mensajes y en la vista Mensajes')

  // Las demás vistas del editor cargan sus datos sin respuestas de error.
  for (const vista of ['Equipo', 'Configuración']) {
    await page.getByRole('link', { name: vista, exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    console.log(`vista ${vista}: carga sin errores`)
  }
  await page.locator('nav').getByText('Idea', { exact: true }).first().click() // Áreas > una plantilla
  await page.waitForLoadState('networkidle')
  console.log('vista de un área: carga sin errores')
  await page.screenshot({ path: path.join(process.env.TMPDIR ?? tmpdir(), 'smoke-panel.png') })
} catch (error) {
  problemas.push(`fallo del recorrido: ${error.message}`)
} finally {
  await navegador?.close()
  servidor.kill('SIGTERM')
  await new Promise((r) => servidor.on('close', r))
  rmSync(dir, { recursive: true, force: true })
}
if (problemas.length > 0) {
  console.error(problemas.join('\n'))
  console.error('--- registro del servidor ---\n' + salida.split('\n').slice(-12).join('\n'))
  process.exit(1)
}
console.log('humo del panel: sin errores de consola, CSP ni respuestas inesperadas')
