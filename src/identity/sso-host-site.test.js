// sso-redirect against a host site that is another HTTP server (TASK-021). The case in `e2e/capacidades/identidad.e2e.test.js` plays the
// host inside the test with `app.inject`; here the host is a site of its own on its own port, with its own login and its own cookie, and a
// browser that goes from one to the other following the redirects and carrying the cookies of each origin. What is checked is the
// protocol on the wire: signed start, the host's login, signed return, one-time answer, and a site that is not the host.
import assert from 'node:assert/strict'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { after, before, test } from 'node:test'
import { addMember, makeEnv } from '../testing/helpers.js'

const SECRET = 'secreto-compartido-con-el-sitio-anfitrion'
const PEOPLE = new Map([['ana@x.org', { password: 'clave del sitio de Ana', id: 'u-1', name: 'Ana' }]])

const sign = (secret, text) => createHmac('sha256', secret).update(text).digest('hex')
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** A free port, taken and released, so that the instance can announce its own address before it listens. */
async function freePort () {
  const probe = createNetServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/**
 * The host site, the way a site that signs the redirection writes it. `GET /sso` checks the signature of the request, sends a person who has
 * no session of the site to its own login, and for one who has it returns to the address the instance announced, with a signed answer.
 */
function hostSite ({ teamOrigin }) {
  const seen = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://host.invalid')
    seen.push(`${req.method} ${url.pathname}`)
    const cookie = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')))
    if (req.method === 'GET' && url.pathname === '/sso') {
      const sso = url.searchParams.get('sso') ?? ''
      if (!same(sign(SECRET, sso), url.searchParams.get('sig') ?? '')) { res.writeHead(403); return res.end('bad signature') }
      const request = JSON.parse(Buffer.from(sso, 'base64url').toString())
      // The host trusts only the address of the instance it was registered with, never the one that arrives in the request.
      if (!String(request.return_sso_url).startsWith(`${teamOrigin}/`)) { res.writeHead(403); return res.end('unregistered return address') }
      const person = PEOPLE.get(cookie.host_user)
      if (!person) { res.writeHead(302, { location: `/entrar?back=${encodeURIComponent(req.url)}` }); return res.end() }
      const answer = b64({ nonce: request.nonce, email: cookie.host_user, external_id: person.id, name: person.name, email_verified: true })
      const back = new URL(request.return_sso_url)
      back.searchParams.set('sso', answer)
      back.searchParams.set('sig', sign(SECRET, answer))
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (req.method === 'POST' && url.pathname === '/entrar') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const form = new URLSearchParams(body)
        const person = PEOPLE.get(form.get('email'))
        if (!person || person.password !== form.get('password')) { res.writeHead(401); return res.end('wrong credentials') }
        res.writeHead(302, { 'set-cookie': `host_user=${form.get('email')}; Path=/; HttpOnly`, location: form.get('back') })
        res.end()
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return { server, seen }
}

/** A person's browser: it follows redirects one by one and keeps a jar per origin, as the real one does. */
function browser () {
  const jars = new Map()
  const hops = []
  async function go (target, init = {}) {
    const url = new URL(target)
    const jar = jars.get(url.origin) ?? new Map()
    jars.set(url.origin, jar)
    const headers = new Headers(init.headers)
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    const res = await fetch(url, { ...init, headers, redirect: 'manual' })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const at = pair.indexOf('=')
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1))
      else jar.delete(pair.slice(0, at))
    }
    hops.push(`${init.method ?? 'GET'} ${url.origin}${url.pathname} ${res.status}`)
    return res
  }
  /** Follows redirects until a response that is not one; returns it. */
  async function follow (target, init) {
    let res = await go(target, init)
    for (let i = 0; i < 8 && res.status >= 300 && res.status < 400; i++) res = await go(new URL(res.headers.get('location'), target), {})
    return res
  }
  return { go, follow, hops, jars }
}

let host
let hostOrigin
let teamOrigin
let env

before(async () => {
  const teamPort = await freePort()
  teamOrigin = `http://127.0.0.1:${teamPort}`
  host = hostSite({ teamOrigin })
  await new Promise((resolve) => host.server.listen(0, '127.0.0.1', resolve))
  hostOrigin = `http://127.0.0.1:${host.server.address().port}`
  env = await makeEnv({
    config: {
      publicUrl: teamOrigin,
      identity: { provider: 'sso-redirect', cookieInsecureDev: true, delegated: { mode: 'sso-redirect', sso: { loginUrl: `${hostOrigin}/sso`, secret: SECRET } } }
    }
  })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await env.app.listen({ host: '127.0.0.1', port: teamPort })
})
after(async () => {
  await env.close()
  await new Promise((resolve) => host.server.close(resolve))
})

test('sso-redirect with a host that is another server: the person goes to the host, signs in there, comes back signed and gets a session; the answer is single use', async () => {
  const person = browser()
  // 1. Without a session the instance answers 401 and says where the entry is.
  const first = await person.go(`${teamOrigin}/api/me`)
  assert.equal(first.status, 401)
  assert.equal((await first.json()).login_url, '/api/auth/sso/start')

  // 2. The instance sends the browser to the host with a signed request that carries a nonce, and ties the nonce to this browser.
  const start = await person.go(`${teamOrigin}/api/auth/sso/start`)
  assert.equal(start.status, 302)
  const toHost = new URL(start.headers.get('location'))
  assert.equal(toHost.origin + toHost.pathname, `${hostOrigin}/sso`)
  assert.equal(JSON.parse(Buffer.from(toHost.searchParams.get('sso'), 'base64url').toString()).return_sso_url, `${teamOrigin}/api/auth/sso/callback`)
  assert.ok(person.jars.get(teamOrigin).has('sso-nonce'), 'the nonce cookie was not set on the instance')

  // 3. The host does not know the person: it sends her to its own entry, and a wrong password does not open it.
  const toEntry = await person.go(toHost)
  assert.equal(toEntry.status, 302)
  const entry = new URL(toEntry.headers.get('location'), hostOrigin)
  assert.equal(entry.pathname, '/entrar')
  const form = (password) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'ana@x.org', password, back: entry.searchParams.get('back') }) })
  assert.equal((await person.go(`${hostOrigin}/entrar`, form('otra clave'))).status, 401)
  const signedIn = await person.go(`${hostOrigin}/entrar`, form(PEOPLE.get('ana@x.org').password))
  assert.equal(signedIn.status, 302)

  // 4. With the host's session the same request now returns, signed, to the instance.
  const returned = await person.go(new URL(signedIn.headers.get('location'), hostOrigin))
  assert.equal(returned.status, 302)
  const callback = new URL(returned.headers.get('location'))
  assert.equal(callback.origin + callback.pathname, `${teamOrigin}/api/auth/sso/callback`)

  // 5. The instance accepts the answer, opens its own session and the panel's API recognizes Ana.
  const arrived = await person.go(callback)
  assert.equal(arrived.status, 302)
  const me = await person.go(`${teamOrigin}/api/me`)
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.equal(body.email, 'ana@x.org')
  assert.equal(body.source, 'session')

  // 6. The same answer a second time is refused, with or without the browser's session.
  const replay = await person.go(callback)
  assert.equal(replay.status, 403)

  assert.deepEqual(host.seen.filter((line) => line !== 'GET /favicon.ico'), ['GET /sso', 'POST /entrar', 'POST /entrar', 'GET /sso'])
})

test('sso-redirect: the host refuses a request with a tampered signature or an unregistered return address, and the instance refuses an answer signed by a site that is not the host', async () => {
  const person = browser()
  const start = await person.go(`${teamOrigin}/api/auth/sso/start`)
  const toHost = new URL(start.headers.get('location'))

  const tampered = new URL(toHost)
  tampered.searchParams.set('sig', '0'.repeat(64))
  assert.equal((await person.go(tampered)).status, 403)

  const elsewhere = b64({ nonce: JSON.parse(Buffer.from(toHost.searchParams.get('sso'), 'base64url').toString()).nonce, return_sso_url: 'https://otro.example/api/auth/sso/callback' })
  const redirected = new URL(toHost)
  redirected.searchParams.set('sso', elsewhere)
  redirected.searchParams.set('sig', sign(SECRET, elsewhere))
  assert.equal((await person.go(redirected)).status, 403)

  // A site that is not the host signs a valid-looking answer with its own secret: the instance does not open a session.
  const nonce = JSON.parse(Buffer.from(toHost.searchParams.get('sso'), 'base64url').toString()).nonce
  const forged = b64({ nonce, email: 'ana@x.org', external_id: 'u-1', email_verified: true })
  const attempt = await person.go(`${teamOrigin}/api/auth/sso/callback?sso=${forged}&sig=${sign('secreto-de-otro-sitio', forged)}`)
  assert.equal(attempt.status, 403)
  assert.equal((await person.go(`${teamOrigin}/api/me`)).status, 401)
})
