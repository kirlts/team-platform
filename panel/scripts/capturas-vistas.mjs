#!/usr/bin/env node
// Screenshots of each view at 1440x900 and 390x844, in light and dark theme, with headless Chromium
// (Playwright), against panel/dist served by the double server. Besides the PNGs, it measures
// in the browser itself what a screenshot does not show: clipped or ellipsized text,
// horizontal overflow and left edges of each view's blocks (UD-016).
//
//   npm run build && node scripts/capturas-vistas.mjs [--solo desktop|mobile] [--tema light|dark]
//
// Exits with code 1 if it finds clipping, ellipses or horizontal overflow.

import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../capturas/', import.meta.url))
const PORT = Number(process.env.PANEL_CAPTURE_PORT ?? 8793)
const ORIGIN = `http://127.0.0.1:${PORT}`
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const onlyVp = arg('--solo')
const onlyTheme = arg('--tema')
const LANGS = (arg('--idioma') ?? 'es-419').split(',')

mkdirSync(outDir, { recursive: true })
if (!process.argv.includes('--sin-build')) execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' })

const server = spawn('node', ['dev-server.mjs'], {
  cwd: root,
  env: { ...process.env, PANEL_DEV_PORT: String(PORT), PANEL_DEV_STATIC: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
})
await new Promise((r) => setTimeout(r, 800))

const password = randomBytes(12).toString('hex')
const problems = []
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  compact: { width: 1280, height: 720, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
}
const THEMES = ['light', 'dark']

/** Runs in the page: returns what the eye does not see in a screenshot. */
function audit() {
  const out = { clipped: [], ellipsis: [], hscroll: null, lefts: [] }
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''} «${(el.textContent ?? '').trim().slice(0, 40)}»`
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  for (const el of document.querySelectorAll('main *, nav *, header *')) {
    if (!visible(el) || el.classList.contains('sr-only')) continue
    const cs = getComputedStyle(el)
    if (cs.textOverflow === 'ellipsis') out.ellipsis.push(label(el))
    const clamp = cs.getPropertyValue('-webkit-line-clamp')
    if (clamp && clamp !== 'none' && clamp !== 'normal') out.ellipsis.push(`clamp ${clamp} ${label(el)}`)
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.clientWidth > 0 && el.children.length === 0) {
      out.clipped.push(`ancho ${el.scrollWidth}>${el.clientWidth} ${label(el)}`)
    }
    if (el.scrollHeight > el.clientHeight + 1 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.clientHeight > 0 && el.children.length === 0) {
      out.clipped.push(`alto ${el.scrollHeight}>${el.clientHeight} ${label(el)}`)
    }
  }
  const main = document.querySelector('main')
  if (main && main.scrollWidth > main.clientWidth + 1) out.hscroll = `main ${main.scrollWidth}>${main.clientWidth}`
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth + 1) out.hscroll = `${out.hscroll ?? ''} documento ${de.scrollWidth}>${de.clientWidth}`.trim()
  const page = main?.firstElementChild
  if (page) {
    out.lefts = [...page.children].filter(visible).map((c) => `${Math.round(c.getBoundingClientRect().left)}:${c.tagName.toLowerCase()}`)
  }
  return out
}

async function shoot(browser, vp, theme, lang = 'es-419') {
  const cfg = VIEWPORTS[vp]
  const context = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: cfg.mobile ? 2 : 1,
    isMobile: cfg.mobile,
    hasTouch: cfg.mobile,
    colorScheme: theme,
    locale: 'es-CL',
  })
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('team-theme', t)
    } catch {
      // Without storage the theme follows the browser's, which is already the requested one.
    }
  }, theme)
  // The language belongs to the account: it is set through the API before walking the views.
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${vp}/${theme}] excepción: ${e.message}`))
  await page.goto(ORIGIN)
  await page.getByLabel('Correo').fill('ana@dev.invalid')
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByRole('navigation', { name: 'Navegación' }).or(page.getByRole('button', { name: 'Abrir navegación' })).first().waitFor()

  if (lang !== 'es-419') {
    await page.request.patch(`${ORIGIN}/api/members/me`, { data: { language: lang }, headers: { 'X-Team-Request': 'panel' } })
    await page.reload()
    await page.getByRole('navigation').first().waitFor()
  }
  let n = 0
  const take = async (name, opts = {}) => {
    await page.waitForTimeout(500)
    n += 1
    const file = `${outDir}${String(n).padStart(2, '0')}-${name}-${vp}-${theme}${lang === 'es-419' ? '' : '-' + lang}.png`
    await page.screenshot({ path: file, fullPage: !!opts.full })
    const a = await page.evaluate(audit)
    const tag = `[${vp}/${theme}/${name}]`
    for (const x of a.ellipsis) problems.push(`${tag} puntos suspensivos: ${x}`)
    for (const x of a.clipped) problems.push(`${tag} recortado: ${x}`)
    if (a.hscroll) problems.push(`${tag} desborde horizontal: ${a.hscroll}`)
    console.log(file.replace(root, ''), a.lefts.join(' '))
  }

  await page.getByText(lang === 'en' ? 'For me' : 'Para mí').first().waitFor()
  await take('inicio')
  await page.goto(`${ORIGIN}/messages`)
  await page.getByRole('heading', { name: lang === 'en' ? 'Messages' : 'Mensajes', level: 1 }).waitFor()
  await page.waitForTimeout(600)
  await take('mensajes')
  const rich = await (await page.request.get(`${ORIGIN}/api/messages`)).json()
  const id = (rich.items ?? rich).find((m) => m.title.startsWith('Revisar la lectura')).id
  await page.goto(`${ORIGIN}/messages/${id}`)
  await page.locator('main h1').waitFor()
  await page.waitForTimeout(700)
  await take('detalle')
  await page.goto(`${ORIGIN}/areas/a-error`)
  await page.locator('main h1').waitFor()
  await page.waitForTimeout(700)
  await take('areas')
  await page.goto(`${ORIGIN}/team`)
  await page.locator('main h1').waitFor()
  await page.waitForTimeout(700)
  await take('equipo')
  await page.goto(`${ORIGIN}/settings`)
  await page.locator('main h1').waitFor()
  await page.waitForTimeout(700)
  await take('configuracion')
  // Analysis proposal, with attachments.
  await page.goto(ORIGIN)
  await page.locator('main h1').waitFor()
  await page.getByLabel(lang === 'en' ? 'New message' : 'Nuevo mensaje', { exact: true }).last().fill('Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo.')
  await page.locator('input[type=file]:not([capture])').setInputFiles([
    { name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) },
    { name: 'feedback.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('ejemplo') },
  ])
  await page.getByRole('button', { name: lang === 'en' ? 'Send' : 'Enviar' }).first().click()
  await page.getByRole('button', { name: /^(Área|Area):/ }).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
  await take('propuesta')
  if (cfg.mobile) {
    await page.goto(ORIGIN)
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await take('navegacion')
  }
  await context.close()
}

const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    if (onlyVp && onlyVp !== vp) continue
    for (const theme of THEMES) {
      if (onlyTheme && onlyTheme !== theme) continue
      for (const lang of LANGS) await shoot(browser, vp, theme, lang)
    }
  }
} catch (err) {
  problems.push(`fallo del recorrido: ${err.stack ?? err}`)
} finally {
  await browser.close()
  server.kill()
}

if (problems.length) {
  console.error('\nHallazgos:\n' + [...new Set(problems)].map((p) => ` - ${p}`).join('\n'))
  process.exit(1)
}
console.log('\nSin recortes, sin puntos suspensivos y sin desborde horizontal.')
