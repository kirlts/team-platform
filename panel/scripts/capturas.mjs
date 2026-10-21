#!/usr/bin/env node
// Programmatic screenshots of the panel with headless Chromium (Playwright). Walks each view at
// 1440x900 and 390x844 against the built panel served by the development double server
// (with the same CSP the API would set) and leaves the PNGs in panel/capturas/.
//
//   npm run build && node scripts/capturas.mjs `[--solo desktop|mobile]`
//
// It also fails if the panel tries to connect to another origin, if the browser reports a
// CSP violation or if the console logs an error.

import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../capturas/', import.meta.url))
const PORT = Number(process.env.PANEL_CAPTURE_PORT ?? 8791)
const ORIGIN = `http://127.0.0.1:${PORT}`
const only = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' })
const server = spawn('node', ['dev-server.mjs'], {
  cwd: root,
  env: { ...process.env, PANEL_DEV_PORT: String(PORT), PANEL_DEV_STATIC: '1', PANEL_DEV_STEP_MS: '900' },
  stdio: ['ignore', 'inherit', 'inherit'],
})
await new Promise((r) => setTimeout(r, 800))

const password = randomBytes(12).toString('hex') // the double server accepts any password of 15 or more characters
const problems = []

function wav(seconds) {
  const rate = 8000
  const buf = Buffer.alloc(44 + rate * seconds, 128)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + rate * seconds, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(rate * seconds, 40)
  return buf
}

const svg = (label, hue) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="hsl(${hue} 30% 93%)"/><rect width="800" height="44" fill="hsl(${hue} 40% 32%)"/><rect x="28" y="80" width="220" height="380" fill="hsl(${hue} 25% 84%)"/><rect x="280" y="80" width="490" height="150" fill="hsl(${hue} 25% 88%)"/><rect x="280" y="260" width="230" height="200" fill="hsl(${hue} 25% 82%)"/><rect x="540" y="260" width="230" height="200" fill="hsl(${hue} 25% 90%)"/><text x="400" y="486" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#333">${label}</text></svg>`,
  )

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ozone-platform=headless'],
})

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, mobile: false },
  mobile: { viewport: { width: 390, height: 844 }, mobile: true },
}

async function newPage(name, who = 'ana', scheme = 'light') {
  const cfg = VIEWPORTS[name]
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.mobile ? 2 : 1,
    isMobile: cfg.mobile,
    hasTouch: cfg.mobile,
    colorScheme: scheme,
    locale: 'es-CL',
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) problems.push(`[${name}/${who}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`[${name}/${who}] exception: ${e.message}`))
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['http:', 'https:'].includes(u.protocol)) return
    if (u.origin !== ORIGIN) problems.push(`[${name}/${who}] request to another origin: ${r.url()}`)
  })
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`))
  })
  await page.goto(ORIGIN)
  return { page, context }
}

async function login(page, who) {
  await page.getByLabel('Correo').fill(`${who}@dev.invalid`)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByRole('navigation', { name: 'Navegación' }).or(page.getByRole('button', { name: 'Abrir navegación' })).first().waitFor()
}

let counter = 0
async function shot(page, vp, name, opts = {}) {
  await page.waitForTimeout(250)
  counter += 1
  const file = `${outDir}${String(counter).padStart(2, '0')}-${name}-${vp}.png`
  await page.screenshot({ path: file, fullPage: !!opts.full })
  console.log('screenshot', file.replace(root, ''))
}

async function run(vp) {
  counter = 0
  const mobile = VIEWPORTS[vp].mobile
  const { page, context } = await newPage(vp)

  await shot(page, vp, 'ingreso')
  await login(page, 'ana')

  // --- Empty home and bar with attachments
  await page.getByText('Desarrollo', { exact: true }).first().waitFor()
  await page.getByText('Para mí').first().waitFor()
  await shot(page, vp, 'inicio')

  const textarea = page.getByLabel('Nuevo mensaje', { exact: true }).last()
  await textarea.fill('Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo y gracias por el trabajo de la semana.')
  // Paste a screenshot the way the clipboard would.
  await page.evaluate(async (svgText) => {
    const file = new File([svgText], 'captura-pegada.svg', { type: 'image/svg+xml' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ta = document.querySelector('textarea[aria-label="Nuevo mensaje"]')
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, svg('Dashboard con sidebar (ejemplo de prueba)', 215).toString())
  await page.locator('input[type=file]:not([capture])').setInputFiles([
    { name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: wav(4) },
    { name: 'feedback.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('ejemplo') },
  ])
  await page.getByRole('button', { name: 'Adjuntar' }).click()
  await page.getByRole('menuitem', { name: 'Enlace' }).click()
  await page.getByLabel('Enlace', { exact: true }).fill('https://example.com/informe')
  await page.getByRole('button', { name: 'Agregar', exact: true }).click()
  await shot(page, vp, 'barra-con-adjuntos')

  // --- Submission and analysis in progress
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await page.getByRole('progressbar', { name: 'Progreso del análisis' }).waitFor()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Progreso del análisis"]')?.getAttribute('aria-valuenow')) >= 40)
  await shot(page, vp, 'analisis-progreso')

  // --- Editable proposal
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
  await shot(page, vp, 'propuesta')
  await shot(page, vp, 'propuesta-completa', { full: true })
  await page.getByRole('button', { name: /Título del mensaje:/ }).first().click()
  await page.getByLabel('Título del mensaje').first().fill('')
  await page.waitForTimeout(100)
  await shot(page, vp, 'propuesta-edicion-invalida')
  await page.getByLabel('Título del mensaje').first().fill('Corregir el desalineado del sidebar en el dashboard')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Agregar destinatario' }).first().click()
  await shot(page, vp, 'propuesta-destinatarios')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Área:/ }).nth(1).click()
  await shot(page, vp, 'propuesta-area-por-mensaje')
  await page.getByRole('menuitemradio', { name: 'Error' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Sin acción' }).click()
  await shot(page, vp, 'propuesta-sin-accion')

  // --- Publish
  await page.getByRole('button', { name: 'Enviar', exact: true }).last().click()
  await page.getByRole('progressbar').first().waitFor({ state: 'detached' }).catch(() => {})
  await page.getByRole('region', { name: 'Análisis' }).waitFor({ state: 'detached' })
  await page.getByRole('region', { name: 'Últimos mensajes' }).getByRole('radio', { name: 'Todos' }).click()
  await page.getByText('Corregir el desalineado del sidebar en el dashboard').first().waitFor()
  await shot(page, vp, 'inicio-publicado')

  // --- Audio recording (Chromium fake device)
  const mic = page.getByRole('button', { name: 'Grabar audio' })
  if (await mic.isEnabled()) {
    await mic.click()
    await page.getByRole('status', { name: 'Grabando audio' }).waitFor()
    await page.waitForTimeout(1500)
    await shot(page, vp, 'grabando')
    await page.getByRole('button', { name: 'Detener grabación' }).click()
    await page.getByRole('button', { name: /Quitar grabacion-/ }).waitFor()
    await shot(page, vp, 'grabacion-adjunta')
    const type = await page.evaluate(() => 'ok')
    void type
  } else {
    problems.push(`[${vp}] the microphone button stayed disabled in a secure context`)
  }

  // --- Messages
  await page.goto(`${ORIGIN}/messages`)
  await page.getByText('Revisar el tiempo de respuesta').waitFor()
  await shot(page, vp, 'mensajes')
  await page.getByRole('button', { name: 'Filtro' }).click()
  await shot(page, vp, 'mensajes-menu-filtro')
  await page.getByRole('menuitem', { name: 'Estado' }).click()
  await page.getByRole('menuitemradio', { name: 'Cerrado' }).waitFor()
  await shot(page, vp, 'mensajes-valor-filtro')
  await page.keyboard.press('Escape')
  await page.goto(`${ORIGIN}/messages?f=for:eq:me&f=status:neq:closed&q=sidebar`)
  await page.getByRole('list', { name: 'Filtros aplicados' }).waitFor()
  await shot(page, vp, 'mensajes-filtrados')
  await page.goto(`${ORIGIN}/messages?f=replies:eq:con&f=area:neq:a-error`)
  await page.getByRole('list', { name: 'Filtros aplicados' }).waitFor()
  await shot(page, vp, 'mensajes-con-respuestas')

  // --- Detail of someone else's message, with form; and of one's own, without form
  await page.goto(`${ORIGIN}/messages`)
  await page.getByRole('link', { name: 'Agregar exportación de mensajes cerrados' }).click()
  await page.getByRole('heading', { name: 'Respuestas' }).waitFor()
  await page.getByLabel('Respuesta', { exact: true }).fill('Lo reviso hoy y respondo con una estimación.')
  await shot(page, vp, 'detalle-con-formulario')
  await page.getByRole('button', { name: 'Responder', exact: true }).click()
  await page.getByText('Lo reviso hoy y respondo con una estimación.').first().waitFor()
  await shot(page, vp, 'detalle-respondido')
  await page.goto(`${ORIGIN}/messages`)
  await page.getByRole('link', { name: 'Revisar el tiempo de respuesta de la lista de mensajes' }).click()
  await page.getByRole('heading', { name: 'Respuestas' }).waitFor()
  if ((await page.getByLabel('Respuesta', { exact: true }).count()) > 0) problems.push(`[${vp}] the sender sees the reply form`)
  await shot(page, vp, 'detalle-del-emisor')
  await page.goto(`${ORIGIN}/messages`)
  await page.getByRole('link', { name: 'Corregir el contraste del botón Enviar en el inicio' }).click()
  await page.getByRole('heading', { name: 'Respuestas' }).waitFor()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.getByRole('button', { name: 'Reabrir', exact: true }).waitFor()
  await shot(page, vp, 'detalle-cerrado')
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click()

  // --- Reply from the card
  await page.goto(`${ORIGIN}/messages?f=status:eq:open`)
  await page.getByRole('button', { name: 'Responder' }).first().click()
  await shot(page, vp, 'tarjeta-respondiendo')

  // --- Areas (Editor)
  await page.goto(`${ORIGIN}/areas`)
  await page.getByRole('heading', { name: 'Áreas', level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Desplegar Error' }).click()
  await page.getByText('Reporte de error').first().waitFor()
  await shot(page, vp, 'areas')
  await page.getByRole('button', { name: 'Ver el contenido de Reporte de error' }).click()
  await shot(page, vp, 'areas-plantilla-contenido')
  await page.getByRole('button', { name: /Descripción del área: Algo que antes/ }).click()
  await shot(page, vp, 'areas-edicion-en-el-lugar')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Plantilla', exact: true }).click()
  await page.getByRole('button', { name: 'Crear' }).click()
  await shot(page, vp, 'areas-nueva-plantilla-error')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Eliminar Error visual' }).click()
  await shot(page, vp, 'areas-eliminar-plantilla')
  await page.keyboard.press('Escape')

  // --- Team and settings
  await page.goto(`${ORIGIN}/team`)
  await page.getByText('Bruno Prueba').waitFor()
  await shot(page, vp, 'equipo')
  await page.getByRole('button', { name: /Agregar a dominios de ana prueba/i }).click()
  await page.getByLabel('Dominios de Ana Prueba').fill('Seguridad')
  await page.keyboard.press('Enter')
  await page.getByText('Seguridad').waitFor()
  await shot(page, vp, 'equipo-dominio-agregado')
  await page.goto(`${ORIGIN}/settings`)
  await page.getByRole('heading', { name: 'Proveedores' }).waitFor()
  await shot(page, vp, 'configuracion')

  // --- Notices over SSE (the bell)
  await page.goto(ORIGIN)
  await page.getByText('Para mí').first().waitFor()
  await page.waitForTimeout(1500)
  await page.evaluate(() => fetch('/api/_dev/incoming', { method: 'POST', headers: { 'X-Team-Request': 'panel' }, credentials: 'include' }))
  await page.getByRole('button', { name: /Avisos, \d+ sin leer/ }).waitFor()
  await shot(page, vp, 'inicio-aviso-nuevo')
  await page.getByRole('button', { name: /Avisos/ }).click()
  await shot(page, vp, 'avisos')
  await page.keyboard.press('Escape')

  // --- Account menu and dark theme
  await page.getByRole('button', { name: 'Menú' }).click()
  await shot(page, vp, 'menu-cuenta')
  await page.getByRole('menuitemradio', { name: 'Oscuro' }).click()
  await page.waitForTimeout(200)
  await shot(page, vp, 'inicio-oscuro')
  await page.goto(`${ORIGIN}/messages`)
  await page.getByText('Revisar el tiempo de respuesta').waitFor()
  await shot(page, vp, 'mensajes-oscuro')
  await page.goto(`${ORIGIN}/areas/a-error`)
  await page.getByText('Reporte de error').first().waitFor()
  await shot(page, vp, 'areas-oscuro')

  if (mobile) {
    await page.goto(ORIGIN)
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await shot(page, vp, 'navegacion')
  } else {
    await page.getByText('Conexiones').hover()
    await page.getByRole('tooltip').waitFor()
    await shot(page, vp, 'conexiones-apagada')
  }
  await context.close()

  // --- A Member: without Areas, counts or providers
  const member = await newPage(vp, 'bruno')
  await login(member.page, 'bruno')
  await member.page.getByText('Para mí').first().waitFor()
  await shot(member.page, vp, 'miembro-inicio')
  await member.page.goto(`${ORIGIN}/settings`)
  await member.page.getByRole('heading', { name: 'Tema' }).waitFor()
  if ((await member.page.getByRole('heading', { name: 'Proveedores' }).count()) > 0) problems.push(`[${vp}] a Member sees Proveedores`)
  await shot(member.page, vp, 'miembro-configuracion')
  await member.page.goto(`${ORIGIN}/areas`)
  await member.page.waitForURL(`${ORIGIN}/`)
  await member.page.goto(`${ORIGIN}/team`)
  await member.page.getByText('Ana Prueba').waitFor()
  await shot(member.page, vp, 'miembro-equipo')
  await member.context.close()
}

try {
  for (const vp of Object.keys(VIEWPORTS)) {
    if (only && only !== vp) continue
    await run(vp)
  }
} catch (err) {
  problems.push(`walkthrough failure: ${err.stack ?? err}`)
} finally {
  await browser.close()
  server.kill()
}

if (problems.length) {
  console.error('\nProblems:\n' + [...new Set(problems)].map((p) => ` - ${p}`).join('\n'))
  process.exit(1)
}
console.log('\nNo problems: no request to another origin, no CSP violation, no console error.')
