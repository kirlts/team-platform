// `look` end to end, with a real headless Chromium against a server of its own. Needs the Chromium of the Playwright version of the panel (the
// repository's one dependency on a browser: `panel/package.json`); without it the tests are skipped and say so. Each case runs `look.mjs` as a process
// and looks at its exit code, its output and what reached the server: the proof that a write does not leave is made by counting what arrives.
// Not part of `npm test` by area unless src/execute/captures/ changes; it is not in the pool of browser tests of the panel (it builds nothing).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkCaptures } from '../../../scripts/team.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const PANEL = here('../../../panel')
const LOOK = here('./look.mjs')
const HOST = here('./testing/host-example.mjs')
const PASSWORD = randomBytes(12).toString('hex') // exists only in this run: if it shows up in an output, it was printed
const CAPTURE_LINE = /^LOOK_CAPTURE (.+)$/m

let playwright; let chromiumAvailable = false
try {
  playwright = createRequire(`${PANEL}/package.json`)('playwright')
  chromiumAvailable = existsSync(playwright.chromium.executablePath())
} catch { /* no Playwright in the panel */ }
const needsChromium = chromiumAvailable ? {} : { skip: 'the Chromium of the panel\'s Playwright is not installed (npx playwright install chromium)' }

const PAGE = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${head || 'Shop'}</title></head><body>${body}</body></html>`
const ORDERS = PAGE(`
  <nav aria-label="Main"><a href="#" id="go-orders">Orders</a> <a href="#" id="go-settings">Settings</a></nav>
  <main id="view"><h1>Shop</h1><p>Welcome back</p></main>
  <script>
    const view = document.getElementById('view')
    document.getElementById('go-orders').onclick = (e) => { e.preventDefault(); view.innerHTML = '<h1>Open orders</h1><table><tr><td>Maria Soto</td><td>maria@example.org</td></tr><tr><td>Ana Perez</td><td>12.345.678-5</td></tr></table>' }
    document.getElementById('go-settings').onclick = (e) => { e.preventDefault(); view.innerHTML = '<h1>Settings</h1><a href="#" id="go-team">Team</a>'; document.getElementById('go-team').onclick = (ev) => { ev.preventDefault(); view.innerHTML = '<h1>Team members</h1><p>Carlos Ruiz</p>' } }
  </script>`, 'Shop - home')

let server; let origin; let foreign; let foreignOrigin
let arrived = []; let foreignArrived = []
let loginMode = 'ok'; let logins = 0; let tokenPlan = []
let dir

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'look-chromium-'))
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname !== '/favicon.ico') arrived.push(`${req.method} ${url.pathname}`)
    const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
    const html = (body) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(body) }
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      logins++
      let raw = ''; req.on('data', (c) => { raw += c })
      return req.on('end', () => {
        const sent = JSON.parse(raw || '{}')
        if (sent.password !== PASSWORD) return json(401, { error: 'bad' })
        if (loginMode === '429') return json(429, {}, { 'retry-after': '30' })
        if (loginMode === '500') return json(500, {})
        json(200, { token: tokenPlan.shift() ?? 'good' })
      })
    }
    if (url.pathname === '/api/me') return req.headers.authorization === 'Bearer good' ? json(200, { name: 'Reader' }) : json(401, {})
    if (url.pathname === '/data.json') return json(200, { patients: [{ id: 1, full_name: 'Maria Soto', email: 'maria@example.org' }, { id: 2, full_name: 'Ana Perez' }], services: [{ name: 'Consultation' }] })
    if (url.pathname === '/secret') return json(200, { secret: 'x' })
    if (url.pathname === '/app') {
      return html(PAGE(`<h1>Account</h1><p id="state">Loading…</p><script>
        const token = sessionStorage.getItem('token')
        fetch('/api/me', { headers: { authorization: 'Bearer ' + token } }).then((r) => {
          document.getElementById('state').textContent = r.ok ? 'Signed in with a good token' : 'Your session ended'
        })</script>`, 'Account'))
    }
    if (url.pathname === '/people') {
      return html(PAGE(`<h1>People</h1><ul id="list"></ul><p id="note">Contact maria@example.org or +56 9 8765 4321, id 12.345.678-5</p><script>
        fetch('/data.json').then((r) => r.json()).then((d) => { for (const p of d.patients) document.getElementById('list').insertAdjacentHTML('beforeend', '<li>' + p.full_name + '</li>') })</script>`, 'People'))
    }
    if (url.pathname === '/writes') {
      return html(PAGE(`<h1>Writes</h1><p>Fires everything it can</p><script>
        const base = location.origin
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) fetch(base + '/api/w-' + method, { method, body: '{}' }).catch(() => {})
        const x = new XMLHttpRequest(); x.open('POST', base + '/api/xhr'); x.send('{}')
        navigator.sendBeacon(base + '/api/beacon', '{}')
        fetch(base + '/secret').catch(() => {})
        fetch(base + '/api/read').catch(() => {})
        fetch('${foreignOrigin}/foreign', { mode: 'no-cors' }).catch(() => {})
        try { new WebSocket(base.replace('http', 'ws') + '/ws') } catch {}
        </script>`, 'Writes'))
    }
    if (url.pathname === '/loop') return html(PAGE('<script>while (true) {}</script>', 'Loop'))
    if (url.pathname === '/blank') return html('<!doctype html><title>Blank</title><p>Almost nothing to read here</p>')
    return html(ORDERS)
  })
  foreign = createServer((req, res) => { foreignArrived.push(`${req.method} ${req.url}`); res.end('foreign') })
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve))
  foreignOrigin = `http://127.0.0.1:${foreign.address().port}`
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); foreign.close(); rmSync(dir, { recursive: true, force: true }) })

/** Runs `look` as a process. */
function look (args, env = {}, { limit = 60_000 } = {}) {
  const started = Date.now()
  const out = join(dir, `run-${Math.random().toString(36).slice(2)}`)
  mkdirSync(out, { recursive: true })
  const child = spawn(process.execPath, [LOOK, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LOOK_PLAYWRIGHT_DIR: PANEL, LOOK_ORIGIN: origin, TEAM_CAPTURES_DIR: out, TMPDIR: out, TEST_PASSWORD: PASSWORD, ...env }
  })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', (d) => { stdout += d }); child.stderr.on('data', (d) => { stderr += d })
  return new Promise((resolve) => {
    const cap = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } stderr += '\n[the test killed it: it did not end by itself]' }, limit)
    child.on('exit', (code, signal) => { clearTimeout(cap); resolve({ code: code ?? `signal ${signal}`, stdout, stderr, ms: Date.now() - started, out }) })
  })
}
const reset = () => { arrived = []; foreignArrived = []; loginMode = 'ok'; logins = 0; tokenPlan = [] }
const withSession = { LOOK_HOST: HOST }

describe('look: reading a page', needsChromium, () => {
  it('prints the tree of a page: headings, links, tables, fields; one run, several places', async () => {
    reset()
    const r = await look(['/', 'Orders'], { LOOK_MASK: 'off' })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^── \/ · \/ · «Shop - home» · as anonymous visitor$/m)
    assert.match(r.stdout, /# Shop/)
    assert.match(r.stdout, /\[link Orders\]/)
    assert.match(r.stdout, /# Open orders/, 'the second place is a menu, and it was clicked')
    assert.match(r.stdout, /Maria Soto \| maria@example\.org/, 'a table row is one line with the cells separated by « | »')
    assert.match(r.stdout, /masked: 0 data of people, 0 left, 0 sources/, 'with the mask off nothing is counted')
  })

  it('reaches a nested menu place by its names and a text view with --text', async () => {
    reset()
    const r = await look(['Settings > Team', '--text', '--no-mask'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /Team members\s+Carlos Ruiz/)
    assert.ok(!/\[link/.test(r.stdout), 'the text view is what a person reads, not the tree')
  })

  it('says there is no such menu, with exit 1 and no trace', async () => {
    const r = await look(['Nonexistent'], { LOOK_TIMEOUT_S: '60' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /there is no menu or tab «Nonexistent» on this screen/)
    assert.ok(!/\n\s+at /.test(r.stderr))
  })

  it('--last-only looks at every place and prints only the last', async () => {
    const r = await look(['/people', '/blank', '--last-only'])
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!/People/.test(r.stdout.replace(/«.*?»/g, '')) || !/── \/people/.test(r.stdout))
    assert.match(r.stdout, /── \/blank/)
  })
})

describe('look: capturing and covering people', needsChromium, () => {
  it('covers the people the page learned and the patterns, declares masked true, and the declaration passes the check of the platform', async () => {
    reset()
    const r = await look(['/people', '--shot', 'people.png', '--alt', 'The people list'])
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!/Maria Soto|Ana Perez|maria@example\.org|8765 4321/.test(r.stdout), r.stdout)
    assert.match(r.stdout, /█████/)
    const declared = JSON.parse(r.stdout.match(CAPTURE_LINE)[1])
    assert.deepEqual(declared, { path: 'people.png', alt: 'The people list', place: '/people', as: 'anonymous visitor', masked: true })
    const checked = await checkCaptures([declared], { dir: r.out, max: 3, maxBytes: 7 * 1024 * 1024 })
    assert.deepEqual(checked.rejected, [])
    assert.equal(checked.accepted[0].mime, 'image/png')
  })

  it('--no-mask shows the page as it is and declares masked false, which the platform leaves out without an open zone', async () => {
    reset()
    const r = await look(['/people', '--shot', 'raw.png', '--no-mask'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /Maria Soto/)
    const declared = JSON.parse(r.stdout.match(CAPTURE_LINE)[1])
    assert.equal(declared.masked, false)
    assert.deepEqual((await checkCaptures([declared], { dir: r.out, max: 3, maxBytes: 7 * 1024 * 1024 })).rejected, [{ index: 0, reason: 'unmasked_sensitive' }])
  })

  it('masks by default and not when the platform lets captures show people; LOOK_MASK decides over it', async () => {
    const allowed = await look(['/people'], { TEAM_CAPTURES_UNMASKED: 'allowed' })
    assert.match(allowed.stdout, /Maria Soto/)
    const forced = await look(['/people'], { TEAM_CAPTURES_UNMASKED: 'allowed', LOOK_MASK: 'on' })
    assert.ok(!/Maria Soto/.test(forced.stdout))
  })

  it('the adapter widens the mask: its national id pattern and its keys', async () => {
    reset()
    const r = await look(['/', 'Orders'], withSession)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!/12\.345\.678-5/.test(r.stdout), 'the id pattern of the adapter covers it')
  })

  it('--phone captures 390 pixels wide and the default is 1280', async () => {
    const wide = (file) => readFileSync(file).readUInt32BE(16)
    const phone = await look(['/blank', '--shot', 'phone.png', '--phone'])
    const desktop = await look(['/blank', '--shot', 'desktop.png'])
    assert.equal(wide(join(phone.out, 'phone.png')), 390)
    assert.equal(wide(join(desktop.out, 'desktop.png')), 1280)
  })

  it('a page with almost no text is captured although no capture was asked, because the text does not say what it shows', async () => {
    const r = await look(['/blank'])
    assert.match(r.stdout, /^LOOK_CAPTURE /m)
    assert.equal(readdirSync(r.out).filter((f) => f.endsWith('.png')).length, 1)
  })
})

describe('look: the guarantee of read only', needsChromium, () => {
  it('no write reaches the server, no request reaches another destination, and the GET that is not a pure read is cut', async () => {
    reset()
    const r = await look(['/writes'], { LOOK_HOST: HOST })
    assert.equal(r.code, 0, r.stderr)
    const writes = arrived.filter((a) => !/^(GET|HEAD) /.test(a))
    assert.deepEqual(writes, ['POST /auth/login'], 'the only write is the login that the adapter lists for the session, made by Node and not by the page')
    assert.ok(arrived.includes('GET /api/read'), 'a plain read does pass')
    assert.ok(!arrived.includes('GET /secret'), 'the GET the adapter lists as blocked did not leave')
    assert.deepEqual(foreignArrived, [], 'nothing reached the other destination')
    assert.match(r.stdout, /incomplete view: the guard cut POST /)
    assert.match(r.stdout, /the guard cut GET .*\/secret/)
  })

  it('the control: the same page without the guard does send the writes, so the test above can fail', async () => {
    reset()
    const browser = await playwright.chromium.launch({ headless: true })
    try {
      const page = await (await browser.newContext()).newPage()
      await page.goto(`${origin}/writes`)
      await page.waitForTimeout(800) // declared courtesy of this test: the page fires its requests on load; this is time for them to arrive
    } finally { await browser.close() }
    for (const m of ['POST /api/w-POST', 'PUT /api/w-PUT', 'PATCH /api/w-PATCH', 'DELETE /api/w-DELETE', 'POST /api/xhr']) assert.ok(arrived.includes(m), `without the guard ${m} arrives`)
    assert.ok(foreignArrived.length > 0, 'without the guard the other destination is reached')
  })
})

describe('look: the session of the host', needsChromium, () => {
  it('signs in through the adapter, puts the token in the page, and every capture says who it was seen as', async () => {
    reset()
    const r = await look(['/app', '--account', 'alice', '--shot', 'app.png'], withSession)
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /Signed in with a good token/)
    assert.match(r.stdout, /as alice, read only/)
    assert.equal(JSON.parse(r.stdout.match(CAPTURE_LINE)[1]).as, 'alice, read only')
    assert.equal(logins, 1)
    assert.ok(!r.stdout.includes(PASSWORD) && !r.stderr.includes(PASSWORD), 'the password is not printed')
  })

  for (const [mode, pattern] of [['429', /the server limits the attempts \(429, retry in 30 s\)/], ['500', /did not let reader in \(500\)/]]) {
    it(`a login answered ${mode}: exit 5 and the cause, one attempt`, async () => {
      reset(); loginMode = mode
      const r = await look(['/app'], withSession)
      assert.equal(r.code, 5)
      assert.match(r.stderr, pattern)
      assert.equal(logins, 1)
      assert.ok(!r.stderr.includes(PASSWORD))
    })
  }

  it('a password the server refuses: exit 5, and the adapter\'s words', async () => {
    reset()
    const r = await look(['/app'], { ...withSession, TEST_PASSWORD: 'not-the-password' })
    assert.equal(r.code, 5)
    assert.match(r.stderr, /did not let reader in \(401\)/)
  })

  it('a server that is not there: exit 5, names the address, no trace of Node', async () => {
    const r = await look(['/app'], { ...withSession, LOOK_ORIGIN: 'http://127.0.0.1:9' })
    assert.equal(r.code, 5)
    assert.match(r.stderr, /could not talk to http:\/\/127\.0\.0\.1:9\/auth\/login/)
    assert.ok(!/\n\s+at /.test(r.stderr))
  })

  it('a session that ends in the page is redone once and the view repeated', async () => {
    reset(); tokenPlan = ['stale', 'good']
    const r = await look(['/app'], withSession)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(logins, 2)
    assert.match(r.stdout, /Signed in with a good token/)
    assert.match(r.stderr, /session ended: redoing the login/)
  })

  it('a session that is still over after the second login: exit 3, and the screen is not captured as if it were the one asked for', async () => {
    reset(); tokenPlan = ['stale', 'stale']
    const r = await look(['/app', '--shot', 'never.png'], withSession)
    assert.equal(r.code, 3)
    assert.equal(logins, 2)
    assert.match(r.stderr, /still over after redoing the login once/)
    assert.ok(!/^LOOK_CAPTURE/m.test(r.stdout))
  })
})

describe('look: it always ends', needsChromium, () => {
  it('a browser that does not exist: exit 6 and what to do, no trace', async () => {
    const r = await look(['/'], { LOOK_CHROMIUM: join(dir, 'no-such-browser') })
    assert.equal(r.code, 6)
    assert.match(r.stderr, /the browser did not start/)
    assert.match(r.stderr, /playwright install chromium/)
    assert.ok(!/\n\s+at /.test(r.stderr))
  })

  it('no Playwright anywhere: exit 6 and where to put it', async () => {
    const r = await look(['/'], { LOOK_PLAYWRIGHT_DIR: join(dir, 'nowhere'), HOME: dir })
    assert.equal(r.code, 6)
    assert.match(r.stderr, /Playwright is not installed here/)
  })

  it('a page that never returns: exit 4 at the time, naming the phase, and no browser left alive', async () => {
    const tmp = join(dir, 'loop-tmp'); mkdirSync(tmp)
    const r = await look(['/loop'], { LOOK_TIMEOUT_S: '8', TMPDIR: tmp })
    assert.equal(r.code, 4)
    assert.ok(r.ms < 14_000, `${r.ms} ms`)
    assert.match(r.stderr, /the time of 8 s ran out .* in the phase «screen \/loop»/)
    await new Promise((resolve) => setTimeout(resolve, 500)) // declared courtesy of this test: the kernel takes this long to clear the processes it was sent SIGKILL
    const alive = readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => { try { return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(tmp) } catch { return false } })
    assert.deepEqual(alive, [])
  })
})
