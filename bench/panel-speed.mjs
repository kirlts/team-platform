// Panel speed bench: loads each screen of the panel in headless Chromium and records what a person waits for.
// GET only: it never creates, edits or deletes anything. Raw figures go to bench/results/<label>.json.
//
//   node bench/panel-speed.mjs --base https://team.devalis.cl --jar /path/jar.txt --label 2026-10-24-panel-antes-produccion
//   node bench/panel-speed.mjs --base http://127.0.0.1:3900 --dev-login bench@example.org --label 2026-10-24-panel-despues-local
//
// Per screen and profile:
//   cold load (empty HTTP cache), then warm load (same browser context, assets cached): TTFB of the HTML, FCP, LCP,
//   time to useful content (the <main> with no loading placeholder and some text), every request with start/end,
//   encoded and decoded bytes; JS/CSS totals; API requests that start only after the script ran (the cascade).
//   Click latency: from the click on a menu link to the next screen's useful content, and from the click on the first
//   message card to the open message's useful content.
// Profiles: `direct` (no throttling) and `slow4g` (the Lighthouse mobile preset: 1.6 Mbit/s down, 750 kbit/s up, 150 ms RTT,
//   CPU x4; Lighthouse docs, throttling, consulted 2026-10-24).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright is a dependency of the panel, not of the root package.
const { chromium } = createRequire(new URL('../panel/package.json', import.meta.url))('playwright')

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
const BASE = (args.base ?? 'http://127.0.0.1:3900').replace(/\/$/, '')
const LABEL = args.label ?? 'panel-speed'
const RUNS = Number(args.runs ?? 3)
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'results', `${LABEL}.json`)
const PROFILES = {
  direct: { network: null, cpu: 1 },
  slow4g: { network: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }, cpu: 4 },
}
const ROUTES = [
  ['inicio', '/'],
  ['mensajes', '/messages'],
  ['mensaje', args.message ?? '/messages/103'],
  ['areas', '/areas'],
  ['equipo', '/team'],
  ['conexiones', '/connections'],
  ['ajustes', '/settings'],
]

function cookiesFromJar (file) {
  const url = new URL(BASE)
  return readFileSync(file, 'utf8').split('\n')
    .filter((l) => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).map((l) => l.replace(/^#HttpOnly_/, '').split('\t')).filter((p) => p.length >= 7)
    .map((p) => ({ name: p[5], value: p[6], domain: url.hostname, path: '/', secure: url.protocol === 'https:', httpOnly: true, sameSite: 'Lax' }))
}

// Local server in development mode: login without a password (NODE_ENV=development).
async function cookiesFromDevLogin (email) {
  const r = await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email }) })
  if (!r.ok) throw new Error(`dev-login ${r.status}`)
  const url = new URL(BASE)
  return r.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: url.hostname, path: '/', secure: false, httpOnly: true, sameSite: 'Lax' } })
}

async function cookiesFromLogin (spec) {
  const [email, ...rest] = spec.split(':')
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email, password: rest.join(':') }) })
  if (!r.ok) throw new Error(`login ${r.status}`)
  const url = new URL(BASE)
  return r.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: url.hostname, path: '/', secure: false, httpOnly: true, sameSite: 'Lax' } })
}

// In-page predicate (a function, not a string: the page's CSP forbids eval): the shell and the screen's content are there.
const useful = () => {
  const main = document.querySelector('main#main')
  return !!main && !main.querySelector('[role="status"][aria-label]') && main.innerText.trim().length > 20
}

function waitUseful (page, timeout = 60000) {
  return page.waitForFunction(useful, null, { timeout, polling: 'raf' })
}

async function newContext (browser, cookies) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  await context.addCookies(cookies)
  return context
}

async function instrument (page, profile) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  const p = PROFILES[profile]
  if (p.network) await cdp.send('Network.emulateNetworkConditions', p.network)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
  const reqs = new Map()
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, t0: e.timestamp, wall: e.wallTime, method: e.request.method }))
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.encoding = e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? null; r.cache = e.response.fromDiskCache ? 'disk' : 'net'; r.tResp = e.timestamp } })
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.encoded = e.encodedDataLength } })
  cdp.on('Network.dataReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.decoded = (r.decoded ?? 0) + e.dataLength })
  return { cdp, reqs }
}

function summarize (reqs, navStart) {
  const rows = [...reqs.values()].filter((r) => r.t1 && !r.url.startsWith('data:')).map((r) => ({
    url: r.url.replace(BASE, ''), type: r.type, method: r.method, status: r.status, encoding: r.encoding, cache: r.cache,
    start_ms: Math.round((r.t0 - navStart) * 1000), end_ms: Math.round((r.t1 - navStart) * 1000), ttfb_ms: r.tResp ? Math.round((r.tResp - r.t0) * 1000) : null,
    encoded: Math.round(r.encoded ?? 0), decoded: r.decoded ?? 0,
  })).sort((a, b) => a.start_ms - b.start_ms)
  const sum = (f) => rows.filter(f).reduce((n, r) => ({ n: n.n + 1, encoded: n.encoded + r.encoded, decoded: n.decoded + r.decoded }), { n: 0, encoded: 0, decoded: 0 })
  const api = rows.filter((r) => r.url.startsWith('/api/'))
  const jsEnd = Math.max(0, ...rows.filter((r) => r.type === 'Script').map((r) => r.end_ms))
  return {
    requests: rows.length,
    total: sum(() => true), js: sum((r) => r.type === 'Script'), css: sum((r) => r.type === 'Stylesheet'), font: sum((r) => r.type === 'Font'), api: sum((r) => r.url.startsWith('/api/')),
    api_after_script_ms: api.length ? Math.round(Math.min(...api.map((r) => r.start_ms)) - jsEnd) : null,
    api_order: api.map((r) => `${r.start_ms}-${r.end_ms} ${r.url}`),
    rows,
  }
}

async function loadOnce (page, reqs, route) {
  reqs.clear()
  const navStart = Date.now()
  await page.goto(BASE + route, { waitUntil: 'commit' })
  await waitUseful(page)
  const usefulAt = Date.now() - navStart
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  const idleAt = Date.now() - navStart
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return { ttfb: n.responseStart, dom: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp?.startTime ?? null }
  })
  const lcp = await page.evaluate(() => new Promise((res) => {
    let v = null
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    setTimeout(() => res(v), 50)
  }))
  const first = Math.min(...[...reqs.values()].map((r) => r.t0))
  return { useful_ms: usefulAt, network_idle_ms: idleAt, ttfb_html_ms: Math.round(nav.ttfb), fcp_ms: nav.fcp && Math.round(nav.fcp), lcp_ms: lcp && Math.round(lcp), dcl_ms: Math.round(nav.dom), load_ms: Math.round(nav.load), ...summarize(reqs, first) }
}

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }

async function clickLatency (page, selector) {
  // From the click event to the next screen's useful content drawn (two frames after it appears).
  return page.evaluate(async (selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const useful = () => { const main = document.querySelector('main#main'); return !!main && !main.querySelector('[role="status"][aria-label]') && main.innerText.trim().length > 20 }
    const before = location.pathname + location.search
    const t0 = performance.now()
    el.click()
    let sawLoading = false
    return await new Promise((resolve) => {
      const tick = () => {
        const now = location.pathname + location.search
        if (document.querySelector('main#main [role="status"][aria-label]')) sawLoading = true
        if (now !== before && useful()) { requestAnimationFrame(() => requestAnimationFrame(() => resolve({ ms: Math.round(performance.now() - t0), showed_loading: sawLoading, to: now }))); return }
        if (performance.now() - t0 > 20000) { resolve({ ms: null, to: now }); return }
        requestAnimationFrame(tick)
      }
      tick()
    })
  }, selector)
}

async function main () {
  const cookies = args.jar ? cookiesFromJar(args.jar) : args['dev-login'] ? await cookiesFromDevLogin(args['dev-login']) : await cookiesFromLogin(args.login)
  // Headless only: nothing may open a window on the person's screen.
  const browser = await chromium.launch({ headless: true })
  const result = { label: LABEL, base: BASE, when: new Date().toISOString(), runs: RUNS, chromium: browser.version(), profiles: {} }
  for (const profile of (args.profiles ?? Object.keys(PROFILES).join(',')).split(',')) {
    const out = { screens: {}, clicks: {} }
    for (const [name, route] of ROUTES.filter(([n]) => !args.only || args.only.split(',').includes(n))) {
      const cold = []; const warm = []
      for (let i = 0; i < RUNS; i++) {
        const context = await newContext(browser, cookies)
        const page = await context.newPage()
        const { cdp, reqs } = await instrument(page, profile)
        // A screen that never settles (useful content not reached in the timeout) is recorded as null, not thrown.
        const attempt = async () => loadOnce(page, reqs, route).catch((e) => ({ useful_ms: null, error: String(e).slice(0, 120), ...summarize(reqs, Math.min(...[...reqs.values()].map((r) => r.t0), Infinity)) }))
        cold.push(await attempt())
        warm.push(await attempt()) // same context: the HTTP cache has the hashed assets
        await context.close()
      }
      const pick = (arr, key) => arr.map((x) => x[key])
      const med = (arr) => Object.fromEntries(['useful_ms', 'ttfb_html_ms', 'fcp_ms', 'lcp_ms', 'load_ms', 'network_idle_ms'].map((k) => [k, median(pick(arr, k))]))
      out.screens[name] = { route, cold_median: med(cold), warm_median: med(warm), cold_runs: cold, warm_runs: warm }
      console.log(profile, name, 'cold useful', out.screens[name].cold_median.useful_ms, 'warm', out.screens[name].warm_median.useful_ms)
    }
    // Navigation by clicking, in one session: Inicio -> Mensajes -> a message -> back through the menu.
    const clicks = { menu: {}, open_message: [] }
    for (let i = 0; i < RUNS; i++) {
      const context = await newContext(browser, cookies)
      const page = await context.newPage()
      await instrument(page, profile)
      await page.goto(BASE + '/', { waitUntil: 'commit' })
      await waitUseful(page)
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      for (const [name, href] of [['mensajes', '/messages'], ['areas', '/areas'], ['equipo', '/team'], ['conexiones', '/connections'], ['ajustes', '/settings'], ['inicio', '/']]) {
        const r = await clickLatency(page, `aside a[href="${href}"]`)
        if (r) (clicks.menu[name] ??= []).push(r)
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      }
      // Second visit to Mensajes in the same session (what the person does all day).
      const again = await clickLatency(page, 'aside a[href="/messages"]')
      if (again) (clicks.menu.mensajes_segunda_visita ??= []).push(again)
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      const href = await page.evaluate(() => document.querySelector('main#main a[href^="/messages/"]')?.getAttribute('href'))
      if (href) {
        const r = await clickLatency(page, `main#main a[href="${href}"]`)
        if (r) clicks.open_message.push({ href, ...r })
      }
      await context.close()
    }
    out.clicks = { menu: Object.fromEntries(Object.entries(clicks.menu).map(([k, v]) => [k, { median_ms: median(v.map((x) => x.ms)), runs: v }])), open_message: { median_ms: median(clicks.open_message.map((x) => x.ms)), runs: clicks.open_message } }
    console.log(profile, 'clicks', JSON.stringify(Object.fromEntries(Object.entries(out.clicks.menu).map(([k, v]) => [k, v.median_ms]))), 'open message', out.clicks.open_message.median_ms)
    result.profiles[profile] = out
  }
  await browser.close()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(result, null, 1))
  console.log('written', OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
