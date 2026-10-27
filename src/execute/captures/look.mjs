#!/usr/bin/env node
// `look`: the session looks at the interface of its host, read only, and captures it. It prints the text first (the tree of the page, cheap in tokens)
// and takes a screenshot only with `--shot`, or when the page has too little text to say what it shows. Every capture ends with a line
// `LOOK_CAPTURE {path, alt, place, as, masked}` (UD-268). See `args.js` for the options and `host.js` for what the host declares.
//
// Exit code: 0 looked at what was asked · 1 something else failed (the message says what) · 2 arguments or adapter · 3 the session ended and could not be
// redone · 4 the time ran out · 5 could not sign in · 6 the browser does not start. Every run ends by one of these and says why on the error output;
// none waits forever.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs, UsageError, USAGE } from './args.js'
import { chromiumExecutable, killDescendants, launchBrowser, loadPlaywright } from './browser.js'
import { declaration, declarationLine, defaultAlt, placeOf } from './declare.js'
import { guardedFetch, installGuard } from './guard.js'
import { loadHost } from './host.js'
import { learn, newLearned } from './learn.js'
import { imageTokens, MEASURED_SCREEN_MS, MEASURED_START_MS, MARGIN, runTimeoutMs, textTokens } from './limits.js'
import { applyMask, maskPatterns } from './mask.js'
import { pageTree } from './tree.js'

/** The exit codes (documented in the header and in `USAGE`). */
const EXIT = { usage: 2, expired: 3, timeout: 4, signin: 5, browser: 6 }

/** An error that carries its exit code. */
class LookError extends Error {
  constructor (message, code = 1, extra = {}) { super(message); this.code = code; Object.assign(this, extra) }
}

const env = process.env
const t0 = Date.now()
const seconds = () => ((Date.now() - t0) / 1000).toFixed(1)
const log = (m) => process.stderr.write(`[look ${seconds()}s] ${m}\n`)
const debug = (m) => { if (env.LOOK_DEBUG) log(m) }
const withoutToken = (m) => String(m).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>').split('\nCall log')[0]

let phase = 'start'
const inPhase = (p) => { phase = p }

/** Ends now without leaving a browser alive: kills only the descendants of this process. */
function exitNow (code, message) {
  if (message) process.stderr.write(`look: ${message}\n`)
  killDescendants()
  process.exit(code)
}

let host
let parsed
try {
  host = await loadHost(env.LOOK_HOST)
  parsed = parseArgs(process.argv.slice(2), { hostFlags: host.flags, env })
} catch (error) {
  exitNow(EXIT.usage, error instanceof UsageError || /adapter|LOOK_HOST/.test(error.message) ? `${error.message}${error instanceof UsageError ? `\n${USAGE}` : ''}` : error.message)
}
if (parsed.help) { console.log(USAGE); process.exit(0) }
const { op } = parsed

const origin = String(env.LOOK_ORIGIN || host.origin || '').replace(/\/$/, '')
try { new URL(origin) } catch { exitNow(EXIT.usage, 'there is no address to look at: set LOOK_ORIGIN or declare `origin` in the adapter (LOOK_HOST)') }

const timeoutMs = runTimeoutMs(op.places.length, env)
if (timeoutMs === null) exitNow(EXIT.usage, 'LOOK_TIMEOUT_S asks for a number of seconds greater than zero')
const onTimeout = () => exitNow(EXIT.timeout, `the time of ${(timeoutMs / 1000).toFixed(0)} s ran out (${MARGIN} times what was measured: ${(MEASURED_START_MS / 1000).toFixed(1)} s to start `
  + `and ${(MEASURED_SCREEN_MS / 1000).toFixed(1)} s per screen) in the phase «${phase}». If the screen is slow for real, LOOK_TIMEOUT_S=<seconds> raises it.`)
setTimeout(onTimeout, timeoutMs).unref()

// With a session of the platform the captures land in $TEAM_CAPTURES_DIR: `team reply --captures` and the final output take them from there, with the path relative to that folder.
const capturesDir = env.TEAM_CAPTURES_DIR ? resolve(env.TEAM_CAPTURES_DIR) : null
const outDir = resolve(env.LOOK_OUT || capturesDir || join(env.TMPDIR || tmpdir(), 'look'))

// ── the session ─────────────────────────────────────────────────────────────
/** `fetch` under the read-only guard, with the failures a person can act on. A POST has to be one the adapter lists in `permit`. */
async function api (path, { method = 'GET', body, token, permit = [], tolerate401 = false } = {}) {
  let res
  try {
    res = await guardedFetch(`${origin}${path}`, {
      method, permit, origin, blockedGets: host.guard.blockedGets,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) // declared courtesy: below the total time of a run (LOOK_TIMEOUT_S) and above the 7.6 s the first host measured for a whole run
    })
  } catch (error) {
    if (/read-only guard/.test(error.message)) throw error
    const cause = error.name === 'TimeoutError' ? 'it did not answer in 20 s' : (error.cause?.code || error.cause?.message || error.message)
    throw new LookError(`could not talk to ${origin}${path.split('?')[0]}: ${cause}`, EXIT.signin)
  }
  let data = null; try { data = await res.json() } catch { /* no body */ }
  // A call with a session that the server rejects: the one held no longer works whatever its date says.
  if (token && res.status === 401 && !tolerate401) throw new LookError(`the server rejected the session at ${path.split('?')[0]} (401)`, EXIT.expired, { expired: true })
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') }
}
const fail = (message, code = EXIT.signin) => { throw new LookError(message, code) }

async function openSession (fresh = false) {
  inPhase('sign in')
  if (!host.session) return { as: 'anonymous visitor', init: {} }
  const session = await host.session({ options: op.host, api, log, fail, fresh })
  if (!session || typeof session.as !== 'string' || session.as.trim() === '') throw new LookError('the adapter\'s session has to return { as }: who the tool looks as, in one line', EXIT.usage)
  return session
}

const session = await openSession().catch((error) => exitNow(error.code ?? 1, withoutToken(error.message)))

// ── the browser ─────────────────────────────────────────────────────────────
inPhase('open the browser')
const playwright = loadPlaywright({ env, hostDirs: host.playwrightDirs })
if (!playwright) exitNow(EXIT.browser, 'Playwright is not installed here: `npm i playwright` in a folder named by LOOK_PLAYWRIGHT_DIR (or ~/.tp-playwright) and `npx playwright install chromium`')
const { chromium } = playwright.chromium ? playwright : playwright.default
let browser
try {
  browser = await launchBrowser(chromium, { origin, allowHosts: host.allowHosts, executable: chromiumExecutable(chromium, env) })
} catch (error) {
  exitNow(EXIT.browser, `the browser did not start: ${withoutToken(error.message).split('\n').find((l) => l.trim()) ?? 'no detail'}. It is installed with \`npx playwright install chromium\` or one is named with LOOK_CHROMIUM.`)
}
const context = await browser.newContext({ viewport: { width: op.width, height: op.height }, deviceScaleFactor: 1, serviceWorkers: 'block', ...host.context })
const guard = await installGuard(context, { origin, browserPosts: host.guard.browserPosts, blockedGets: host.guard.blockedGets })

async function applySession (s) {
  const { sessionStorage = {}, localStorage = {}, cookies = [], headers = null } = s.init ?? {}
  if (cookies.length) await context.addCookies(cookies)
  if (headers) await context.setExtraHTTPHeaders(headers)
  if (Object.keys(sessionStorage).length || Object.keys(localStorage).length) {
    await context.addInitScript(({ s: ss, l }) => {
      try { for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, v) } catch { /* no storage */ }
      try { for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v) } catch { /* no storage */ }
    }, { s: sessionStorage, l: localStorage })
  }
}
await applySession(session)
const page = await context.newPage()

// What the page shows about people comes from JSON responses of its own server: from them the tool learns what to cover.
const learned = newLearned()
let saw401 = false
page.on('response', async (response) => {
  try {
    const url = new URL(response.url())
    if (response.status() === 401 && response.url().startsWith(origin) && !host.loginPaths.test(url.pathname)) saw401 = true
    if (!op.mask || !response.url().startsWith(origin) || !(response.headers()['content-type'] || '').includes('json')) return
    if (!host.mask.learnFrom.test(url.pathname)) return
    learn(learned, await response.json(), host.mask.rules, host.mask.rules.personContext.test(url.pathname))
  } catch { /* a body that cannot be read */ }
})

// Declared courtesies, not measurements: each is the end of a wait INSIDE the total time of a run (runTimeoutMs), which is the one that is measured.
const NAVIGATION_MS = 30_000
const IDLE_MS = 1_500 // the network stays busy on some pages for good (a stream); this much quiet is enough to continue
const SETTLE_MS = 10_000 // a page that has not settled after this long is captured as it is
const MENU_FIND_MS = 15_000
const CLICK_MS = 8_000
const NAVIGATION_RETRIES = 2 // a network change in the middle of a navigation is retried; the third failure is real

const loading = { source: host.loadingText.source, flags: host.loadingText.flags }
async function settle () {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: IDLE_MS }).catch(() => {})
  debug('idle done')
  const t = Date.now()
  // Settled when there is text and no busy indicator or loading text is visible.
  await page.waitForFunction((l) => {
    const text = (document.body?.innerText || '').trim()
    if (text.length <= 20 || document.querySelector('[aria-busy=true], [class*=skeleton i], [class*=shimmer i]')) return false
    if (new RegExp(l.source, l.flags).test(text)) return false
    // A table with more than half of its cells empty is still filling.
    for (const table of document.querySelectorAll('table')) {
      const cells = [...table.querySelectorAll('td')]
      if (cells.length > 4 && cells.length <= 120 && cells.filter((c) => !c.innerText.trim() && !c.querySelector('button,a,svg,img,input')).length > cells.length / 2) return false
    }
    return true
  }, loading, { timeout: SETTLE_MS }).catch(() => debug(`did not settle in ${SETTLE_MS / 1000} s`))
  debug(`settled in ${((Date.now() - t) / 1000).toFixed(1)} s`)
}

async function go (place, first) {
  if (/^[/?#]/.test(place)) {
    const path = place.startsWith('/') ? place : `/${place}`
    const target = host.url ? host.url({ place, first, session, origin }) : `${origin}${path}`
    for (let attempt = 0; ; attempt++) {
      try { await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_MS }); break } catch (error) {
        if (attempt >= NAVIGATION_RETRIES || !/ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_TIMED_OUT|Timeout/.test(error.message)) throw error
        log('retrying the navigation')
      }
    }
    debug('goto done')
  } else {
    if (first) {
      await page.goto(host.menuStart ? host.menuStart({ first, session, origin }) : `${origin}/`, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_MS })
      await settle()
    }
    for (const step of place.split('>').map((s) => s.trim()).filter(Boolean)) {
      const exact = page.getByRole('link', { name: step, exact: true }).or(page.getByRole('tab', { name: step, exact: true }))
        .or(page.getByRole('button', { name: step, exact: true })).or(page.getByRole('menuitem', { name: step, exact: true })).first()
      const near = page.getByRole('link', { name: step }).or(page.getByRole('tab', { name: step })).or(page.getByRole('button', { name: step })).first()
      const byText = page.getByText(step, { exact: true }).first()
      const element = exact.or(near).or(byText).first()
      try { await element.waitFor({ state: 'visible', timeout: MENU_FIND_MS }) } catch { throw new LookError(`there is no menu or tab «${step}» on this screen`) }
      await element.click({ timeout: CLICK_MS })
      await settle()
    }
  }
  await settle()
}

// ── the places ──────────────────────────────────────────────────────────────
const declared = []
mkdirSync(outDir, { recursive: true })
let looked = 0
let signedAs = session.as
try {
  for (const place of op.places) {
    const started = Date.now()
    inPhase(`screen ${place}`)
    const cutBefore = guard.cut.length
    // A session that ends: the page says «session ended» or the API answers 401. The login is redone once and the view repeated; if it stays the same, `look`
    // exits with 3 and never captures that screen as if it were the one asked for.
    let reopen = false
    for (let attempt = 0; ; attempt++) {
      saw401 = false
      await go(place, looked === 0 || reopen)
      const visibleText = await page.evaluate(() => document.body.innerText).catch(() => '')
      if (!saw401 && !host.expiredText.test(visibleText.slice(0, 4000))) break
      if (attempt >= 1) { process.stderr.write('look: the session is still over after redoing the login once; the view is not captured\n'); process.exitCode = EXIT.expired; throw Object.assign(new Error('session ended'), { quiet: true }) }
      log('session ended: redoing the login and repeating the view')
      const fresh = await openSession(true)
      signedAs = fresh.as
      await applySession(fresh)
      Object.assign(session, fresh)
      reopen = true
    }
    looked++
    if (op.lastOnly && place !== op.places[op.places.length - 1]) continue
    if (op.mask) inPhase(`cover people on ${place}`)
    const mask = op.mask
      ? await page.evaluate(applyMask, { values: [...learned.values], learned: learned.count, patterns: maskPatterns(host.mask.patterns) })
      : { masked: false, hits: 0, residue: 0, sources: 0 }
    debug('mask done')
    const title = await page.title()
    const url = new URL(page.url())
    const tree = op.text ? (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, '\n\n') : await page.evaluate(pageTree)
    debug('tree done')
    const characters = tree.length
    const tooLittleText = characters < 80 // declared courtesy: a page with less text than a line cannot be understood without seeing it
    let capture = null; let imageCost = 0
    if (op.shot || tooLittleText) {
      inPhase(`capture of ${place}`)
      const file = typeof op.shot === 'string' ? (capturesDir && !op.shot.startsWith('/') ? join(capturesDir, op.shot) : op.shot) : join(outDir, `look-${Date.now()}-${looked}.png`)
      mkdirSync(dirname(resolve(file)), { recursive: true })
      const clip = op.clip ? { x: op.clip[0], y: op.clip[1], width: op.clip[2], height: op.clip[3] } : undefined
      await page.screenshot({ path: file, animations: 'disabled', caret: 'initial', fullPage: op.full && !clip, clip, type: /\.jpe?g$/i.test(file) ? 'jpeg' : 'png' })
      const size = clip ? { w: clip.width, h: clip.height } : { w: op.width, h: op.full ? await page.evaluate(() => document.documentElement.scrollHeight) : op.height }
      imageCost = imageTokens(size.w, size.h)
      const heading = await page.evaluate(() => document.querySelector('h1, h2, [role=heading]')?.innerText || '')
      capture = declaration({ file, capturesDir, alt: op.alt || defaultAlt(title, heading), place: placeOf(place, url), as: signedAs, masked: mask.masked })
    }
    console.log(`── ${place} · ${url.pathname}${url.search} · «${title}» · as ${signedAs}`)
    console.log(tree.length > 14_000 ? `${tree.slice(0, 14_000)}\n… (cut: ${tree.length - 14_000} more characters; use --text or a narrower menu)` : tree) // 14,000 characters ≈ 3,500 tokens: the most a first look should cost
    console.log(`── measured: ${((Date.now() - started) / 1000).toFixed(1)} s, text ~${textTokens(Math.min(characters, 14_000))} tokens (characters/4)${capture ? `, screenshot ~${imageCost} tokens (width×height/750)` : ''}; masked: ${mask.hits} data of people, ${mask.residue} left, ${mask.sources} sources`)
    for (const c of guard.cut.slice(cutBefore)) {
      const where = c.method === 'WS' ? c.url : `${new URL(c.url).host}${new URL(c.url).pathname}`
      console.log(c.method === 'GET' ? `the guard cut GET ${where}` : `incomplete view: the guard cut ${c.method} ${where}`)
    }
    if (capture) { console.log(declarationLine(capture)); declared.push(capture) }
  }
} catch (error) {
  if (!error.quiet) { process.stderr.write(`look: ${withoutToken(error.message)}\n`); process.exitCode = error.code ?? 1 }
} finally {
  const cut = guard.cut
  log(`guard: ${cut.length} requests cut${cut.length ? ' → ' + cut.map((c) => (c.method === 'WS' ? c.url : `${c.method} ${new URL(c.url).host}${new URL(c.url).pathname}`)).join('; ') : ''}; writes that passed: ${guard.passed.writes.length ? guard.passed.writes.join(', ') : 'none'}`)
  // Closing a Chromium that died or does not answer cannot hang `look`: it gets the time of one screen and, if it does not close, what this process started is killed.
  inPhase('close the browser')
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, MEASURED_SCREEN_MS))])
  killDescendants()
}
if (op.json) console.log(JSON.stringify(declared))
process.exit(process.exitCode ?? 0)
