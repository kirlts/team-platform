#!/usr/bin/env node
// Screenshots of the management zone (team, areas and templates, settings, connections, sign-in and sign-out,
// with their empty and error states) at 1440x900 and 390x844, light and dark, against the example server.
//
//   node scripts/capturas-gestion.mjs [--solo desktop|mobile] [--tema light|dark] [--sin-build]
//
// Writes PNGs to capturas/gestion/. Each viewport and theme runs in parallel (independent contexts).
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PASSWORD, login, settled, startPanel } from '../src/browser-support.mjs'

const outDir = fileURLToPath(new URL('../capturas/gestion/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const VIEWPORTS = { desktop: { width: 1440, height: 900, mobile: false }, mobile: { width: 390, height: 844, mobile: true } }
const THEMES = ['light', 'dark']

const panel = await startPanel(0, { build: !process.argv.includes('--sin-build') })
const { origin, browser } = panel
const problems = []

async function shoot(vp, theme) {
  const cfg = VIEWPORTS[vp]
  const context = await browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: cfg.mobile ? 2 : 1, isMobile: cfg.mobile, hasTouch: cfg.mobile, colorScheme: theme, locale: 'es-CL' })
  await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch { /* theme follows the browser */ } }, theme)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${vp}/${theme}] exception: ${e.message}`))
  const take = async (name, { full = false } = {}) => {
    await settled(page).catch(() => {})
    // The shell scrolls inside <main>, so a full capture grows the window to the height of its content.
    const extra = full ? await page.evaluate(() => { const m = document.querySelector('main#main'); return m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0 }) : 0
    if (extra) await page.setViewportSize({ width: cfg.width, height: cfg.height + extra })
    await page.screenshot({ path: `${outDir}${name}-${vp}-${theme}.png` })
    if (extra) await page.setViewportSize({ width: cfg.width, height: cfg.height })
  }
  const go = async (path) => { await page.goto(`${origin}${path}`); await page.locator('main h1').first().waitFor(); await settled(page) }
  const step = async (name, fn) => { try { await fn() } catch (e) { problems.push(`[${vp}/${theme}/${name}] ${e.message.split('\n')[0]}`) } }

  await step('login', async () => {
    await page.goto(origin); await page.getByLabel('Correo').waitFor(); await take('01-entrada')
    await page.getByRole('button', { name: 'Entrar' }).click(); await take('02-entrada-vacia')
    await page.getByLabel('Correo').fill('nadie@dev.invalid'); await page.getByLabel('Contraseña').fill('corta'); await page.getByRole('button', { name: 'Entrar' }).click()
    await page.getByRole('alert').first().waitFor(); await take('03-entrada-error')
  })
  await login(page, origin, 'ana')
  await step('equipo', async () => {
    await go('/team'); await take('10-equipo', { full: true })
    await page.locator('[data-profile-extract]').first().click(); await page.getByRole('dialog').waitFor(); await take('11-equipo-perfil'); await page.keyboard.press('Escape')
    const actions = page.getByRole('button', { name: /^Acciones/ }).first()
    await actions.click(); await page.getByRole('menu').waitFor(); await take('12-equipo-acciones'); await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Agregar|Nuevo/ }).first().click(); await page.getByRole('dialog').waitFor(); await take('13-equipo-nuevo')
    await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click(); await take('14-equipo-nuevo-error'); await page.keyboard.press('Escape')
  })
  await step('areas', async () => {
    await go('/areas'); await take('20-areas', { full: true })
    await go('/areas/a-error'); await take('21-area', { full: true })
    const row = page.getByTestId('template-open').first()
    if (await row.count()) { await row.click(); await page.getByRole('dialog').waitFor(); await take('22-plantilla'); await page.keyboard.press('Escape') }
    else problems.push(`[${vp}/${theme}] no template row selector`)
  })
  await step('config', async () => {
    await go('/settings'); await take('30-configuracion', { full: true })
    await go('/connections'); await take('31-conexiones', { full: true })
  })
  await step('errores', async () => {
    for (const [path, api, name] of [['/team', '**/api/members*', '40-equipo-error'], ['/areas/a-error', '**/api/areas*', '41-areas-error'], ['/settings', '**/api/audit*', '42-registro-error'], ['/connections', '**/api/settings/connections*', '43-conexiones-error']]) {
      await page.route(api, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'internal', message: 'boom' }) }))
      await page.goto(`${origin}${path}`); await page.locator('main h1').first().waitFor().catch(() => {}); await page.waitForTimeout(1500); await take(name, { full: true })
      await page.unrouteAll()
    }
    for (const [path, api, body, name] of [['/settings', '**/api/audit*', { items: [], next: null }, '44-registro-vacio'], ['/connections', '**/api/settings/connections*', [], '45-conexiones-vacio']]) {
      await page.route(api, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
      await page.goto(`${origin}${path}`); await page.locator('main h1').first().waitFor().catch(() => {}); await page.waitForTimeout(1200); await take(name, { full: true })
      await page.unrouteAll()
    }
  })
  await step('miembro', async () => {
    await page.context().clearCookies(); await login(page, origin, 'bruno'); await go('/team'); await take('50-equipo-miembro', { full: true })
    await go('/areas/a-error'); await take('51-area-miembro', { full: true })
  })
  await step('salida', async () => {
    if (cfg.mobile) { await page.getByRole('button', { name: 'Abrir navegación' }).click() }
    await take('60-navegacion')
    await page.getByRole('button', { name: 'Cerrar sesión' }).or(page.getByRole('menuitem', { name: 'Cerrar sesión' })).first().click()
    await page.getByLabel('Correo').waitFor(); await take('61-salida')
  })
  await context.close()
}

try {
  const jobs = []
  for (const vp of Object.keys(VIEWPORTS)) for (const theme of THEMES) {
    if (arg('--solo') && arg('--solo') !== vp) continue
    if (arg('--tema') && arg('--tema') !== theme) continue
    jobs.push(shoot(vp, theme))
  }
  await Promise.all(jobs)
} finally {
  await panel.stop()
}
console.log(problems.length ? problems.join('\n') : 'ok')
void PASSWORD
