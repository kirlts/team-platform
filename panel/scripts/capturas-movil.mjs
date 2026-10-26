#!/usr/bin/env node
// Screenshots of every view on a phone (390x844) and of the navigation in both widths, light and dark, plus a keyboard walk:
// the first Tab stops with their accessible names and whether the focus ring is visible, and Escape closing the drawer.
//
//   `npm run build && node scripts/capturas-movil.mjs [--sin-build]`
//
// Exits with code 1 when a focused element has no accessible name or no visible focus ring, or when Escape does not close the drawer.

import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../capturas/movil/', import.meta.url))
const PORT = Number(process.env.PANEL_CAPTURE_PORT ?? 8794)
const ORIGIN = `http://127.0.0.1:${PORT}`
mkdirSync(outDir, { recursive: true })
if (!process.argv.includes('--sin-build')) execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' })
const server = spawn('node', ['dev-server.mjs'], { cwd: root, env: { ...process.env, PANEL_DEV_PORT: String(PORT), PANEL_DEV_STATIC: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
for (let i = 0; i < 100; i++) {
  try { await fetch(ORIGIN); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}
const password = randomBytes(12).toString('hex')
const problems = []

/** Runs in the page: the focused element, its accessible name as a screen reader would get it, and whether a ring is drawn. */
function focusInfo() {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const cs = getComputedStyle(el)
  const after = getComputedStyle(el, '::after')
  // A row of the side panel draws the ring on its row box (.nav-item), around the link and its count.
  const box = el.closest('.nav-item')
  const bs = box ? getComputedStyle(box) : null
  const ring = (bs && bs.outlineStyle !== 'none' && parseFloat(bs.outlineWidth) > 0) || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || (after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0)
  const labelled = el.getAttribute('aria-labelledby')
  const name = (el.getAttribute('aria-label') || (labelled && document.getElementById(labelled)?.textContent) || (el.labels && el.labels[0]?.textContent) || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 50)
  return { tag: el.tagName.toLowerCase(), name, ring: !!ring }
}

async function walk(browser, vp, theme) {
  const mobile = vp === 'mobile'
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, locale: 'es-CL' })
  await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch { /* follows the browser */ } }, theme)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${vp}/${theme}] exception: ${e.message}`))
  await page.goto(ORIGIN)
  await page.getByLabel('Correo').fill('ana@dev.invalid')
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.locator('main h1').first().waitFor()
  const take = async (name, full = false) => {
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${outDir}${name}-${vp}-${theme}.png`, fullPage: full })
  }
  const views = [['inicio', '/'], ['mensajes', '/messages'], ['areas', '/areas'], ['area', '/areas/a-error'], ['conexiones', '/connections'], ['equipo', '/team'], ['configuracion', '/settings'], ['no-existe', '/no-existe']]
  if (mobile) {
    const rich = await (await page.request.get(`${ORIGIN}/api/messages`)).json()
    const id = (rich.items ?? rich).find((m) => m.title.startsWith('Revisar la lectura')).id
    views.splice(2, 0, ['detalle', `/messages/${id}`])
    for (const [name, path] of views) {
      await page.goto(ORIGIN + path)
      await page.locator('main h1').first().waitFor()
      await take(name)
    }
  }
  // The navigation: the drawer on a phone, the side panel from 768 px.
  await page.goto(ORIGIN + '/messages')
  await page.locator('main h1').first().waitFor()
  if (mobile) {
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await page.getByRole('dialog').waitFor()
    await take('navegacion')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (await page.getByRole('dialog').count()) problems.push(`[${vp}/${theme}] Escape does not close the drawer`)
    const back = await page.evaluate(focusInfo)
    if (!back || !/navegación/i.test(back.name)) problems.push(`[${vp}/${theme}] focus does not return to the menu button after Escape: ${JSON.stringify(back)}`)
  } else {
    await take('navegacion')
  }
  // The keyboard walk from the top of the page.
  await page.goto(ORIGIN + '/messages')
  await page.locator('main h1').first().waitFor()
  const stops = []
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate(focusInfo)
    if (!f) continue
    stops.push(`${f.tag}«${f.name}»${f.ring ? '' : ' SIN-ANILLO'}`)
    if (!f.name) problems.push(`[${vp}/${theme}] tab stop ${i + 1} without accessible name: ${f.tag}`)
    if (!f.ring) problems.push(`[${vp}/${theme}] tab stop ${i + 1} without visible focus: ${f.tag} «${f.name}»`)
    if (i === 0) await take('foco-primero')
  }
  console.log(`[${vp}/${theme}] tab: ${stops.join(' → ')}`)
  await context.close()
}

const browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
try {
  for (const vp of ['mobile', 'desktop']) for (const theme of ['light', 'dark']) await walk(browser, vp, theme)
} catch (err) {
  problems.push(`walkthrough failure: ${err.stack ?? err}`)
} finally {
  await browser.close()
  server.kill()
}
if (problems.length) {
  console.error('\nFindings:\n' + [...new Set(problems)].map((p) => ` - ${p}`).join('\n'))
  process.exit(1)
}
console.log('\nEvery tab stop has a name and a visible ring; Escape closes the drawer.')
