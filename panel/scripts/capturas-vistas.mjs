#!/usr/bin/env node
// Capturas de cada vista a 1440x900 y 390x844, en tema claro y oscuro, con Chromium sin ventana
// (Playwright), contra panel/dist servido por el servidor doble. Además de los PNG, mide en el
// propio navegador lo que una captura no cuenta: texto recortado o con puntos suspensivos,
// desbordes horizontales y bordes izquierdos de los bloques de cada vista (UD-016).
//
//   npm run build && node scripts/capturas-vistas.mjs [--solo desktop|mobile] [--tema light|dark]
//
// Sale con código 1 si encuentra recortes, puntos suspensivos o desborde horizontal.

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
  mobile: { width: 390, height: 844, mobile: true },
}
const THEMES = ['light', 'dark']

/** Corre en la página: devuelve lo que el ojo no ve en una captura. */
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

async function shoot(browser, vp, theme) {
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
      // Sin almacenamiento el tema sigue al del navegador, que ya es el pedido.
    }
  }, theme)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${vp}/${theme}] excepción: ${e.message}`))
  await page.goto(ORIGIN)
  await page.getByLabel('Correo').fill('ana@dev.invalid')
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByRole('navigation', { name: 'Navegación' }).or(page.getByRole('button', { name: 'Abrir navegación' })).first().waitFor()

  let n = 0
  const take = async (name, opts = {}) => {
    await page.waitForTimeout(500)
    n += 1
    const file = `${outDir}${String(n).padStart(2, '0')}-${name}-${vp}-${theme}.png`
    await page.screenshot({ path: file, fullPage: !!opts.full })
    const a = await page.evaluate(audit)
    const tag = `[${vp}/${theme}/${name}]`
    for (const x of a.ellipsis) problems.push(`${tag} puntos suspensivos: ${x}`)
    for (const x of a.clipped) problems.push(`${tag} recortado: ${x}`)
    if (a.hscroll) problems.push(`${tag} desborde horizontal: ${a.hscroll}`)
    console.log(file.replace(root, ''), a.lefts.join(' '))
  }

  await page.getByText('Para mí').first().waitFor()
  await take('inicio')
  await page.goto(`${ORIGIN}/messages`)
  await page.getByText('Revisar la lectura del panel').first().waitFor()
  await take('mensajes')
  await page.getByRole('link', { name: /Revisar la lectura del panel/ }).first().click()
  await page.getByRole('heading', { name: /Respuestas/ }).waitFor()
  await take('detalle')
  await page.goto(`${ORIGIN}/areas`)
  await page.locator('main').getByText('Accesibilidad y experiencia de uso', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: 'Desplegar Error' }).click()
  await take('areas')
  await page.goto(`${ORIGIN}/team`)
  await page.locator('main').getByText('Fernández-Larraín').first().waitFor()
  await take('equipo')
  await page.goto(`${ORIGIN}/settings`)
  await page.getByRole('heading', { name: 'Tema' }).waitFor()
  await take('configuracion')
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
      await shoot(browser, vp, theme)
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
